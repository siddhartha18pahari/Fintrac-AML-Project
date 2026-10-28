"""Entity graph for the investigator workspace.

Customers, cases, alerts, rules, typologies, wallets, devices, IP addresses
and parties become nodes. An edge is a fact from the ledger or from detection:
this customer used this device, this alert fired this rule, this rule belongs
to this typology. The graph is undirected for path finding. It does not assert
that a path is illicit.
"""

from __future__ import annotations

from collections import defaultdict, deque

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Alert, Case, Customer, Party, Transaction, Wallet
from .customer_risk import assess_all
from .typology_rules import is_msb_business

TYPOLOGIES = (
    ("typology:sanctions", "Sanctions screening", "AML-SC-001"),
    ("typology:pep", "Politically exposed person", "AML-SC-002"),
    ("typology:terrorist-property", "Terrorist property", "AML-TF-001"),
    ("typology:travel-rule", "Travel rule", "AML-TR-001"),
    ("typology:trade", "Trade-based laundering", "AML-TB-001"),
    ("typology:msb", "Money services business", "AML-TB-002"),
    ("typology:casino", "Casino minimal play", "AML-TB-003"),
    ("typology:structuring", "Structuring", "AML-FI-003"),
    ("typology:structuring-ring", "Multi-conductor structuring", "AML-FI-005"),
    ("typology:cross-rail", "Cross-rail movement", "AML-FI-004"),
)

SEVERITY_RISK = {"critical": 90, "high": 72, "medium": 48, "low": 22, "reporting": 40}


def shortest_path(edges: list[dict], start: str, end: str) -> list[str] | None:
    """Unweighted path on an undirected edge list. None when the nodes do not connect."""
    if start == end:
        return [start]
    neighbours: dict[str, set[str]] = defaultdict(set)
    for edge in edges:
        neighbours[edge["source"]].add(edge["target"])
        neighbours[edge["target"]].add(edge["source"])
    if start not in neighbours and end not in neighbours:
        return None
    seen = {start}
    queue: deque[list[str]] = deque([[start]])
    while queue:
        path = queue.popleft()
        for nxt in neighbours.get(path[-1], ()):
            if nxt in seen:
                continue
            extended = [*path, nxt]
            if nxt == end:
                return extended
            seen.add(nxt)
            queue.append(extended)
    return None


def _edge(edges: list[dict], seen: set[tuple[str, str, str]], source: str, target: str, relation: str) -> None:
    if not source or not target or source == target:
        return
    key = tuple(sorted((source, target))) + (relation,)
    if key in seen:
        return
    seen.add(key)
    edges.append(
        {
            "id": f"{relation}:{source}:{target}",
            "source": source,
            "target": target,
            "relation": relation,
        }
    )


def build_graph(session: Session, *, as_of=None) -> dict:
    customers = list(session.execute(select(Customer).order_by(Customer.id)).scalars().all())
    transactions = list(session.execute(select(Transaction)).scalars().all())
    alerts = list(session.execute(select(Alert)).scalars().all())
    cases = list(session.execute(select(Case)).scalars().all())
    wallets = {f"{row.blockchain}:{row.address}": row for row in session.execute(select(Wallet)).scalars().all()}
    parties = {row.id: row for row in session.execute(select(Party)).scalars().all()}
    ratings = {item.customer_id: item for item in assess_all(session, as_of=as_of)}

    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    seen: set[tuple[str, str, str]] = set()

    def add_node(node_id: str, **payload: object) -> None:
        current = nodes.get(node_id)
        if current is None:
            nodes[node_id] = {"id": node_id, **payload}
            return
        for key, value in payload.items():
            if value is None:
                continue
            if key == "risk" and current.get("risk") is not None:
                current["risk"] = max(int(current["risk"]), int(value))
            elif current.get(key) in (None, "", []):
                current[key] = value

    customer_risk = {}
    for customer in customers:
        rating = ratings.get(customer.id)
        risk = int(rating.residual) if rating else 0
        tier = rating.tier if rating else "LOW"
        customer_risk[customer.id] = risk
        node_id = f"customer:{customer.id}"
        add_node(
            node_id,
            kind="customer",
            label=customer.name,
            risk=risk,
            tier=tier,
            href=f"/customers/{customer.id}",
            detail=customer.occupation_or_business,
        )
        if is_msb_business(customer.occupation_or_business):
            add_node("typology:msb", kind="typology", label="Money services business", risk=55, href="/rules")
            _edge(edges, seen, node_id, "typology:msb", "business")
        if "casino" in (customer.occupation_or_business or "").lower():
            add_node("typology:casino", kind="typology", label="Casino minimal play", risk=55, href="/rules")
            _edge(edges, seen, node_id, "typology:casino", "business")

    for typology_id, label, rule_id in TYPOLOGIES:
        add_node(typology_id, kind="typology", label=label, risk=50, href="/rules")
        add_node(f"rule:{rule_id}", kind="rule", label=rule_id, risk=None, href="/rules", detail=label)
        _edge(edges, seen, f"rule:{rule_id}", typology_id, "typology")

    wallet_customers: dict[str, set[int]] = defaultdict(set)
    device_customers: dict[str, set[int]] = defaultdict(set)
    ip_customers: dict[str, set[int]] = defaultdict(set)
    for txn in transactions:
        for address, chain in ((txn.wallet_from, txn.blockchain), (txn.wallet_to, txn.blockchain)):
            if address:
                wallet_customers[f"{chain}:{address}"].add(txn.customer_id)
        context = txn.context or {}
        device = str(context.get("device_id") or "").strip()
        ip_address = str(context.get("ip_address") or "").strip()
        if device:
            device_customers[device].add(txn.customer_id)
        if ip_address:
            ip_customers[ip_address].add(txn.customer_id)

    evidence_ids = {txn_id for alert in alerts for txn_id in (alert.evidence_txn_ids or [])}
    evidence_txns = [txn for txn in transactions if txn.id in evidence_ids]
    notable_wallets: set[str] = set()
    for key, owners in wallet_customers.items():
        wallet = wallets.get(key)
        tags = list(wallet.risk_tags or []) if wallet else []
        score = int(wallet.external_risk_score or 0) if wallet else 0
        if len(owners) >= 2 or score >= 70 or tags:
            notable_wallets.add(key)
    for txn in evidence_txns:
        if txn.wallet_from:
            notable_wallets.add(f"{txn.blockchain}:{txn.wallet_from}")
        if txn.wallet_to:
            notable_wallets.add(f"{txn.blockchain}:{txn.wallet_to}")

    for key in notable_wallets:
        wallet = wallets.get(key)
        label = key.split(":", 1)[-1]
        short = label if len(label) <= 16 else f"{label[:8]}…{label[-4:]}"
        risk = int(wallet.external_risk_score or 0) if wallet else max(
            (customer_risk.get(owner, 0) for owner in wallet_customers.get(key, ())), default=0
        )
        add_node(
            f"wallet:{key}",
            kind="wallet",
            label=short,
            risk=risk,
            href="/network",
            detail=", ".join(wallet.risk_tags) if wallet and wallet.risk_tags else "Wallet",
        )
        for owner in wallet_customers.get(key, ()):
            _edge(edges, seen, f"customer:{owner}", f"wallet:{key}", "wallet")

    for device, owners in device_customers.items():
        if len(owners) < 2 and not any(customer_risk.get(owner, 0) >= 50 for owner in owners):
            continue
        risk = max(customer_risk.get(owner, 0) for owner in owners)
        add_node(f"device:{device}", kind="device", label=device, risk=risk, href="/network", detail="Device")
        for owner in owners:
            _edge(edges, seen, f"customer:{owner}", f"device:{device}", "device")

    for ip_address, owners in ip_customers.items():
        if len(owners) < 2:
            continue
        risk = max(customer_risk.get(owner, 0) for owner in owners)
        add_node(f"ip:{ip_address}", kind="ip", label=ip_address, risk=risk, href="/network", detail="IP address")
        for owner in owners:
            _edge(edges, seen, f"customer:{owner}", f"ip:{ip_address}", "ip")

    party_customers: dict[int, set[int]] = defaultdict(set)
    for txn in transactions:
        if txn.beneficiary_id:
            party_customers[txn.beneficiary_id].add(txn.customer_id)
        if txn.third_party_id:
            party_customers[txn.third_party_id].add(txn.customer_id)
    for party_id, owners in party_customers.items():
        if len(owners) < 2 and party_id not in {txn.beneficiary_id for txn in evidence_txns}:
            continue
        party = parties.get(party_id)
        if party is None:
            continue
        risk = max(customer_risk.get(owner, 0) for owner in owners)
        kind = "beneficiary" if party.kind.value == "BENEFICIARY" else "third_party"
        add_node(
            f"party:{party.id}",
            kind=kind,
            label=party.name,
            risk=risk,
            href="/network",
            detail=party.country,
        )
        for owner in owners:
            _edge(edges, seen, f"customer:{owner}", f"party:{party.id}", kind)

    for case in cases:
        add_node(
            f"case:{case.id}",
            kind="case",
            label=case.reference,
            risk=int(case.risk_score or 0),
            tier=case.risk_tier,
            href=f"/cases/{case.id}",
            detail=case.status.value if case.status else "",
        )
        _edge(edges, seen, f"customer:{case.customer_id}", f"case:{case.id}", "case")

    for alert in alerts:
        risk = SEVERITY_RISK.get((alert.severity or "").lower(), 30)
        add_node(
            f"alert:{alert.id}",
            kind="alert",
            label=alert.rule_id,
            risk=risk,
            tier=(alert.severity or "").upper(),
            href=f"/alerts/{alert.id}",
            detail=alert.title,
        )
        _edge(edges, seen, f"customer:{alert.customer_id}", f"alert:{alert.id}", "alert")
        add_node(f"rule:{alert.rule_id}", kind="rule", label=alert.rule_id, risk=risk, href="/rules", detail=alert.title)
        _edge(edges, seen, f"alert:{alert.id}", f"rule:{alert.rule_id}", "rule")
        if alert.case_id:
            _edge(edges, seen, f"case:{alert.case_id}", f"alert:{alert.id}", "case_alert")

    connected = {edge["source"] for edge in edges} | {edge["target"] for edge in edges}
    # Drop typology and rule shells that nothing in this book reached, except
    # rules that an alert already linked.
    live_nodes = [node for node in nodes.values() if node["id"] in connected or node["kind"] == "customer"]
    live_ids = {node["id"] for node in live_nodes}
    live_edges = [edge for edge in edges if edge["source"] in live_ids and edge["target"] in live_ids]
    live_nodes.sort(key=lambda node: (node["kind"], node["label"] or node["id"]))
    return {
        "disclaimer": (
            "Nodes are entities in the synthetic book. An edge is a shared identifier, "
            "a case, or a rule firing. A path is a connection to inspect, not a finding "
            "that money laundering occurred."
        ),
        "nodes": live_nodes,
        "edges": live_edges,
    }
