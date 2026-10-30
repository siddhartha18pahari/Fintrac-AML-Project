"""Read-only queries over the bundled synthetic snapshot.

The Next.js workspace and these endpoints describe the same book. Nothing here
writes a case, files a report, or contacts FINTRAC.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

from .book_simulator import simulate
from .retrieval import search
from .statistics import (
    benford_test,
    correlation_matrix,
    decompose,
    gaussian_kde,
    histogram,
    iqr_fences,
    isolation_scores,
    mean,
    metrics_at_threshold,
    peer_groups,
    pstdev,
    roc_curve,
    velocity,
    zscores,
)

SNAPSHOT = Path(__file__).resolve().parents[2] / "web" / "src" / "data" / "snapshot.json"
BENIGN = {"normal_retail", "demo_baseline", "casino_ordinary_play", "trade_within_tolerance", "", None}


@lru_cache(maxsize=1)
def load_snapshot() -> dict:
    return json.loads(SNAPSHOT.read_text(encoding="utf-8"))


def query_alerts(*, severity: str = "", rule_id: str = "", query: str = "", limit: int = 25) -> dict:
    book = load_snapshot()
    severity = severity.strip().lower()
    rule_id = rule_id.strip().upper()
    needle = query.strip().lower()
    rows = []
    for alert in book["alerts"]:
        if severity and str(alert.get("severity", "")).lower() != severity:
            continue
        if rule_id and str(alert.get("rule_id", "")).upper() != rule_id:
            continue
        blob = " ".join(
            str(alert.get(key) or "")
            for key in ("title", "customer_name", "rule_id", "explanation", "severity")
        ).lower()
        if needle and needle not in blob:
            continue
        rows.append(
            {
                "id": alert["id"],
                "rule_id": alert["rule_id"],
                "title": alert["title"],
                "severity": alert["severity"],
                "customer_id": alert["customer_id"],
                "customer_name": alert.get("customer_name"),
                "case_id": alert.get("case_id"),
                "score_contribution": alert.get("score_contribution"),
                "occurred_at": alert.get("occurred_at"),
            }
        )
    return {"count": len(rows), "alerts": rows[: max(1, min(limit, 100))]}


def query_cases(*, tier: str = "", status: str = "", limit: int = 25) -> dict:
    book = load_snapshot()
    tier = tier.strip().upper()
    status = status.strip().upper()
    rows = []
    for case in book["cases"]:
        if tier and str(case.get("risk_tier", "")).upper() != tier:
            continue
        if status and str(case.get("status", "")).upper() != status:
            continue
        rows.append(
            {
                "id": case["id"],
                "reference": case["reference"],
                "customer_id": case["customer_id"],
                "customer_name": case.get("customer_name"),
                "status": case.get("status"),
                "priority": case.get("priority"),
                "risk_tier": case.get("risk_tier"),
                "risk_score": case.get("risk_score"),
                "lvctr_required": case.get("lvctr_required"),
                "str_candidate": case.get("str_candidate"),
                "due_at": case.get("due_at"),
            }
        )
    rows.sort(key=lambda row: (-(row["risk_score"] or 0), row["reference"]))
    return {"count": len(rows), "cases": rows[: max(1, min(limit, 100))]}


def _entity_blob(customer: dict) -> str:
    return " ".join(
        [
            str(customer.get("name") or ""),
            str(customer.get("customer_id") or ""),
            str(customer.get("id") or ""),
            str(customer.get("occupation_or_business") or ""),
            str((customer.get("profile") or {}).get("city") or ""),
        ]
    ).lower()


def query_entities(*, query: str = "", kind: str = "customer", limit: int = 20) -> dict:
    book = load_snapshot()
    needle = query.strip().lower()
    kind = (kind or "customer").lower()
    if kind != "customer":
        nodes = []
        for node in book["knowledge_graph"]["nodes"]:
            if kind != "any" and str(node.get("kind")) != kind:
                continue
            blob = f"{node.get('label', '')} {node.get('id', '')} {node.get('detail', '')}".lower()
            if needle and needle not in blob:
                continue
            nodes.append(
                {
                    "id": node["id"],
                    "kind": node.get("kind"),
                    "label": node.get("label"),
                    "risk": node.get("risk"),
                    "detail": node.get("detail"),
                }
            )
        return {"count": len(nodes), "entities": nodes[: max(1, min(limit, 50))]}
    rows = []
    for customer in book["customers"]:
        if needle and needle not in _entity_blob(customer):
            continue
        rows.append(
            {
                "id": customer["id"],
                "reference": customer["customer_id"],
                "name": customer["name"],
                "kind": "customer",
                "tier": (customer.get("risk") or {}).get("tier"),
                "residual": (customer.get("risk") or {}).get("residual"),
                "city": (customer.get("profile") or {}).get("city"),
                "occupation": customer.get("occupation_or_business"),
            }
        )
    return {"count": len(rows), "entities": rows[: max(1, min(limit, 50))]}


def entity_detail(entity_id: str) -> dict | None:
    book = load_snapshot()
    needle = entity_id.strip().lower()
    customer = None
    for row in book["customers"]:
        if needle in {str(row["id"]).lower(), str(row["customer_id"]).lower(), str(row["name"]).lower()}:
            customer = row
            break
    if customer is None:
        for row in book["customers"]:
            if needle and needle in row["name"].lower():
                customer = row
                break
    if customer is None:
        node = next((item for item in book["knowledge_graph"]["nodes"] if str(item["id"]).lower() == needle), None)
        if node is None:
            return None
        neighbours = _neighbours(book, node["id"])
        return {"kind": node.get("kind"), "node": node, "neighbours": neighbours}
    customer_id = customer["id"]
    alerts = [alert for alert in book["alerts"] if alert["customer_id"] == customer_id][:12]
    transactions = [txn for txn in book["transactions"] if txn["customer_id"] == customer_id][:12]
    node_id = f"customer:{customer_id}"
    return {
        "kind": "customer",
        "customer": {
            "id": customer_id,
            "reference": customer["customer_id"],
            "name": customer["name"],
            "occupation": customer.get("occupation_or_business"),
            "country": customer.get("country"),
            "city": (customer.get("profile") or {}).get("city"),
            "risk": customer.get("risk"),
            "screening": customer.get("screening"),
        },
        "alerts": [
            {"id": alert["id"], "rule_id": alert["rule_id"], "title": alert["title"], "severity": alert["severity"]}
            for alert in alerts
        ],
        "transactions": [
            {
                "id": txn["id"],
                "cad_value": txn["cad_value"],
                "instrument": txn["instrument"],
                "direction": txn["direction"],
                "occurred_at": txn["occurred_at"],
            }
            for txn in transactions
        ],
        "neighbours": _neighbours(book, node_id),
    }


def _neighbours(book: dict, node_id: str) -> list[dict]:
    graph = book["knowledge_graph"]
    ids = set()
    for edge in graph["edges"]:
        if edge["source"] == node_id:
            ids.add(edge["target"])
        elif edge["target"] == node_id:
            ids.add(edge["source"])
    labels = {node["id"]: node for node in graph["nodes"]}
    return [
        {"id": item_id, "label": (labels.get(item_id) or {}).get("label"), "kind": (labels.get(item_id) or {}).get("kind")}
        for item_id in list(ids)[:16]
    ]


def graph_query(*, source: str = "", target: str = "", ego: str = "", depth: int = 2) -> dict:
    book = load_snapshot()
    graph = book["knowledge_graph"]
    nodes = {node["id"]: node for node in graph["nodes"]}
    adjacency: dict[str, set[str]] = defaultdict(set)
    for edge in graph["edges"]:
        adjacency[edge["source"]].add(edge["target"])
        adjacency[edge["target"]].add(edge["source"])

    def resolve(text: str) -> str | None:
        cleaned = text.strip().lower()
        if not cleaned:
            return None
        if cleaned in {key.lower(): key for key in nodes}:
            for key in nodes:
                if key.lower() == cleaned:
                    return key
        for node in graph["nodes"]:
            label = str(node.get("label") or "").lower()
            if cleaned == label or cleaned in label:
                return node["id"]
        return None

    if source and target:
        start = resolve(source)
        end = resolve(target)
        if not start or not end:
            return {"found": False, "reason": "One or both names are not on the knowledge graph.", "path": []}
        path = _bfs(adjacency, start, end)
        return {
            "found": path is not None,
            "path": [_public_node(nodes, item) for item in (path or [])],
            "hops": (len(path) - 1) if path else None,
        }

    focus = resolve(ego or source or target)
    if focus is None:
        focus = max(graph["nodes"], key=lambda node: node.get("risk") or 0)["id"]
    kept = _ego(adjacency, focus, max(1, min(depth, 4)))
    return {
        "focus": _public_node(nodes, focus),
        "nodes": [_public_node(nodes, item) for item in kept],
        "edges": [
            {"source": edge["source"], "target": edge["target"], "relation": edge.get("relation")}
            for edge in graph["edges"]
            if edge["source"] in kept and edge["target"] in kept
        ][:80],
    }


def _public_node(nodes: dict, node_id: str) -> dict:
    node = nodes.get(node_id) or {"id": node_id}
    return {"id": node_id, "label": node.get("label"), "kind": node.get("kind"), "risk": node.get("risk")}


def _bfs(adjacency: dict[str, set[str]], start: str, end: str) -> list[str] | None:
    if start == end:
        return [start]
    queue = [[start]]
    seen = {start}
    while queue:
        path = queue.pop(0)
        for nxt in adjacency.get(path[-1], ()):
            if nxt in seen:
                continue
            extended = [*path, nxt]
            if nxt == end:
                return extended
            seen.add(nxt)
            queue.append(extended)
    return None


def _ego(adjacency: dict[str, set[str]], start: str, depth: int) -> set[str]:
    kept = {start}
    frontier = {start}
    for _ in range(depth):
        nxt = set()
        for node in frontier:
            nxt.update(adjacency.get(node, ()))
        nxt -= kept
        kept.update(nxt)
        frontier = nxt
    return kept


def explain_rule(rule_id: str) -> dict:
    book = load_snapshot()
    cleaned = rule_id.strip().upper()
    match = None
    if cleaned:
        match = next((rule for rule in book["rules"] if str(rule.get("rule_id", "")).upper() == cleaned), None)
    if match is None and cleaned:
        match = next((rule for rule in book["rules"] if cleaned in str(rule.get("name", "")).upper()), None)
    if match is None:
        catalogue = [{"rule_id": rule["rule_id"], "name": rule["name"]} for rule in book["rules"] if rule.get("in_force")]
        return {"found": False, "catalogue": catalogue[:12]}
    return {
        "found": True,
        "rule_id": match["rule_id"],
        "name": match["name"],
        "category": match.get("category"),
        "severity": match.get("severity"),
        "description": match.get("description"),
        "in_force": match.get("in_force"),
    }


def compute_stats(metric: str = "overview") -> dict:
    payload = book_statistics()
    metric = (metric or "overview").lower()
    if metric in {"benford", "digits"}:
        return {"metric": "benford", "benford": payload["benford"]}
    if metric in {"velocity", "flow"}:
        return {"metric": "velocity", "velocity": payload["velocity"][:8]}
    if metric in {"peer", "peers"}:
        return {"metric": "peers", "peers": payload["peers"][:8]}
    if metric in {"roc", "threshold"}:
        return {"metric": "roc", "roc": {"auc": payload["roc"]["auc"], "at_default": payload["threshold"]}}
    if metric in {"anomaly", "isolation"}:
        return {"metric": "anomaly", "anomaly": payload["anomaly_summary"]}
    return {
        "metric": "overview",
        "transactions": payload["transactions"],
        "customers": payload["customers"],
        "cad_total": payload["cad_total"],
        "benford_conformity": payload["benford"]["conformity"],
        "benford_mad": payload["benford"]["mad"],
        "auc": payload["roc"]["auc"],
        "disclaimer": payload["disclaimer"],
    }


def book_statistics() -> dict:
    book = load_snapshot()
    amounts = [float(txn["cad_value"]) for txn in book["transactions"] if float(txn["cad_value"]) > 0]
    digits = benford_test(amounts)
    fences = iqr_fences(amounts)
    scores = zscores(amounts)
    hist = histogram([math.log10(amount) for amount in amounts], bins=14)
    density = gaussian_kde([math.log10(amount) for amount in amounts], points=28)
    daily = [float(point["total"]) for point in book["series"]]
    parts = decompose(daily, period=7)

    by_customer: dict[int, list[float]] = defaultdict(list)
    instruments: dict[int, set[str]] = defaultdict(set)
    scenarios: dict[int, set[str]] = defaultdict(set)
    for txn in book["transactions"]:
        by_customer[txn["customer_id"]].append(float(txn["cad_value"]))
        instruments[txn["customer_id"]].add(str(txn.get("instrument") or ""))
        scenarios[txn["customer_id"]].add(txn.get("scenario"))
    anomaly = {row["customer_id"]: float(row.get("score") or 0) for row in book["anomaly"]}
    names = {row["id"]: row for row in book["customers"]}
    matrix_rows = []
    feature_columns = {"count": [], "total": [], "mean": [], "max": [], "instruments": [], "anomaly": [], "residual": []}
    members = []
    labels = []
    model_scores = []
    for customer_id, values in by_customer.items():
        customer = names.get(customer_id) or {}
        profile = customer.get("profile") or {}
        group = profile.get("occupation") or customer.get("customer_type") or "other"
        total = sum(values)
        feature_columns["count"].append(float(len(values)))
        feature_columns["total"].append(total)
        feature_columns["mean"].append(mean(values))
        feature_columns["max"].append(max(values))
        feature_columns["instruments"].append(float(len(instruments[customer_id])))
        feature_columns["anomaly"].append(anomaly.get(customer_id, 0.0))
        feature_columns["residual"].append(float((customer.get("risk") or {}).get("residual") or 0))
        matrix_rows.append([len(values), total, mean(values), max(values), len(instruments[customer_id])])
        suspicious = any(scenario not in BENIGN for scenario in scenarios[customer_id])
        labels.append(1 if suspicious else 0)
        model_scores.append(anomaly.get(customer_id, 0.0))
        members.append({"name": customer.get("name"), "group": group, "value": total})
    isolation = isolation_scores(matrix_rows, trees=32, seed=20260811) if matrix_rows else []
    order = sorted(range(len(isolation)), key=lambda index: isolation[index], reverse=True)[:5]
    top = [
        {
            "customer": (names.get(list(by_customer.keys())[index]) or {}).get("name"),
            "score": isolation[index],
        }
        for index in order
    ]
    curve = roc_curve(model_scores, labels)
    default_threshold = 0.6
    tuned = metrics_at_threshold(model_scores, labels, default_threshold)
    return {
        "disclaimer": (
            "Precision, recall and the ROC use planted scenario labels in this synthetic book. "
            "They are not a measure of money-laundering detection. A reporting threshold is not suspicion."
        ),
        "transactions": len(amounts),
        "customers": len(by_customer),
        "cad_total": round(sum(amounts), 2),
        "benford": digits,
        "iqr": {key: fences[key] for key in ("q1", "q3", "iqr", "low", "high", "outlier_count")},
        "zscore_abs_over_3": sum(1 for score in scores if abs(score) >= 3),
        "histogram": hist,
        "kde": density,
        "decomposition": {
            "period": parts["period"],
            "dates": [point["date"] for point in book["series"]],
            "observed": daily,
            "trend": parts["trend"],
            "seasonal": parts["seasonal"],
            "residual": parts["residual"],
        },
        "correlation": correlation_matrix(feature_columns),
        "velocity": velocity(
            [
                {"customer": txn.get("customer_name") or txn["customer_id"], "at": txn["occurred_at"], "cad": float(txn["cad_value"])}
                for txn in book["transactions"]
            ]
        )[:12],
        "peers": peer_groups(members)[:12],
        "anomaly_summary": {
            "method": "isolation-forest-style",
            "highest": top,
            "mean_score": mean(isolation) if isolation else 0,
            "spread": pstdev(isolation) if isolation else 0,
        },
        "roc": {"auc": curve["auc"], "positives": curve["positives"], "negatives": curve["negatives"], "points": _thin(curve["points"])},
        "threshold": tuned,
        "planted_recall": (book.get("performance") or {}).get("recall"),
    }


def _thin(points: list[dict], limit: int = 24) -> list[dict]:
    if len(points) <= limit:
        return points
    step = max(1, len(points) // limit)
    thinned = points[::step]
    if points[-1] not in thinned:
        thinned.append(points[-1])
    return thinned


def retrieve_guidance(question: str, k: int = 4) -> list[dict]:
    return search(question, k=k)


def run_simulation(controls: dict | None = None) -> dict:
    payload = simulate(controls)
    payload["transactions"] = payload["transactions"][:80]
    return payload
