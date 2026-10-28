"""Export a deterministic detection snapshot for the web platform.

The Next.js app in ``web/`` does not need Postgres or the FastAPI process.
It reads the JSON this script writes, which is the real rule engine, anomaly
layer, customer-risk rating, link analysis and STR copilot run against the
synthetic ledger.

    python -m scripts.export_snapshot

The ``end`` instant and seed are fixed so a regenerated file is stable.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if __package__ in (None, ""):
    sys.path.insert(0, str(ROOT))

os.environ.setdefault(
    "DATABASE_URL",
    f"sqlite:///{(Path(tempfile.mkdtemp(prefix='sentinel-snap-')) / 'snap.db').as_posix()}",
)
os.environ.setdefault("SECRET_KEY", "snapshot-export")

from sqlalchemy import select  # noqa: E402

from app.config import settings  # noqa: E402
from app.db import reset_db, session_scope  # noqa: E402
from app.models import (  # noqa: E402
    AggregationEvent,
    Alert,
    AnomalyScore,
    Case,
    Customer,
    Party,
    Transaction,
)
from app.serializers import aggregation_json, alert_json, case_json, customer_json, transaction_json  # noqa: E402
from app.services import (  # noqa: E402
    book_metrics,
    customer_risk,
    draft_filings,
    graph_engine,
    knowledge_graph,
    link_analysis,
    pipeline,
    retrieval,
    rules_engine,
    screening,
    str_copilot,
)
from app.util import cad  # noqa: E402
from scripts.generate_synthetic import generate  # noqa: E402
from scripts.seed import load_dataset  # noqa: E402

END = datetime(2026, 10, 1, 18, 0, 0)
SEED = 20260811
CUSTOMERS = 20
DAYS = 28
OUT = ROOT / "web" / "src" / "data" / "snapshot.json"
MAX_GRAPH_NODES = 140


def _profile(customer: Customer) -> dict:
    kyc = customer.kyc or {}
    address = kyc.get("address") or {}
    return {
        "city": address.get("city"),
        "province": address.get("province"),
        "occupation": customer.occupation_or_business,
        "customer_type": customer.customer_type.value,
        "expected_monthly_cad": float(cad(customer.expected_monthly_volume_cad or 0)),
        "onboarded_at": customer.onboarded_at.isoformat() if customer.onboarded_at else None,
    }


def _focus_graph(nodes: list[dict], edges: list[dict], focus_ids: set[str]) -> tuple[list[dict], list[dict]]:
    if len(nodes) <= MAX_GRAPH_NODES:
        return nodes, edges
    keep = set(focus_ids)
    changed = True
    while changed:
        changed = False
        for edge in edges:
            if edge["source"] in keep and edge["target"] not in keep:
                keep.add(edge["target"])
                changed = True
            elif edge["target"] in keep and edge["source"] not in keep:
                keep.add(edge["source"])
                changed = True
            if len(keep) >= MAX_GRAPH_NODES:
                changed = False
                break
    kept_nodes = [node for node in nodes if node["id"] in keep][:MAX_GRAPH_NODES]
    kept_ids = {node["id"] for node in kept_nodes}
    kept_edges = [edge for edge in edges if edge["source"] in kept_ids and edge["target"] in kept_ids]
    return kept_nodes, kept_edges


def build() -> dict:
    reset_db()
    dataset = generate(seed=SEED, customers=CUSTOMERS, days=DAYS, end=END)
    with session_scope() as session:
        rules_engine.sync_rule_versions(session)
        load = load_dataset(session, dataset)
        if load["failures"]:
            raise SystemExit(f"ingestion failures: {load['failures'][:3]}")
        print(f"ingested {load['ingested']} transactions", flush=True)
        detection = pipeline.run(session, with_anomaly=True)
        print(
            f"alerts {detection['alerts_created']} cases {detection['cases_opened']} "
            f"lvctr {detection['aggregation_events']}",
            flush=True,
        )

        customers = list(session.execute(select(Customer).order_by(Customer.id)).scalars().all())
        customer_rows = {row.id: row for row in customers}
        ratings = {item.customer_id: item for item in customer_risk.assess_all(session, as_of=END)}

        transactions = list(
            session.execute(select(Transaction).order_by(Transaction.occurred_at, Transaction.id)).scalars().all()
        )
        alerts = list(session.execute(select(Alert).order_by(Alert.score_contribution.desc(), Alert.id)).scalars().all())
        cases = list(session.execute(select(Case).order_by(Case.risk_score.desc(), Case.id)).scalars().all())
        events = list(session.execute(select(AggregationEvent).order_by(AggregationEvent.id)).scalars().all())
        anomalies = list(
            session.execute(select(AnomalyScore).order_by(AnomalyScore.score.desc())).scalars().all()
        )

        txn_json = [transaction_json(txn, customer=customer_rows.get(txn.customer_id)) for txn in transactions]
        party_rows = {party.id: party for party in session.execute(select(Party)).scalars()}
        for txn, payload in zip(transactions, txn_json):
            party = party_rows.get(txn.beneficiary_id) if txn.beneficiary_id else None
            if party is None:
                continue
            context = dict(payload.get("context") or {})
            context["beneficiary_country"] = party.country
            payload["context"] = context
        alert_json_rows = [alert_json(alert, customer=customer_rows.get(alert.customer_id)) for alert in alerts]
        case_rows = [case_json(case, customer=customer_rows.get(case.customer_id), detail=True) for case in cases]

        by_day: dict[str, dict[str, float]] = defaultdict(lambda: {"CASH": 0.0, "EFT": 0.0, "VIRTUAL_CURRENCY": 0.0})
        for txn in txn_json:
            if txn["direction"] != "INCOMING":
                continue
            day = txn["occurred_at"][:10]
            rail = txn.get("instrument") or "VIRTUAL_CURRENCY"
            by_day[day][rail] = round(by_day[day].get(rail, 0.0) + txn["cad_value"], 2)
        series = []
        for day in sorted(by_day):
            bucket = by_day[day]
            series.append(
                {
                    "date": day,
                    "cash": bucket.get("CASH", 0.0),
                    "eft": bucket.get("EFT", 0.0),
                    "virtual_currency": bucket.get("VIRTUAL_CURRENCY", 0.0),
                    "total": round(sum(bucket.values()), 2),
                }
            )

        rule_counts: dict[str, int] = defaultdict(int)
        for alert in alert_json_rows:
            rule_counts[alert["rule_id"]] += 1

        view = graph_engine.build_graph(session, until=END)
        focus = {f"customer:{case.customer_id}" for case in cases}
        nodes, edges = _focus_graph(view.nodes_payload(), view.edges_payload(), focus)
        for edge in edges:
            if isinstance(edge.get("cad_value"), Decimal):
                edge["cad_value"] = float(edge["cad_value"])

        links = link_analysis.analyze(session)
        drafts = []
        drafted = 0
        for case in cases:
            if not case.str_candidate and case.risk_score < 40:
                continue
            if drafted >= 8:
                break
            draft, verification = str_copilot.draft_for_case(session, case)
            customer = customer_rows.get(case.customer_id)
            drafts.append(
                {
                    "case_id": case.id,
                    "reference": case.reference,
                    "customer_id": case.customer_id,
                    "customer_name": customer.name if customer else None,
                    "risk_score": case.risk_score,
                    "risk_tier": case.risk_tier,
                    "str_candidate": case.str_candidate,
                    "lvctr_required": case.lvctr_required,
                    "narrative": draft.text,
                    "citations": draft.citations(),
                    "missing_information": draft.missing,
                    "verification": verification.as_dict(),
                }
            )
            drafted += 1

        lctr = [row for row in alert_json_rows if row["rule_id"] == "AML-FI-001"]
        eftr = [row for row in alert_json_rows if row["rule_id"] == "AML-FI-002"]
        customer_payload = []
        for customer in customers:
            rating = ratings[customer.id].as_dict()
            base = customer_json(customer)
            base.pop("kyc", None)
            customer_payload.append(
                {
                    **base,
                    "profile": _profile(customer),
                    "risk": rating,
                    "screening": screening.summarize(customer.name),
                }
            )

        anomaly_payload = [
            {
                "customer_id": row.customer_id,
                "customer_name": customer_rows[row.customer_id].name if row.customer_id in customer_rows else None,
                "customer_reference": customer_rows[row.customer_id].external_id if row.customer_id in customer_rows else None,
                "model_name": row.model_name,
                "model_version": row.model_version,
                "score": float(row.score),
                "features": row.features or {},
                "attributions": row.attributions or [],
                "computed_at": row.computed_at.isoformat(),
            }
            for row in anomalies
        ]

        tiers: dict[str, int] = defaultdict(int)
        for item in customer_payload:
            tiers[item["risk"]["tier"]] += 1

        def _rule_count(rule_id: str) -> int:
            return sum(1 for row in alert_json_rows if row["rule_id"] == rule_id)

        tuning = book_metrics.tuning_snapshot(session)
        catalogue = rules_engine.catalogue_summary()
        expectations = [item.as_dict() for item in dataset.expectations]
        performance = book_metrics.labelled_performance(
            expectations=expectations,
            alerts=alert_json_rows,
            customers=customer_payload,
            anomalies=anomaly_payload,
            rules=catalogue,
        )
        geo = book_metrics.geography(customer_payload, txn_json, alert_json_rows)
        filings = draft_filings.build_filings(
            reports=drafts,
            alerts=alert_json_rows,
            customers=customer_payload,
            transactions=txn_json,
        )
        entity_graph = knowledge_graph.build_graph(session, as_of=END)
        guidance = [passage.as_dict() for passage in retrieval.load_passages()]
        screening_hits = [
            {
                "customer_id": item["id"],
                "customer_reference": item["customer_id"],
                "customer_name": item["name"],
                "hits": item["screening"]["hits"],
            }
            for item in customer_payload
            if item["screening"]["hits"]
        ]

        snapshot = {
            "meta": {
                "product": "FINTRAC Sentinel",
                "version": settings.version,
                "as_of": END.isoformat(),
                "seed": SEED,
                "customers_requested": CUSTOMERS,
                "days": DAYS,
                "catalogue_version": rules_engine.load_catalogue().catalogue_version,
                "screening_list": screening.list_meta(),
                "disclaimer": (
                    "Every customer, wallet and transaction in this snapshot is synthetic. "
                    "Nothing here is filed with FINTRAC. Indicators are not findings that "
                    "money laundering occurred."
                ),
                "counts": {
                    "customers": len(customer_payload),
                    "transactions": len(txn_json),
                    "alerts": len(alert_json_rows),
                    "cases": len(case_rows),
                    "lvctr": len(events),
                    "lctr": len(lctr),
                    "eftr": len(eftr),
                    "str_drafts": len(drafts),
                    "filings": len(filings),
                    "sanctions": _rule_count("AML-SC-001"),
                    "pep": _rule_count("AML-SC-002"),
                    "tpr": _rule_count("AML-TF-001"),
                    "travel": _rule_count("AML-TR-001"),
                    "trade": _rule_count("AML-TB-001"),
                    "msb": _rule_count("AML-TB-002"),
                    "casino": _rule_count("AML-TB-003"),
                    "screening_hits": len(screening_hits),
                    "graph_nodes": len(entity_graph["nodes"]),
                    "graph_edges": len(entity_graph["edges"]),
                    "guidance": len(guidance),
                },
            },
            "kpis": {
                "transactions": len(txn_json),
                "alerts": len(alert_json_rows),
                "cases": len(case_rows),
                "lvctr": len(events),
                "lctr": len(lctr),
                "eftr": len(eftr),
                "str_drafts": len(drafts),
                "filings": len(filings),
                "sanctions": _rule_count("AML-SC-001"),
                "pep": _rule_count("AML-SC-002"),
                "tpr": _rule_count("AML-TF-001"),
                "travel": _rule_count("AML-TR-001"),
                "high_residual": sum(1 for item in customer_payload if item["risk"]["tier"] in {"HIGH", "CRITICAL"}),
                "tiers": dict(tiers),
                "rules": [{"rule_id": rule_id, "count": count} for rule_id, count in sorted(rule_counts.items(), key=lambda item: -item[1])],
            },
            "series": series,
            "rules": rules_engine.catalogue_summary(),
            "scenarios": expectations,
            "screening_hits": screening_hits,
            "tuning": tuning,
            "performance": performance,
            "geography": geo,
            "filings": filings,
            "knowledge_graph": entity_graph,
            "guidance": guidance,
            "customers": customer_payload,
            "transactions": txn_json,
            "alerts": alert_json_rows,
            "cases": case_rows,
            "obligations": {
                "lvctr": [aggregation_json(event) | {"customer_name": customer_rows[event.customer_id].name if event.customer_id in customer_rows else None} for event in events],
                "lctr": lctr,
                "eftr": eftr,
            },
            "anomaly": anomaly_payload,
            "network": {"nodes": nodes, "edges": edges},
            "links": links,
            "reports": drafts,
        }
        return snapshot


def main() -> None:
    snapshot = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(snapshot, separators=(",", ":")), encoding="utf-8")
    size = OUT.stat().st_size
    counts = snapshot["meta"]["counts"]
    print(f"wrote {OUT} ({size / 1_000_000:.2f} MB)")
    print(counts)


if __name__ == "__main__":
    main()
