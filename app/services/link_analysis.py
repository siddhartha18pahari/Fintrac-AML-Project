"""Linked-account analysis.

Two customers who never share a wallet can still be the same operation: one
device, one beneficiary, one external address. This module clusters customers
by those shared keys. It does not decide that the cluster is suspicious. It
tells an investigator who is connected to whom, and why.
"""

from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Customer, Direction, Party, Transaction


def _find(parent: dict[int, int], node: int) -> int:
    parent.setdefault(node, node)
    while parent[node] != node:
        parent[node] = parent[parent[node]]
        node = parent[node]
    return node


def _union(parent: dict[int, int], left: int, right: int) -> None:
    root_left, root_right = _find(parent, left), _find(parent, right)
    if root_left != root_right:
        parent[root_right] = root_left


def analyze(session: Session) -> dict:
    transactions = list(session.execute(select(Transaction)).scalars().all())
    customers = {row.id: row for row in session.execute(select(Customer)).scalars().all()}
    parties = {row.id: row for row in session.execute(select(Party)).scalars().all()}

    wallets: dict[str, set[int]] = defaultdict(set)
    devices: dict[str, set[int]] = defaultdict(set)
    addresses: dict[str, set[int]] = defaultdict(set)
    beneficiaries: dict[int, set[int]] = defaultdict(set)

    for txn in transactions:
        if txn.direction is Direction.INCOMING and txn.wallet_from:
            wallets[txn.wallet_from].add(txn.customer_id)
        elif txn.direction is Direction.OUTGOING and txn.wallet_to:
            wallets[txn.wallet_to].add(txn.customer_id)
        context = txn.context or {}
        device = str(context.get("device_id") or "").strip()
        if device:
            devices[device].add(txn.customer_id)
        ip_address = str(context.get("ip_address") or "").strip()
        if ip_address:
            addresses[ip_address].add(txn.customer_id)
        if txn.beneficiary_id:
            beneficiaries[txn.beneficiary_id].add(txn.customer_id)

    parent: dict[int, int] = {}
    links: list[dict] = []

    def emit(kind: str, key: str, label: str, member_ids: set[int]) -> None:
        ids = sorted(member_ids)
        if len(ids) < 2:
            return
        for nxt in ids[1:]:
            _union(parent, ids[0], nxt)
        links.append(
            {
                "kind": kind,
                "key": key,
                "label": label,
                "customer_ids": ids,
                "customer_count": len(ids),
            }
        )

    for address, ids in wallets.items():
        emit("wallet", address, address, ids)
    for device, ids in devices.items():
        emit("device", device, device, ids)
    for ip_address, ids in addresses.items():
        emit("ip", ip_address, ip_address, ids)
    for party_id, ids in beneficiaries.items():
        party = parties.get(party_id)
        label = party.name if party else f"beneficiary {party_id}"
        emit("beneficiary", str(party_id), label, ids)

    grouped: dict[int, list[int]] = defaultdict(list)
    involved = {customer_id for link in links for customer_id in link["customer_ids"]}
    for customer_id in involved:
        grouped[_find(parent, customer_id)].append(customer_id)

    clusters = []
    for index, (root, member_ids) in enumerate(sorted(grouped.items(), key=lambda item: min(item[1])), start=1):
        ids = sorted(member_ids)
        reasons = [link for link in links if set(link["customer_ids"]).issubset(ids)]
        clusters.append(
            {
                "id": f"cluster-{index}",
                "customer_ids": ids,
                "customers": [
                    {
                        "id": customer_id,
                        "reference": customers[customer_id].external_id if customer_id in customers else "",
                        "name": customers[customer_id].name if customer_id in customers else "",
                    }
                    for customer_id in ids
                    if customer_id in customers
                ],
                "size": len(ids),
                "links": reasons,
            }
        )
    clusters.sort(key=lambda cluster: (-cluster["size"], cluster["id"]))

    return {
        "clusters": clusters,
        "link_count": len(links),
        "clustered_customers": len(involved),
    }
