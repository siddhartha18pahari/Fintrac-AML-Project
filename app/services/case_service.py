"""Alert triage, case lifecycle and the human decision path.

The controlling principle: *rules and models identify signals; a person decides
what to do about them.*  Nothing in this module files a report.  What it does is
make the decision explicit, attributable and reversible-with-a-reason.

One control is enforced rather than advisory: a case carrying an LVCTR
obligation cannot be dispositioned "no filing".  An LVCTR is threshold-driven,
not suspicion-driven, so closing one unfiled is a reporting breach, not a
judgement call.  An STR decision, by contrast, is always the investigator's.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit
from ..config import settings
from ..models import (
    AggregationEvent,
    Alert,
    AlertStatus,
    Case,
    CaseEvidence,
    CaseNote,
    CaseStatus,
    Customer,
    Disposition,
    Role,
    User,
)
from ..util import cad, iso, token_amount, utcnow
from .aggregation import filing_due_date
from .risk import RiskAssessment
from .rules_engine import Finding


class CaseError(Exception):
    """Raised when a requested transition or decision is not permitted."""


ALLOWED_TRANSITIONS: dict[CaseStatus, set[CaseStatus]] = {
    CaseStatus.NEW: {CaseStatus.TRIAGE, CaseStatus.UNDER_REVIEW, CaseStatus.CLOSED_NO_FILING},
    CaseStatus.TRIAGE: {CaseStatus.UNDER_REVIEW, CaseStatus.ESCALATED, CaseStatus.CLOSED_NO_FILING},
    CaseStatus.UNDER_REVIEW: {CaseStatus.ESCALATED, CaseStatus.DECISION, CaseStatus.CLOSED_NO_FILING},
    CaseStatus.ESCALATED: {CaseStatus.DECISION, CaseStatus.UNDER_REVIEW, CaseStatus.CLOSED_NO_FILING},
    CaseStatus.DECISION: {CaseStatus.APPROVED, CaseStatus.UNDER_REVIEW, CaseStatus.CLOSED_NO_FILING},
    CaseStatus.APPROVED: {CaseStatus.SUBMISSION_READY, CaseStatus.UNDER_REVIEW},
    CaseStatus.SUBMISSION_READY: {CaseStatus.FILED, CaseStatus.UNDER_REVIEW},
    CaseStatus.FILED: {CaseStatus.ARCHIVED},
    CaseStatus.CLOSED_NO_FILING: {CaseStatus.ARCHIVED, CaseStatus.UNDER_REVIEW},
    CaseStatus.ARCHIVED: set(),
}


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------


def upsert_alert(session: Session, customer_id: int, finding: Finding) -> tuple[Alert, bool]:
    """Create an alert, or fold the finding into the one that already covers it.

    Re-running detection over the same ledger must not multiply the alert
    population.  The rule declares its identity (see ``Rule.dedupe``): an exact
    evidence set for discrete observations, or the calendar day for window
    rules.  When a matching alert exists, it *absorbs* the new finding - taking
    the wider evidence set and the higher score - rather than sitting stale
    beside a near-duplicate.
    """
    key = finding.dedupe_key(customer_id)
    existing = session.execute(select(Alert).where(Alert.dedupe_key == key)).scalar_one_or_none()
    if existing is not None:
        merged = sorted(set(existing.evidence_txn_ids or []) | set(finding.evidence_txn_ids))
        changed = merged != (existing.evidence_txn_ids or []) or finding.points > existing.score_contribution
        if changed and existing.status != AlertStatus.DISMISSED:
            existing.evidence_txn_ids = merged
            if finding.points >= existing.score_contribution:
                existing.score_contribution = finding.points
                existing.explanation = finding.explanation()
                existing.title = finding.title
            existing.explanation = {**(existing.explanation or {}), "evidence_ids": merged}
            session.flush()
        return existing, False

    alert = Alert(
        customer_id=customer_id,
        rule_id=finding.rule.id,
        rule_version=finding.rule.version,
        title=finding.title,
        severity=finding.rule.severity,
        score_contribution=finding.points,
        explanation=finding.explanation(),
        evidence_txn_ids=list(finding.evidence_txn_ids),
        dedupe_key=key,
        occurred_at=finding.occurred_at or utcnow(),
    )
    session.add(alert)
    session.flush()
    audit.record(
        session,
        action="ALERT_RAISED",
        object_type="alert",
        object_id=alert.id,
        after={
            "rule_id": alert.rule_id,
            "rule_version": alert.rule_version,
            "score": alert.score_contribution,
            "customer_id": customer_id,
        },
    )
    return alert, True


def dismiss_alert(session: Session, alert: Alert, actor: User, reason: str) -> Alert:
    if not reason or not reason.strip():
        raise CaseError("A dismissal reason is required.")
    before = {"status": alert.status.value}
    alert.status = AlertStatus.DISMISSED
    session.flush()
    audit.record(
        session,
        action="ALERT_DISMISSED",
        object_type="alert",
        object_id=alert.id,
        actor_id=actor.id,
        actor_name=actor.username,
        before=before,
        after={"status": alert.status.value},
        reason=reason,
    )
    return alert


def assign_alert(session: Session, alert: Alert, assignee: User, actor: User) -> Alert:
    before = {"assigned_to": alert.assigned_to, "status": alert.status.value}
    alert.assigned_to = assignee.id
    if alert.status is AlertStatus.NEW:
        alert.status = AlertStatus.ASSIGNED
    session.flush()
    audit.record(
        session,
        action="ALERT_ASSIGNED",
        object_type="alert",
        object_id=alert.id,
        actor_id=actor.id,
        actor_name=actor.username,
        before=before,
        after={"assigned_to": assignee.id, "status": alert.status.value},
    )
    return alert


# ---------------------------------------------------------------------------
# Cases
# ---------------------------------------------------------------------------


def next_reference(session: Session) -> str:
    count = session.execute(select(func.count(Case.id))).scalar_one()
    return f"AML-{utcnow().year}-{count + 1:05d}"


def open_case_for(
    session: Session,
    customer: Customer,
    alerts: list[Alert],
    assessment: RiskAssessment,
    *,
    aggregation_events: list[AggregationEvent] | None = None,
    actor: User | None = None,
) -> tuple[Case, bool]:
    """Attach alerts to the customer's open case, opening one if needed.

    One open case per customer: an investigator reviews a *subject*, not a
    stream of disconnected alerts, and splitting the same behaviour across
    several cases is how context gets lost.
    """
    aggregation_events = aggregation_events or []
    case = session.execute(
        select(Case)
        .where(
            Case.customer_id == customer.id,
            Case.status.not_in([CaseStatus.ARCHIVED, CaseStatus.FILED, CaseStatus.CLOSED_NO_FILING]),
        )
        .order_by(Case.id.desc())
    ).scalars().first()

    created = False
    if case is None:
        case = Case(
            reference=next_reference(session),
            customer_id=customer.id,
            status=CaseStatus.NEW,
            opened_at=utcnow(),
        )
        session.add(case)
        session.flush()
        created = True

    case.risk_score = assessment.score
    case.risk_tier = assessment.tier
    case.risk_drivers = [d.as_dict() for d in assessment.drivers]
    case.priority = {"CRITICAL": "URGENT", "HIGH": "HIGH", "MEDIUM": "MEDIUM", "LOW": "LOW"}[assessment.tier]

    reportable = [e for e in aggregation_events if e.threshold_met]
    if reportable:
        case.lvctr_required = True
        case.aggregation_event_ids = sorted({*(case.aggregation_event_ids or []), *[e.id for e in reportable]})
        earliest = min(e.due_at or filing_due_date(e.window_end) for e in reportable)
        case.due_at = min(case.due_at, earliest) if case.due_at else earliest

    # An STR *candidate* flag means "a human must consider whether suspicion
    # exists", never "an STR will be filed".
    suspicion_drivers = [d for d in assessment.drivers if d.source == "rule" and d.key != "AML-VC-012"]
    if assessment.score >= settings.case_creation_score and suspicion_drivers:
        case.str_candidate = True

    for alert in alerts:
        if alert.case_id is None:
            alert.case_id = case.id
            alert.status = AlertStatus.LINKED_TO_CASE
        _ensure_evidence(session, case, "ALERT", str(alert.id), alert.title, {"rule_id": alert.rule_id})
        for txn_id in alert.evidence_txn_ids or []:
            _ensure_evidence(session, case, "TRANSACTION", str(txn_id), "", {})
    for event in reportable:
        _ensure_evidence(
            session,
            case,
            "AGGREGATION",
            str(event.id),
            f"{event.group_type.value} aggregation CAD {float(event.total_cad):,.2f}",
            {"covered_txn_ids": event.covered_txn_ids, "window_end": iso(event.window_end)},
        )

    session.flush()
    audit.record(
        session,
        action="CASE_OPENED" if created else "CASE_UPDATED",
        object_type="case",
        object_id=case.id,
        actor_id=actor.id if actor else None,
        actor_name=actor.username if actor else "system",
        after={
            "reference": case.reference,
            "risk_score": case.risk_score,
            "risk_tier": case.risk_tier,
            "lvctr_required": case.lvctr_required,
            "str_candidate": case.str_candidate,
            "due_at": iso(case.due_at),
        },
    )
    return case, created


def _ensure_evidence(
    session: Session, case: Case, evidence_type: str, evidence_id: str, label: str, payload: dict
) -> None:
    # Sessions run with autoflush off, so a pending row from an earlier
    # iteration would be invisible to this SELECT.  Flush after each insert so
    # the guard actually guards; the unique constraint on the table is the
    # backstop.
    exists = session.execute(
        select(CaseEvidence.id).where(
            CaseEvidence.case_id == case.id,
            CaseEvidence.evidence_type == evidence_type,
            CaseEvidence.evidence_id == evidence_id,
        )
    ).first()
    if exists is not None:
        return
    session.add(
        CaseEvidence(
            case_id=case.id,
            evidence_type=evidence_type,
            evidence_id=evidence_id,
            label=label,
            payload=payload,
        )
    )
    session.flush()


def transition(session: Session, case: Case, target: CaseStatus, actor: User, reason: str | None = None) -> Case:
    if target not in ALLOWED_TRANSITIONS[case.status]:
        raise CaseError(f"Cannot move a case from {case.status.value} to {target.value}.")
    if target is CaseStatus.CLOSED_NO_FILING and case.lvctr_required:
        raise CaseError(
            "This case carries an LVCTR reporting obligation and cannot be closed without filing. "
            "The threshold test is not a matter of judgement."
        )
    before = {"status": case.status.value}
    case.status = target
    if target in {CaseStatus.CLOSED_NO_FILING, CaseStatus.FILED, CaseStatus.ARCHIVED}:
        case.closed_at = case.closed_at or utcnow()
    session.flush()
    audit.record(
        session,
        action="CASE_STATUS_CHANGED",
        object_type="case",
        object_id=case.id,
        actor_id=actor.id,
        actor_name=actor.username,
        before=before,
        after={"status": case.status.value},
        reason=reason,
    )
    return case


def assign_case(session: Session, case: Case, assignee: User, actor: User) -> Case:
    before = {"owner_id": case.owner_id}
    case.owner_id = assignee.id
    if case.status is CaseStatus.NEW:
        case.status = CaseStatus.TRIAGE
    session.flush()
    audit.record(
        session,
        action="CASE_ASSIGNED",
        object_type="case",
        object_id=case.id,
        actor_id=actor.id,
        actor_name=actor.username,
        before=before,
        after={"owner_id": assignee.id, "status": case.status.value},
    )
    return case


def add_note(session: Session, case: Case, actor: User, body: str, note_type: str = "OBSERVATION") -> CaseNote:
    if not body.strip():
        raise CaseError("A note cannot be empty.")
    note = CaseNote(case_id=case.id, author_id=actor.id, body=body.strip(), note_type=note_type)
    session.add(note)
    session.flush()
    audit.record(
        session,
        action="CASE_NOTE_ADDED",
        object_type="case",
        object_id=case.id,
        actor_id=actor.id,
        actor_name=actor.username,
        after={"note_id": note.id, "note_type": note_type, "length": len(note.body)},
    )
    return note


def override_risk(session: Session, case: Case, actor: User, new_score: int, reason: str) -> Case:
    """Record a human override of the computed score.

    The computed score is preserved; the override sits alongside it with an
    attributable reason.  Model governance depends on being able to measure how
    often, and in which direction, humans disagree with the engine.
    """
    if actor.role not in {Role.SENIOR_ANALYST, Role.COMPLIANCE_OFFICER, Role.ADMINISTRATOR}:
        raise CaseError("Your role cannot override a risk score.")
    if not reason or len(reason.strip()) < 10:
        raise CaseError("An override requires a substantive reason (at least 10 characters).")
    if not 0 <= new_score <= 100:
        raise CaseError("Score must be between 0 and 100.")
    before = {"risk_score": case.risk_score, "overridden_score": case.overridden_score}
    case.overridden_score = new_score
    case.override_reason = reason.strip()
    case.override_by = actor.id
    case.risk_tier = settings.risk_tier(new_score)
    session.flush()
    audit.record(
        session,
        action="CASE_RISK_OVERRIDDEN",
        object_type="case",
        object_id=case.id,
        actor_id=actor.id,
        actor_name=actor.username,
        before=before,
        after={"overridden_score": new_score, "model_score": case.risk_score, "risk_tier": case.risk_tier},
        reason=reason.strip(),
    )
    return case


def record_decision(
    session: Session,
    case: Case,
    actor: User,
    disposition: Disposition,
    rationale: str,
) -> Case:
    if actor.role not in {Role.SENIOR_ANALYST, Role.COMPLIANCE_OFFICER, Role.ADMINISTRATOR}:
        raise CaseError("Your role cannot record a filing decision.")
    if not rationale or len(rationale.strip()) < 20:
        raise CaseError("A documented rationale of at least 20 characters is required.")
    if case.lvctr_required and disposition in {Disposition.NO_FILING, Disposition.STR}:
        raise CaseError(
            "This case reached the LVCTR reporting threshold, so any disposition must include an LVCTR."
        )
    before = {"disposition": case.disposition.value if case.disposition else None, "status": case.status.value}
    case.disposition = disposition
    case.disposition_rationale = rationale.strip()
    if case.status in {CaseStatus.NEW, CaseStatus.TRIAGE, CaseStatus.UNDER_REVIEW, CaseStatus.ESCALATED}:
        case.status = CaseStatus.DECISION
    session.flush()
    audit.record(
        session,
        action="CASE_DECISION_RECORDED",
        object_type="case",
        object_id=case.id,
        actor_id=actor.id,
        actor_name=actor.username,
        before=before,
        after={"disposition": disposition.value, "status": case.status.value},
        reason=rationale.strip(),
    )
    return case


def approve_case(session: Session, case: Case, actor: User, reason: str | None = None) -> Case:
    """Four-eyes approval: the approver must not be the decision maker."""
    if actor.role not in {Role.APPROVER, Role.COMPLIANCE_OFFICER, Role.ADMINISTRATOR}:
        raise CaseError("Your role cannot approve a case for filing.")
    if case.disposition is None:
        raise CaseError("Record a filing decision before approving the case.")
    if case.owner_id is not None and case.owner_id == actor.id:
        raise CaseError("The case owner cannot approve their own filing decision.")
    if case.status is not CaseStatus.DECISION:
        raise CaseError(f"Only a case in DECISION can be approved (this one is {case.status.value}).")
    case.approved_by = actor.id
    case.approved_at = utcnow()
    case.status = CaseStatus.APPROVED
    session.flush()
    audit.record(
        session,
        action="CASE_APPROVED",
        object_type="case",
        object_id=case.id,
        actor_id=actor.id,
        actor_name=actor.username,
        after={"disposition": case.disposition.value, "approved_at": iso(case.approved_at)},
        reason=reason,
    )
    return case


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------


def effective_score(case: Case) -> int:
    return case.overridden_score if case.overridden_score is not None else case.risk_score


def case_timeline(session: Session, case: Case) -> list[dict]:
    """Chronological receipts and dispositions attached to the case."""
    from ..models import Transaction  # local import avoids a cycle at module load

    txn_ids = [int(e.evidence_id) for e in case.evidence if e.evidence_type == "TRANSACTION"]
    if not txn_ids:
        return []
    rows = (
        session.execute(
            select(Transaction).where(Transaction.id.in_(txn_ids)).order_by(Transaction.occurred_at)
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": t.id,
            "external_id": t.external_id,
            "occurred_at": iso(t.occurred_at),
            "direction": t.direction.value,
            "asset": t.asset,
            "asset_amount": token_amount(t.asset_amount),
            "cad_value": float(cad(Decimal(str(t.cad_value)))),
            "wallet_from": t.wallet_from,
            "wallet_to": t.wallet_to,
            "tx_hash": t.tx_hash,
        }
        for t in rows
    ]


def overdue_cases(session: Session, *, at: datetime | None = None) -> list[Case]:
    at = at or utcnow()
    return list(
        session.execute(
            select(Case)
            .where(
                Case.due_at.is_not(None),
                Case.due_at < at,
                Case.status.not_in([CaseStatus.FILED, CaseStatus.ARCHIVED, CaseStatus.CLOSED_NO_FILING]),
            )
            .order_by(Case.due_at)
        )
        .scalars()
        .all()
    )
