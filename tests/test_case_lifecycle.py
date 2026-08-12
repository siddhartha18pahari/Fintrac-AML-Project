"""Case workflow, the human decision path, and the controls around it.

Each test here corresponds to a control that would be a finding in an audit if
it were missing, not to an implementation detail.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from app import audit
from app.models import AlertStatus, CaseStatus, Disposition, ReportType
from app.services import case_service, pipeline, report_builder
from app.services.mock_fintrac import SubmissionBlocked, submit
from conftest import NOW, receipt


@pytest.fixture()
def reportable_case(session, customer, users):
    """A case carrying a real LVCTR obligation."""
    base = NOW.replace(hour=9)
    for index, amount in enumerate(["3200", "2400", "3100", "2500", "4600", "5800"]):
        receipt(session, customer, cad=amount, at=base + timedelta(hours=index))
    pipeline.run(session, with_anomaly=False)
    session.commit()

    from sqlalchemy import select

    from app.models import Case

    case = session.execute(select(Case).where(Case.customer_id == customer.id)).scalars().first()
    assert case is not None and case.lvctr_required
    return case


# ---------------------------------------------------------------------------
# Controls
# ---------------------------------------------------------------------------


def test_a_reportable_case_cannot_be_closed_without_filing(session, reportable_case, users):
    """The threshold test is not a matter of judgement."""
    case_service.transition(session, reportable_case, CaseStatus.UNDER_REVIEW, users["senior"])
    with pytest.raises(case_service.CaseError, match="cannot be closed without filing"):
        case_service.transition(session, reportable_case, CaseStatus.CLOSED_NO_FILING, users["officer"])


def test_a_reportable_case_cannot_be_dispositioned_no_filing(session, reportable_case, users):
    with pytest.raises(case_service.CaseError, match="must include an LVCTR"):
        case_service.record_decision(
            session, reportable_case, users["officer"], Disposition.NO_FILING, "x" * 40
        )


def test_an_analyst_cannot_record_a_filing_decision(session, reportable_case, users):
    with pytest.raises(case_service.CaseError, match="cannot record a filing decision"):
        case_service.record_decision(
            session, reportable_case, users["analyst"], Disposition.LVCTR, "x" * 40
        )


def test_a_decision_requires_a_documented_rationale(session, reportable_case, users):
    with pytest.raises(case_service.CaseError, match="rationale"):
        case_service.record_decision(session, reportable_case, users["officer"], Disposition.LVCTR, "too short")


def test_the_case_owner_cannot_approve_their_own_decision(session, reportable_case, users):
    case_service.assign_case(session, reportable_case, users["officer"], users["officer"])
    case_service.record_decision(
        session, reportable_case, users["officer"], Disposition.LVCTR, "Aggregated receipts crossed the threshold." + " " * 5
    )
    with pytest.raises(case_service.CaseError, match="cannot approve their own"):
        case_service.approve_case(session, reportable_case, users["officer"])


def test_an_analyst_cannot_override_a_risk_score(session, reportable_case, users):
    with pytest.raises(case_service.CaseError, match="cannot override"):
        case_service.override_risk(session, reportable_case, users["analyst"], 10, "It looks fine to me really")


def test_an_override_preserves_the_engine_score(session, reportable_case, users):
    engine_score = reportable_case.risk_score
    case_service.override_risk(
        session, reportable_case, users["officer"], 20, "Customer produced invoices covering every receipt."
    )
    assert reportable_case.risk_score == engine_score, "the engine's own score must survive an override"
    assert reportable_case.overridden_score == 20
    assert case_service.effective_score(reportable_case) == 20


def test_invalid_status_transitions_are_refused(session, reportable_case, users):
    with pytest.raises(case_service.CaseError, match="Cannot move a case"):
        case_service.transition(session, reportable_case, CaseStatus.FILED, users["officer"])


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------


def test_alerts_are_deduplicated_across_reruns(session, customer, users):
    base = NOW.replace(hour=9)
    for index, amount in enumerate(["3200", "2400", "3100", "2500"]):
        receipt(session, customer, cad=amount, at=base + timedelta(hours=index))
    first = pipeline.run(session, with_anomaly=False)
    second = pipeline.run(session, with_anomaly=False)
    assert second["alerts_created"] == 0, "re-running detection must not multiply the alert population"
    assert first["alerts_created"] > 0


def test_dismissing_an_alert_requires_a_reason(session, customer, users):
    receipt(session, customer, cad="15000", at=NOW)
    pipeline.run(session, with_anomaly=False)
    from sqlalchemy import select

    from app.models import Alert

    alert = session.execute(select(Alert)).scalars().first()
    with pytest.raises(case_service.CaseError):
        case_service.dismiss_alert(session, alert, users["analyst"], "   ")
    case_service.dismiss_alert(session, alert, users["analyst"], "Verified payroll settlement.")
    assert alert.status is AlertStatus.DISMISSED


# ---------------------------------------------------------------------------
# Reporting and submission
# ---------------------------------------------------------------------------


def _approved(session, case, users):
    case_service.assign_case(session, case, users["senior"], users["officer"])
    case_service.transition(session, case, CaseStatus.UNDER_REVIEW, users["senior"])
    case_service.record_decision(
        session, case, users["officer"], Disposition.LVCTR,
        "Receipts aggregated past the reporting threshold within a 24-hour window.",
    )
    case_service.approve_case(session, case, users["approver"])
    return case


def test_an_unapproved_report_cannot_be_submitted(session, reportable_case, users):
    report = report_builder.build_report(session, reportable_case, ReportType.LVCTR, actor=users["officer"])
    with pytest.raises(SubmissionBlocked, match="approved"):
        submit(session, report, users["approver"])


def test_a_report_with_validation_errors_cannot_be_submitted(session, reportable_case, users):
    _approved(session, reportable_case, users)
    report = report_builder.build_report(session, reportable_case, ReportType.LVCTR, actor=users["officer"])
    report.validation = {**report.validation, "error_count": 3}
    session.flush()
    with pytest.raises(SubmissionBlocked, match="validation errors"):
        submit(session, report, users["approver"])


def test_approved_and_valid_report_submits_and_closes_the_obligation(session, reportable_case, users):
    _approved(session, reportable_case, users)
    report = report_builder.build_report(session, reportable_case, ReportType.LVCTR, actor=users["officer"])
    assert report.validation["error_count"] == 0, report.validation["issues"]

    submission = submit(session, report, users["approver"])
    assert submission.response_status == "accepted"
    assert reportable_case.status is CaseStatus.FILED

    from app.models import AggregationEvent

    for event_id in reportable_case.aggregation_event_ids:
        assert session.get(AggregationEvent, event_id).reported is True


def test_a_report_cannot_be_submitted_twice(session, reportable_case, users):
    _approved(session, reportable_case, users)
    report = report_builder.build_report(session, reportable_case, ReportType.LVCTR, actor=users["officer"])
    submit(session, report, users["approver"])
    with pytest.raises(SubmissionBlocked, match="already been submitted"):
        submit(session, report, users["approver"])


def test_a_submitted_report_cannot_be_rebuilt(session, reportable_case, users):
    _approved(session, reportable_case, users)
    report = report_builder.build_report(session, reportable_case, ReportType.LVCTR, actor=users["officer"])
    submit(session, report, users["approver"])
    with pytest.raises(report_builder.ReportBuildError, match="already been submitted"):
        report_builder.build_report(session, reportable_case, ReportType.LVCTR, actor=users["officer"])


def test_building_an_lvctr_without_an_obligation_is_refused(session, customer, users):
    receipt(session, customer, cad="500", at=NOW)
    pipeline.run(session, with_anomaly=False)
    case, _ = case_service.open_case_for(
        session, customer, [], __import__("app.services.risk", fromlist=["assess"]).assess([])
    )
    with pytest.raises(report_builder.ReportBuildError, match="nothing to report"):
        report_builder.build_report(session, case, ReportType.LVCTR, actor=users["officer"])


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------


def test_every_consequential_action_is_audited(session, reportable_case, users):
    _approved(session, reportable_case, users)
    report = report_builder.build_report(session, reportable_case, ReportType.LVCTR, actor=users["officer"])
    submit(session, report, users["approver"])

    from sqlalchemy import select

    from app.models import AuditEvent

    actions = {a for a in session.execute(select(AuditEvent.action)).scalars().all()}
    for expected in {
        "ALERT_RAISED", "CASE_OPENED", "CASE_ASSIGNED", "CASE_STATUS_CHANGED",
        "CASE_DECISION_RECORDED", "CASE_APPROVED", "REPORT_BUILT", "REPORT_SUBMITTED",
    }:
        assert expected in actions, f"{expected} was not recorded in the audit trail"


def test_the_audit_chain_verifies(session, reportable_case, users):
    _approved(session, reportable_case, users)
    session.commit()
    assert audit.verify_chain(session)["valid"] is True


def test_tampering_with_history_breaks_the_chain(session, reportable_case, users):
    _approved(session, reportable_case, users)
    session.commit()

    from sqlalchemy import select

    from app.models import AuditEvent

    victim = session.execute(select(AuditEvent).order_by(AuditEvent.id)).scalars().all()[2]
    victim.reason = "quietly rewritten"
    session.flush()

    result = audit.verify_chain(session)
    assert result["valid"] is False
    assert result["broken_at"] == victim.id
