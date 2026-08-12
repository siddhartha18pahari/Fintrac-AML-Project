"""Transaction-network analytics.

Builds a directed multigraph over customers, wallets and parties from the
transaction ledger and derives the structural patterns that matter in a crypto
AML review: fan-in, fan-out, circular movement, shared wallets, layering paths
and standard centrality measures.

NetworkX is used rather than a graph database so the project runs with no extra
infrastructure.  The graph is rebuilt on demand over a bounded time window; at
the scale this system targets (a demo ledger, tens of thousands of edges) that
is well under a second, and it removes a whole class of staleness bugs.  The
node/edge shape is deliberately Neo4j-compatible - see docs/ARCHITECTURE.md for
the migration path.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal

import networkx as nx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Customer, Direction, Party, Transaction, Wallet
from ..util import cad, utcnow


def customer_node(customer_id: int) -> str:
    return f"customer:{customer_id}"


def wallet_node(address: str) -> str:
    return f"wallet:{address}"


def party_node(party_id: int) -> str:
    return f"party:{party_id}"


@dataclass
class GraphView:
    graph: nx.MultiDiGraph
    txn_index: dict[str, Transaction] = field(default_factory=dict)

    def nodes_payload(self) -> list[dict]:
        return [{"id": n, **{k: v for k, v in d.items()}} for n, d in self.graph.nodes(data=True)]

    def edges_payload(self) -> list[dict]:
        out = []
        for src, dst, key, data in self.graph.edges(keys=True, data=True):
            out.append({"id": str(key), "source": src, "target": dst, **data})
        return out


def build_graph(
    session: Session,
    *,
    customer_ids: list[int] | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
) -> GraphView:
    stmt = select(Transaction)
    if customer_ids:
        stmt = stmt.where(Transaction.customer_id.in_(customer_ids))
    if since:
        stmt = stmt.where(Transaction.occurred_at >= since)
    if until:
        stmt = stmt.where(Transaction.occurred_at <= until)
    txns = list(session.execute(stmt.order_by(Transaction.occurred_at)).scalars().all())

    graph = nx.MultiDiGraph()
    view = GraphView(graph=graph)

    wallet_rows = {w.address: w for w in session.execute(select(Wallet)).scalars().all()}
    customer_rows = {c.id: c for c in session.execute(select(Customer)).scalars().all()}
    party_rows = {p.id: p for p in session.execute(select(Party)).scalars().all()}

    def ensure_wallet(address: str) -> str:
        node = wallet_node(address)
        if node not in graph:
            row = wallet_rows.get(address)
            graph.add_node(
                node,
                kind="wallet",
                label=_short(address),
                address=address,
                blockchain=row.blockchain if row else "",
                internal=bool(row.is_internal) if row else False,
                external_risk_score=row.external_risk_score if row else 0,
                risk_tags=list(row.risk_tags or []) if row else [],
                owner_customer_id=row.owner_customer_id if row else None,
            )
        return node

    def ensure_customer(customer_id: int) -> str:
        node = customer_node(customer_id)
        if node not in graph:
            row = customer_rows.get(customer_id)
            graph.add_node(
                node,
                kind="customer",
                label=row.name if row else f"customer {customer_id}",
                customer_id=customer_id,
                kyc_risk=row.kyc_risk if row else "",
                country=row.country if row else "",
            )
        return node

    def ensure_party(party_id: int) -> str:
        node = party_node(party_id)
        if node not in graph:
            row = party_rows.get(party_id)
            graph.add_node(
                node,
                kind=(row.kind.value.lower() if row else "party"),
                label=row.name if row else f"party {party_id}",
                party_id=party_id,
                country=row.country if row else "",
            )
        return node

    for txn in txns:
        view.txn_index[txn.external_id] = txn
        cust = ensure_customer(txn.customer_id)
        attrs = {
            "kind": "transaction",
            "txn_id": txn.id,
            "external_id": txn.external_id,
            "asset": txn.asset,
            "cad_value": float(txn.cad_value),
            "occurred_at": txn.occurred_at.isoformat(),
            "direction": txn.direction.value,
            "tx_hash": txn.tx_hash,
        }
        if txn.direction is Direction.INCOMING:
            src = ensure_wallet(txn.wallet_from) if txn.wallet_from else ensure_party(txn.customer_id)
            dst = ensure_wallet(txn.wallet_to) if txn.wallet_to else cust
            graph.add_edge(src, dst, key=f"txn:{txn.id}", relation="SENT", **attrs)
            if txn.wallet_to:
                graph.add_edge(cust, dst, key=f"owns:{txn.id}", relation="CONTROLS", kind="ownership")
        else:
            src = ensure_wallet(txn.wallet_from) if txn.wallet_from else cust
            dst = ensure_wallet(txn.wallet_to) if txn.wallet_to else ensure_party(txn.customer_id)
            graph.add_edge(src, dst, key=f"txn:{txn.id}", relation="SENT", **attrs)
            if txn.wallet_from:
                graph.add_edge(cust, src, key=f"owns:{txn.id}", relation="CONTROLS", kind="ownership")

        if txn.beneficiary_id:
            b = ensure_party(txn.beneficiary_id)
            graph.add_edge(cust, b, key=f"benefits:{txn.id}", relation="BENEFITS", kind="party_link")
        if txn.third_party_id:
            t = ensure_party(txn.third_party_id)
            graph.add_edge(cust, t, key=f"onbehalf:{txn.id}", relation="ON_BEHALF_OF", kind="party_link")

    return view


def _short(address: str) -> str:
    return address if len(address) <= 14 else f"{address[:7]}…{address[-5:]}"


# ---------------------------------------------------------------------------
# Pattern detection
# ---------------------------------------------------------------------------


def fan_in(session: Session, customer_id: int, *, end: datetime, hours: int = 24) -> dict:
    """Distinct external senders funding one customer inside a window."""
    start = end - timedelta(hours=hours)
    rows = (
        session.execute(
            select(Transaction).where(
                Transaction.customer_id == customer_id,
                Transaction.direction == Direction.INCOMING,
                Transaction.occurred_at >= start,
                Transaction.occurred_at <= end,
            )
        )
        .scalars()
        .all()
    )
    senders = defaultdict(lambda: {"count": 0, "cad": Decimal("0")})
    for txn in rows:
        if not txn.wallet_from:
            continue
        bucket = senders[txn.wallet_from]
        bucket["count"] += 1
        bucket["cad"] += Decimal(str(txn.cad_value))
    return {
        "unique_senders": len(senders),
        "transactions": len(rows),
        "total_cad": cad(sum((Decimal(str(t.cad_value)) for t in rows), Decimal("0"))),
        "senders": {k: {"count": v["count"], "cad": float(cad(v["cad"]))} for k, v in senders.items()},
        "txn_ids": [t.id for t in rows],
        "window_start": start,
        "window_end": end,
    }


def fan_out(session: Session, customer_id: int, *, end: datetime, hours: int = 24) -> dict:
    start = end - timedelta(hours=hours)
    rows = (
        session.execute(
            select(Transaction).where(
                Transaction.customer_id == customer_id,
                Transaction.direction == Direction.OUTGOING,
                Transaction.occurred_at >= start,
                Transaction.occurred_at <= end,
            )
        )
        .scalars()
        .all()
    )
    receivers = {t.wallet_to for t in rows if t.wallet_to}
    return {
        "unique_receivers": len(receivers),
        "transactions": len(rows),
        "total_cad": cad(sum((Decimal(str(t.cad_value)) for t in rows), Decimal("0"))),
        "receivers": sorted(receivers),
        "txn_ids": [t.id for t in rows],
    }


def find_cycles(
    session: Session,
    customer_id: int,
    *,
    end: datetime,
    hours: int = 72,
    max_hops: int = 4,
) -> list[dict]:
    """Value that leaves the customer and comes back within ``max_hops``.

    Only forward-in-time paths count: a "cycle" made of edges that run backwards
    chronologically is not a round trip, it is a coincidence of addresses.
    """
    start = end - timedelta(hours=hours)
    txns = list(
        session.execute(
            select(Transaction)
            .where(Transaction.occurred_at >= start, Transaction.occurred_at <= end)
            .order_by(Transaction.occurred_at)
        )
        .scalars()
        .all()
    )

    outgoing_by_address: dict[str, list[Transaction]] = defaultdict(list)
    for txn in txns:
        if txn.wallet_from:
            outgoing_by_address[txn.wallet_from].append(txn)

    owned = {
        w.address
        for w in session.execute(select(Wallet).where(Wallet.owner_customer_id == customer_id)).scalars().all()
    }
    seeds = [
        t
        for t in txns
        if t.customer_id == customer_id and t.direction is Direction.OUTGOING and t.wallet_to
    ]

    cycles: list[dict] = []
    seen_signatures: set[tuple] = set()

    for seed in seeds:
        stack = [(seed.wallet_to, [seed], {seed.wallet_from or "", seed.wallet_to})]
        while stack:
            address, path, visited = stack.pop()
            if len(path) >= max_hops:
                continue
            for nxt in outgoing_by_address.get(address, []):
                if nxt.occurred_at < path[-1].occurred_at or nxt.id == path[-1].id:
                    continue
                destination = nxt.wallet_to
                if not destination:
                    continue
                returns_home = destination in owned or (
                    nxt.customer_id == customer_id and nxt.direction is Direction.INCOMING
                )
                if returns_home:
                    hops = path + [nxt]
                    signature = tuple(t.id for t in hops)
                    if signature in seen_signatures:
                        continue
                    seen_signatures.add(signature)
                    cycles.append(
                        {
                            "hops": len(hops),
                            "txn_ids": [t.id for t in hops],
                            "external_ids": [t.external_id for t in hops],
                            "addresses": [hops[0].wallet_from] + [t.wallet_to for t in hops],
                            "started_at": hops[0].occurred_at,
                            "returned_at": hops[-1].occurred_at,
                            "out_cad": float(cad(Decimal(str(hops[0].cad_value)))),
                            "back_cad": float(cad(Decimal(str(hops[-1].cad_value)))),
                        }
                    )
                    continue
                if destination not in visited:
                    stack.append((destination, path + [nxt], visited | {destination}))
    return cycles


def shared_wallets(session: Session, customer_id: int, *, since: datetime, min_customers: int = 2) -> list[dict]:
    """External addresses that transact with more than one customer."""
    rows = (
        session.execute(select(Transaction).where(Transaction.occurred_at >= since)).scalars().all()
    )
    by_address: dict[str, set[int]] = defaultdict(set)
    txns_by_address: dict[str, list[int]] = defaultdict(list)
    internal = {
        w.address for w in session.execute(select(Wallet).where(Wallet.is_internal.is_(True))).scalars().all()
    }
    for txn in rows:
        for address in (txn.wallet_from, txn.wallet_to):
            if not address or address in internal:
                continue
            by_address[address].add(txn.customer_id)
            txns_by_address[address].append(txn.id)

    out = []
    for address, customers in by_address.items():
        if customer_id in customers and len(customers) >= min_customers:
            out.append(
                {
                    "address": address,
                    "customer_ids": sorted(customers),
                    "customer_count": len(customers),
                    "txn_ids": txns_by_address[address],
                }
            )
    return sorted(out, key=lambda r: -r["customer_count"])


def centrality_features(view: GraphView, node: str) -> dict:
    """Structural features for the ML layer.

    Computed on the simple (collapsed) directed projection - multiplicity is
    already captured by the transaction-count features.
    """
    simple = nx.DiGraph()
    simple.add_nodes_from(view.graph.nodes(data=True))
    for src, dst, data in view.graph.edges(data=True):
        if data.get("relation") != "SENT":
            continue
        if simple.has_edge(src, dst):
            simple[src][dst]["weight"] += 1
        else:
            simple.add_edge(src, dst, weight=1)

    if node not in simple:
        return {"degree": 0, "in_degree": 0, "out_degree": 0, "pagerank": 0.0, "component_size": 0}

    undirected = simple.to_undirected()
    component = nx.node_connected_component(undirected, node) if node in undirected else {node}
    try:
        pagerank = nx.pagerank(simple, weight="weight").get(node, 0.0)
    except Exception:  # pragma: no cover - power iteration failure on odd graphs
        pagerank = 0.0
    return {
        "degree": simple.degree(node),
        "in_degree": simple.in_degree(node),
        "out_degree": simple.out_degree(node),
        "pagerank": float(pagerank),
        "component_size": len(component),
    }


def risky_neighbours(view: GraphView, node: str, *, hops: int = 2, min_risk: int = 70) -> list[dict]:
    """High-risk wallets reachable within ``hops`` of ``node``."""
    if node not in view.graph:
        return []
    undirected = view.graph.to_undirected(as_view=False)
    lengths = nx.single_source_shortest_path_length(undirected, node, cutoff=hops)
    out = []
    for other, distance in lengths.items():
        if other == node:
            continue
        data = view.graph.nodes[other]
        if data.get("kind") != "wallet":
            continue
        if data.get("external_risk_score", 0) >= min_risk or data.get("risk_tags"):
            out.append(
                {
                    "node": other,
                    "address": data.get("address"),
                    "hops": distance,
                    "external_risk_score": data.get("external_risk_score", 0),
                    "risk_tags": data.get("risk_tags", []),
                }
            )
    return sorted(out, key=lambda r: (r["hops"], -r["external_risk_score"]))


def layering_path(view: GraphView, source: str, target: str, *, max_hops: int = 6) -> list[str] | None:
    try:
        return nx.shortest_path(view.graph.to_undirected(as_view=True), source, target)
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return None


def neighbourhood(
    session: Session, node: str, *, hops: int = 2, since: datetime | None = None
) -> GraphView:
    """A bounded subgraph around one node, for the investigator UI."""
    since = since or (utcnow() - timedelta(days=90))
    view = build_graph(session, since=since)
    if node not in view.graph:
        return GraphView(graph=nx.MultiDiGraph())
    undirected = view.graph.to_undirected(as_view=True)
    keep = set(nx.single_source_shortest_path_length(undirected, node, cutoff=hops))
    sub = view.graph.subgraph(keep).copy()
    return GraphView(graph=sub, txn_index=view.txn_index)
