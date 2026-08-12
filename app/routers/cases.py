"""Case management: the investigator's workflow."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select

from ..deps import SessionDep, UserDep, require
from ..models import AggregationEvent, Alert, AlertStatus, Case, CaseStatus, Customer, Report, User
from ..schemas import (
    AssignRequest,
    DecisionRequest,
    NoteRequest,
    OverrideRequest,
    StatusRequest,
)
from ..serializers import alert_json, case_json, customer_map, report_json
from ..services import aggregation as aggregation_service
from ..services import case_service, graph_engine, str_copilot
from ..serializers import aggregation_json

router = APIRouter(prefix="/api/cases", tags=["cases"])


@router.get("")
def list_cases(
    session: SessionDep,
    _: UserDep,
    status_filter: CaseStatus | None = Query(None, alias="status"),
    owner_id: int | None = None,
    tier: str | None = None,
    open_only: bool = False,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict:
    stmt = select(Case)
    if status_filter:
        stmt = stmt.where(Case.status == status_filter)
    if owner_id:
        stmt = stmt.where(Case.owner_id == owner_id)
    if tier:
        stmt = stmt.where(Case.risk_tier == tier.upper())
    if open_only:
        stmt = stmt.where(Case.status.not_in([CaseStatus.ARCHIVED, CaseStatus.FILED, CaseStatus.CLOSED_NO_FILING]))
    total = session.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = (
        session.execute(stmt.order_by(Case.risk_score.desc(), Case.id.desc()).limit(limit).offset(offset))
        .scalars()
        .all()
    )
    customers = customer_map(session, [c.customer_id for c in rows])
    return {"total": total, "cases": [case_json(c, customer=customers.get(c.customer_id)) for c in rows]}


def _load(session, case_id: int) -> Case:
    case = session.get(Case, case_id)
    if case is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "case not found")
    return case


# NOTE: the /queues/* routes are declared before /{case_id} on purpose - FastAPI
# matches in declaration order, and "queues" would otherwise be parsed as an int
# path parameter and 422.


@router.get("/queues/overdue")
def overdue(session: SessionDep, _: UserDep) -> dict:
    rows = case_service.overdue_cases(session)
    customers = customer_map(session, [c.customer_id for c in rows])
    return {"cases": [case_json(c, customer=customers.get(c.customer_id)) for c in rows]}


@router.get("/queues/due-soon")
def due_soon(session: SessionDep, _: UserDep, hours: int = Query(48, ge=1, le=720)) -> dict:
    events = aggregation_service.events_due_within(session, hours)
    customers = customer_map(session, [e.customer_id for e in events])
    payload = []
    for event in events:
        item = aggregation_json(event)
        customer = customers.get(event.customer_id)
        item["customer_name"] = customer.name if customer else None
        payload.append(item)
    return {"hours": hours, "events": payload}


@router.get("/{case_id}")
def get_case(case_id: int, session: SessionDep, _: UserDep) -> dict:
    case = _load(session, case_id)
    customer = session.get(Customer, case.customer_id)
    alerts = (
        session.execute(select(Alert).where(Alert.case_id == case.id).order_by(Alert.occurred_at))
        .scalars()
        .all()
    )
    reports = session.execute(select(Report).where(Report.case_id == case.id)).scalars().all()
    events = [
        aggregation_json(e)
        for e in session.execute(
            select(AggregationEvent).where(AggregationEvent.id.in_(case.aggregation_event_ids or []))
        )
        .scalars()
        .all()
    ]
    return {
        "case": case_json(case, customer=customer, detail=True),
        "customer": {
            "id": customer.id,
            "customer_id": customer.external_id,
            "name": customer.name,
            "customer_type": customer.customer_type.value,
            "country": customer.country,
            "kyc_risk": customer.kyc_risk,
            "occupation_or_business": customer.occupation_or_business,
            "expected_monthly_volume_cad": float(customer.expected_monthly_volume_cad or 0),
        },
        "alerts": [alert_json(a) for a in alerts],
        "aggregation_events": events,
        "timeline": case_service.case_timeline(session, case),
        "reports": [report_json(r) for r in reports],
        "due_in_hours": _hours_until(case),
    }


def _hours_until(case: Case) -> float | None:
    from ..util import utcnow

    if case.due_at is None:
        return None
    return round((case.due_at - utcnow()).total_seconds() / 3600, 1)


@router.get("/{case_id}/graph")
def case_graph(case_id: int, session: SessionDep, _: UserDep, hops: int = Query(2, ge=1, le=4)) -> dict:
    case = _load(session, case_id)
    view = graph_engine.neighbourhood(session, graph_engine.customer_node(case.customer_id), hops=hops)
    node = graph_engine.customer_node(case.customer_id)
    return {
        "focus": node,
        "nodes": view.nodes_payload(),
        "edges": view.edges_payload(),
        "metrics": graph_engine.centrality_features(view, node),
        "risky_neighbours": graph_engine.risky_neighbours(view, node),
    }


@router.post("/{case_id}/assign")
def assign_case(
    case_id: int,
    body: AssignRequest,
    session: SessionDep,
    actor: User = Depends(require("case:assign")),
) -> dict:
    case = _load(session, case_id)
    assignee = session.get(User, body.assignee_id)
    if assignee is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "assignee not found")
    case_service.assign_case(session, case, assignee, actor)
    session.commit()
    return case_json(case)


@router.post("/{case_id}/notes")
def add_note(
    case_id: int,
    body: NoteRequest,
    session: SessionDep,
    actor: User = Depends(require("case:note")),
) -> dict:
    case = _load(session, case_id)
    try:
        note = case_service.add_note(session, case, actor, body.body, body.note_type)
    except case_service.CaseError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    session.commit()
    return {"id": note.id, "body": note.body, "note_type": note.note_type}


@router.post("/{case_id}/status")
def change_status(
    case_id: int,
    body: StatusRequest,
    session: SessionDep,
    actor: User = Depends(require("case:escalate")),
) -> dict:
    case = _load(session, case_id)
    try:
        target = CaseStatus(body.status.upper())
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unknown status {body.status!r}") from exc
    try:
        case_service.transition(session, case, target, actor, body.reason)
    except case_service.CaseError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    session.commit()
    return case_json(case)


@router.post("/{case_id}/override")
def override_risk(
    case_id: int,
    body: OverrideRequest,
    session: SessionDep,
    actor: User = Depends(require("case:override_risk")),
) -> dict:
    case = _load(session, case_id)
    try:
        case_service.override_risk(session, case, actor, body.score, body.reason)
    except case_service.CaseError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    session.commit()
    return case_json(case, detail=True)


@router.post("/{case_id}/decision")
def record_decision(
    case_id: int,
    body: DecisionRequest,
    session: SessionDep,
    actor: User = Depends(require("case:decide")),
) -> dict:
    case = _load(session, case_id)
    try:
        case_service.record_decision(session, case, actor, body.disposition, body.rationale)
    except case_service.CaseError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    session.commit()
    return case_json(case, detail=True)


@router.post("/{case_id}/approve")
def approve_case(
    case_id: int,
    session: SessionDep,
    actor: User = Depends(require("case:approve")),
) -> dict:
    case = _load(session, case_id)
    try:
        case_service.approve_case(session, case, actor)
    except case_service.CaseError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    session.commit()
    return case_json(case, detail=True)


@router.get("/{case_id}/str-draft")
def str_draft(case_id: int, session: SessionDep, _: UserDep) -> dict:
    """Generate an evidence-grounded STR narrative draft.

    The draft is returned with its verification verdict.  A draft that fails
    verification is still returned - hiding it would be worse - but it is
    plainly marked unsupported.
    """
    case = _load(session, case_id)
    draft, verification = str_copilot.draft_for_case(session, case)
    return {
        "case_reference": case.reference,
        **draft.as_dict(),
        "verification": verification.as_dict(),
        "disclaimer": (
            "Draft only. It is generated from case evidence and must be reviewed, corrected and "
            "approved by a person before any filing decision is made."
        ),
    }


@router.get("/{case_id}/alerts")
def case_alerts(case_id: int, session: SessionDep, _: UserDep) -> dict:
    _load(session, case_id)
    rows = (
        session.execute(
            select(Alert).where(Alert.case_id == case_id, Alert.status != AlertStatus.DISMISSED)
        )
        .scalars()
        .all()
    )
    return {"alerts": [alert_json(a) for a in rows]}
