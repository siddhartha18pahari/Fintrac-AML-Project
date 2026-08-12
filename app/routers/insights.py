"""Dashboard, graph exploration, audit trail and demo seeding."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select

from ..audit import verify_chain
from ..config import settings
from ..deps import SessionDep, UserDep, require
from ..models import (
    AggregationEvent,
    Alert,
    AlertStatus,
    AuditEvent,
    Case,
    CaseStatus,
    Customer,
    Report,
    ReportStatus,
    Transaction,
    User,
)
from ..schemas import SeedRequest
from ..services import case_service, graph_engine
from ..util import cad, iso, utcnow

router = APIRouter(prefix="/api", tags=["insights"])


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


@router.get("/dashboard")
def dashboard(session: SessionDep, _: UserDep) -> dict:
    now = utcnow()
    open_states = [CaseStatus.ARCHIVED, CaseStatus.FILED, CaseStatus.CLOSED_NO_FILING]

    open_cases = session.execute(
        select(func.count(Case.id)).where(Case.status.not_in(open_states))
    ).scalar_one()
    high_risk = session.execute(
        select(func.count(Case.id)).where(
            Case.status.not_in(open_states), Case.risk_tier.in_(["HIGH", "CRITICAL"])
        )
    ).scalar_one()
    lvctr_candidates = session.execute(
        select(func.count(AggregationEvent.id)).where(
            AggregationEvent.threshold_met.is_(True), AggregationEvent.reported.is_(False)
        )
    ).scalar_one()
    str_reviews = session.execute(
        select(func.count(Case.id)).where(Case.str_candidate.is_(True), Case.status.not_in(open_states))
    ).scalar_one()
    due_48h = session.execute(
        select(func.count(Case.id)).where(
            Case.due_at.is_not(None),
            Case.due_at <= now + timedelta(hours=48),
            Case.status.not_in(open_states),
        )
    ).scalar_one()
    validation_failures = session.execute(
        select(func.count(Report.id)).where(Report.status.in_([ReportStatus.INVALID, ReportStatus.REJECTED]))
    ).scalar_one()

    tiers = dict(
        session.execute(
            select(Case.risk_tier, func.count(Case.id))
            .where(Case.status.not_in(open_states))
            .group_by(Case.risk_tier)
        ).all()
    )
    typologies = [
        {"rule_id": rule_id, "title": title, "count": count}
        for rule_id, title, count in session.execute(
            select(Alert.rule_id, func.min(Alert.title), func.count(Alert.id))
            .where(Alert.status != AlertStatus.DISMISSED)
            .group_by(Alert.rule_id)
            .order_by(func.count(Alert.id).desc())
        ).all()
    ]

    txn_count = session.execute(select(func.count(Transaction.id))).scalar_one()
    alert_count = session.execute(
        select(func.count(Alert.id)).where(Alert.status != AlertStatus.DISMISSED)
    ).scalar_one()
    case_count = session.execute(select(func.count(Case.id))).scalar_one()
    total_cad = session.execute(select(func.sum(Transaction.cad_value))).scalar_one() or 0

    overdue = case_service.overdue_cases(session)

    return {
        "generated_at": iso(now),
        "synthetic_data_only": settings.synthetic_data_only,
        "widgets": {
            "open_cases": open_cases,
            "high_risk_cases": high_risk,
            "lvctr_candidates": lvctr_candidates,
            "str_reviews_pending": str_reviews,
            "reports_due_48h": due_48h,
            "validation_failures": validation_failures,
            "overdue_cases": len(overdue),
        },
        "risk_distribution": {tier: tiers.get(tier, 0) for tier in ("LOW", "MEDIUM", "HIGH", "CRITICAL")},
        "typologies": typologies,
        "operational_metrics": _operational_metrics(txn_count, alert_count, case_count, high_risk),
        "volumes": {
            "transactions": txn_count,
            "total_cad": float(cad(total_cad)),
            "customers": session.execute(select(func.count(Customer.id))).scalar_one(),
            "alerts": alert_count,
            "cases": case_count,
        },
        "threshold": {
            "lvctr_threshold_cad": float(settings.lvctr_threshold_cad),
            "aggregation_window_hours": settings.aggregation_window_hours,
            "filing_deadline_working_days": settings.filing_deadline_working_days,
        },
    }


def _operational_metrics(txns: int, alerts: int, cases: int, high_risk: int) -> dict:
    """Metrics that connect detection to compliance operations.

    Precision/recall are meaningless without labels; these are not.  "Cases per
    1,000 transactions" is what determines whether an investigation team can
    actually absorb the output.
    """
    per_1000 = (cases / txns * 1000) if txns else 0.0
    alerts_per_1000 = (alerts / txns * 1000) if txns else 0.0
    hit_rate = (high_risk / cases * 100) if cases else 0.0
    return {
        "alerts_per_1000_transactions": round(alerts_per_1000, 2),
        "cases_per_1000_transactions": round(per_1000, 2),
        "high_risk_share_of_cases_pct": round(hit_rate, 1),
        "note": (
            "Volume metrics only. Precision and recall are not reported because this deployment has no "
            "adjudicated outcome labels; reporting them against synthetic scenario tags would overstate "
            "what the system knows."
        ),
    }


@router.get("/dashboard/workload")
def workload(session: SessionDep, _: UserDep) -> dict:
    rows = session.execute(
        select(Case.owner_id, func.count(Case.id))
        .where(Case.status.not_in([CaseStatus.ARCHIVED, CaseStatus.FILED, CaseStatus.CLOSED_NO_FILING]))
        .group_by(Case.owner_id)
    ).all()
    users = {u.id: u for u in session.execute(select(User)).scalars().all()}
    return {
        "workload": [
            {
                "owner_id": owner_id,
                "owner": users[owner_id].full_name if owner_id in users else "Unassigned",
                "open_cases": count,
            }
            for owner_id, count in rows
        ]
    }


# ---------------------------------------------------------------------------
# Graph
# ---------------------------------------------------------------------------


@router.get("/graph/wallets/{address}/neighbors")
def wallet_neighbours(
    address: str, session: SessionDep, _: UserDep, hops: int = Query(2, ge=1, le=4)
) -> dict:
    node = graph_engine.wallet_node(address)
    view = graph_engine.neighbourhood(session, node, hops=hops)
    if not view.graph.nodes:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "address not present in the transaction graph")
    return {
        "focus": node,
        "nodes": view.nodes_payload(),
        "edges": view.edges_payload(),
        "metrics": graph_engine.centrality_features(view, node),
    }


@router.get("/graph/customers/{customer_id}")
def customer_graph(
    customer_id: int, session: SessionDep, _: UserDep, hops: int = Query(2, ge=1, le=4)
) -> dict:
    node = graph_engine.customer_node(customer_id)
    view = graph_engine.neighbourhood(session, node, hops=hops)
    if not view.graph.nodes:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "customer has no graph presence")
    return {
        "focus": node,
        "nodes": view.nodes_payload(),
        "edges": view.edges_payload(),
        "metrics": graph_engine.centrality_features(view, node),
        "risky_neighbours": graph_engine.risky_neighbours(view, node),
    }


@router.get("/graph/patterns/{customer_id}")
def customer_patterns(session: SessionDep, customer_id: int, _: UserDep, hours: int = 72) -> dict:
    now = utcnow()
    return {
        "fan_in": _jsonable(graph_engine.fan_in(session, customer_id, end=now, hours=hours)),
        "fan_out": _jsonable(graph_engine.fan_out(session, customer_id, end=now, hours=hours)),
        "cycles": _jsonable(graph_engine.find_cycles(session, customer_id, end=now, hours=hours)),
        "shared_wallets": graph_engine.shared_wallets(session, customer_id, since=now - timedelta(days=30)),
    }


def _jsonable(value):
    from datetime import datetime
    from decimal import Decimal

    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return iso(value)
    return value


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------


@router.get("/audit")
def list_audit(
    session: SessionDep,
    object_type: str | None = None,
    object_id: str | None = None,
    action: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    _: User = Depends(require("audit:view")),
) -> dict:
    stmt = select(AuditEvent)
    if object_type:
        stmt = stmt.where(AuditEvent.object_type == object_type)
    if object_id:
        stmt = stmt.where(AuditEvent.object_id == str(object_id))
    if action:
        stmt = stmt.where(AuditEvent.action == action)
    total = session.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = session.execute(stmt.order_by(AuditEvent.id.desc()).limit(limit).offset(offset)).scalars().all()
    return {
        "total": total,
        "events": [
            {
                "id": e.id,
                "actor": e.actor_name,
                "actor_id": e.actor_id,
                "action": e.action,
                "object_type": e.object_type,
                "object_id": e.object_id,
                "before": e.before,
                "after": e.after,
                "reason": e.reason,
                "occurred_at": iso(e.occurred_at),
                "hash": e.hash,
            }
            for e in rows
        ],
    }


@router.get("/audit/verify")
def verify_audit(session: SessionDep, _: User = Depends(require("audit:view"))) -> dict:
    return verify_chain(session)


# ---------------------------------------------------------------------------
# Demo data
# ---------------------------------------------------------------------------


@router.post("/admin/seed")
def seed(body: SeedRequest, session: SessionDep, actor: User = Depends(require("admin"))) -> dict:
    """Regenerate the synthetic demo dataset.

    Refuses to run unless the deployment is flagged synthetic-only, so this can
    never be pointed at a book of real customers.
    """
    if not settings.synthetic_data_only:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Seeding is disabled because SYNTHETIC_DATA_ONLY is not set. This endpoint destroys data.",
        )
    try:
        # Imported lazily: scripts/ is a developer tool and is not shipped in
        # the serverless bundle.
        from scripts.seed import seed_everything
    except ImportError as exc:
        raise HTTPException(
            status.HTTP_501_NOT_IMPLEMENTED,
            "Seeding is not available in this deployment. A full seed generates and scores "
            "hundreds of transactions and takes minutes, which no serverless function timeout "
            "accommodates. Run it from a developer machine against this deployment's database: "
            "DATABASE_URL=<url> python -m scripts.seed. See docs/DEPLOY_VERCEL.md.",
        ) from exc

    summary = seed_everything(
        customers=body.customers,
        days=body.days,
        seed=body.seed,
        reset=body.reset,
        include_demo_case=body.include_demo_case,
    )
    return summary


@router.get("/config")
def config(_: UserDep) -> dict:
    """Non-secret configuration, surfaced so the UI never hard-codes thresholds."""
    return {
        "app": {"name": settings.app_name, "version": settings.version},
        "regulatory": {
            "lvctr_threshold_cad": float(settings.lvctr_threshold_cad),
            "aggregation_window_hours": settings.aggregation_window_hours,
            "filing_deadline_working_days": settings.filing_deadline_working_days,
        },
        "reporting_entity": {
            "legal_name": settings.entity.legal_name,
            "reporting_entity_number": settings.entity.reporting_entity_number,
            "activity_sector_code": settings.entity.activity_sector_code,
        },
        "valuation_methodology": settings.valuation_methodology_version,
        "submission_endpoint": settings.submission_endpoint,
        "synthetic_data_only": settings.synthetic_data_only,
        "risk_tiers": [{"min": lo, "max": hi, "tier": name} for lo, hi, name in settings.risk_tier_bounds],
    }
