"""Alerts, aggregation events, the rule catalogue and pipeline control."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select

from ..config import SERVERLESS
from ..deps import SessionDep, UserDep, require
from ..models import AggregationEvent, Alert, AlertStatus, AnomalyScore, Transaction, User
from ..schemas import AssignRequest, ReasonRequest
from ..serializers import aggregation_json, alert_json, customer_map
from ..services import aggregation as aggregation_service
from ..services import anomaly, case_service, pipeline, rules_engine

router = APIRouter(prefix="/api", tags=["detection"])


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------


@router.get("/alerts")
def list_alerts(
    session: SessionDep,
    _: UserDep,
    status_filter: AlertStatus | None = Query(None, alias="status"),
    rule_id: str | None = None,
    customer_id: int | None = None,
    unlinked_only: bool = False,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict:
    stmt = select(Alert)
    if status_filter:
        stmt = stmt.where(Alert.status == status_filter)
    if rule_id:
        stmt = stmt.where(Alert.rule_id == rule_id)
    if customer_id:
        stmt = stmt.where(Alert.customer_id == customer_id)
    if unlinked_only:
        stmt = stmt.where(Alert.case_id.is_(None))
    total = session.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = (
        session.execute(stmt.order_by(Alert.occurred_at.desc()).limit(limit).offset(offset)).scalars().all()
    )
    customers = customer_map(session, [a.customer_id for a in rows])
    return {
        "total": total,
        "alerts": [alert_json(a, customer=customers.get(a.customer_id)) for a in rows],
    }


@router.get("/alerts/{alert_id}")
def get_alert(alert_id: int, session: SessionDep, _: UserDep) -> dict:
    alert = session.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "alert not found")
    customers = customer_map(session, [alert.customer_id])
    return alert_json(alert, customer=customers.get(alert.customer_id))


@router.post("/alerts/{alert_id}/assign")
def assign_alert(
    alert_id: int,
    body: AssignRequest,
    session: SessionDep,
    actor: User = Depends(require("alert:triage")),
) -> dict:
    alert = session.get(Alert, alert_id)
    assignee = session.get(User, body.assignee_id)
    if alert is None or assignee is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "alert or assignee not found")
    case_service.assign_alert(session, alert, assignee, actor)
    session.commit()
    return alert_json(alert)


@router.post("/alerts/{alert_id}/dismiss")
def dismiss_alert(
    alert_id: int,
    body: ReasonRequest,
    session: SessionDep,
    actor: User = Depends(require("alert:triage")),
) -> dict:
    alert = session.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "alert not found")
    try:
        case_service.dismiss_alert(session, alert, actor, body.reason)
    except case_service.CaseError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    session.commit()
    return alert_json(alert)


@router.post("/alerts/{alert_id}/escalate")
def escalate_alert(
    alert_id: int,
    body: ReasonRequest,
    session: SessionDep,
    actor: User = Depends(require("case:escalate")),
) -> dict:
    """Promote an alert into a case for full investigation."""
    from ..models import Customer
    from ..services import risk

    alert = session.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "alert not found")
    customer = session.get(Customer, alert.customer_id)
    live = list(
        session.execute(
            select(Alert).where(Alert.customer_id == alert.customer_id, Alert.status != AlertStatus.DISMISSED)
        )
        .scalars()
        .all()
    )
    assessment = risk.assess(live)
    case, _created = case_service.open_case_for(session, customer, live, assessment, actor=actor)
    alert.status = AlertStatus.ESCALATED
    case_service.add_note(session, case, actor, f"Escalated from alert {alert.id}: {body.reason}", "ESCALATION")
    session.commit()
    return {"alert": alert_json(alert), "case_id": case.id, "case_reference": case.reference}


# ---------------------------------------------------------------------------
# Aggregation events (LVCTR candidates)
# ---------------------------------------------------------------------------


@router.get("/aggregation-events")
def list_aggregation_events(
    session: SessionDep,
    _: UserDep,
    open_only: bool = True,
    customer_id: int | None = None,
    limit: int = Query(200, ge=1, le=1000),
) -> dict:
    stmt = select(AggregationEvent)
    if open_only:
        stmt = stmt.where(AggregationEvent.reported.is_(False))
    if customer_id:
        stmt = stmt.where(AggregationEvent.customer_id == customer_id)
    rows = session.execute(stmt.order_by(AggregationEvent.due_at).limit(limit)).scalars().all()
    customers = customer_map(session, [e.customer_id for e in rows])
    payload = []
    for event in rows:
        item = aggregation_json(event)
        customer = customers.get(event.customer_id)
        item["customer_name"] = customer.name if customer else None
        item["customer_reference"] = customer.external_id if customer else None
        payload.append(item)
    return {"events": payload}


@router.get("/aggregation-events/{event_id}")
def get_aggregation_event(event_id: int, session: SessionDep, _: UserDep) -> dict:
    from ..models import Transaction
    from ..serializers import transaction_json

    event = session.get(AggregationEvent, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "aggregation event not found")
    txns = (
        session.execute(
            select(Transaction)
            .where(Transaction.id.in_(event.covered_txn_ids or []))
            .order_by(Transaction.occurred_at)
        )
        .scalars()
        .all()
    )
    customers = customer_map(session, [t.customer_id for t in txns])
    return {
        "event": aggregation_json(event),
        "aggregation_type_code": aggregation_service.aggregation_type_code(event.group_type),
        "transactions": [transaction_json(t, customer=customers.get(t.customer_id)) for t in txns],
    }


# ---------------------------------------------------------------------------
# Rules and models
# ---------------------------------------------------------------------------


@router.get("/rules")
def list_rules(_: UserDep) -> dict:
    catalogue = rules_engine.load_catalogue()
    return {"catalogue_version": catalogue.catalogue_version, "rules": rules_engine.catalogue_summary()}


@router.get("/anomaly-scores")
def list_anomaly_scores(session: SessionDep, _: UserDep, limit: int = Query(50, ge=1, le=500)) -> dict:
    rows = (
        session.execute(select(AnomalyScore).order_by(AnomalyScore.computed_at.desc(), AnomalyScore.score.desc()).limit(limit))
        .scalars()
        .all()
    )
    customers = customer_map(session, [r.customer_id for r in rows])
    return {
        "scores": [
            {
                "customer_id": r.customer_id,
                "customer_name": customers[r.customer_id].name if r.customer_id in customers else None,
                "model_name": r.model_name,
                "model_version": r.model_version,
                "score": float(r.score),
                "attributions": r.attributions or [],
                "features": r.features or {},
                "computed_at": r.computed_at.isoformat() + "Z",
            }
            for r in rows
        ]
    }


#: Above this many transactions a full re-run will not finish inside a
#: serverless function's timeout. It is refused rather than started, because a
#: run killed at 60 seconds rolls back everything and looks like a silent
#: failure.
SERVERLESS_PIPELINE_LIMIT = 250


@router.post("/pipeline/run")
def run_pipeline(
    session: SessionDep,
    with_anomaly: bool = True,
    actor: User = Depends(require("pipeline:run")),
) -> dict:
    if SERVERLESS:
        total = session.execute(select(func.count(Transaction.id))).scalar_one()
        if total > SERVERLESS_PIPELINE_LIMIT:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"A full re-run over {total:,} transactions will not complete inside this "
                f"platform's function timeout, and a run that is killed part-way rolls back. "
                f"Run it against this deployment's database from a machine without a request "
                f"deadline: DATABASE_URL=<url> python -m scripts.seed --no-reset. "
                f"Incremental detection on newly ingested transactions runs inline and is "
                f"unaffected.",
            )
    summary = pipeline.run(session, with_anomaly=with_anomaly)
    session.commit()
    return summary


@router.get("/customer-risk")
def list_customer_risk(session: SessionDep, _: UserDep) -> dict:
    from ..models import Customer
    from ..services import customer_risk

    ratings = customer_risk.assess_all(session)
    customers = {row.id: row for row in session.execute(select(Customer)).scalars().all()}
    payload = []
    for rating in ratings:
        item = rating.as_dict()
        customer = customers.get(rating.customer_id)
        item["name"] = customer.name if customer else None
        item["reference"] = customer.external_id if customer else None
        item["kyc_risk"] = customer.kyc_risk if customer else None
        payload.append(item)
    payload.sort(key=lambda item: (-item["residual"], item["name"] or ""))
    return {"customers": payload}


@router.get("/customer-risk/{customer_id}")
def get_customer_risk(customer_id: int, session: SessionDep, _: UserDep) -> dict:
    from ..models import Customer
    from ..services import customer_risk

    customer = session.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "customer not found")
    rating = customer_risk.assess_customer(session, customer)
    payload = rating.as_dict()
    payload["name"] = customer.name
    payload["reference"] = customer.external_id
    payload["kyc_risk"] = customer.kyc_risk
    payload["country"] = customer.country
    payload["occupation_or_business"] = customer.occupation_or_business
    return payload


@router.get("/links")
def list_links(session: SessionDep, _: UserDep) -> dict:
    from ..services import link_analysis

    return link_analysis.analyze(session)


@router.post("/anomaly/run")
def run_anomaly(session: SessionDep, actor: User = Depends(require("pipeline:run"))) -> dict:
    results = anomaly.run(session)
    session.commit()
    ranked = sorted(results.values(), key=lambda r: -r.score)[:20]
    return {"scored": len(results), "top": [r.as_dict() for r in ranked]}
