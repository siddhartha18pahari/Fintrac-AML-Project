"""A mock regulatory submission endpoint, and the submission service.

This project **never** talks to FINTRAC.  Real submission requires an authorised
reporting entity, approved API credentials and an agreement this codebase is not
party to, so the endpoint here is a local stand-in that behaves like a strict
receiver: it applies its *own* validation rules (deliberately not the same code
as ``app.services.validation``, so it is a genuine second opinion), issues a
submission id, and returns itemised rejections.

``settings.submission_endpoint`` is a hard guard.  Anything other than ``mock``
raises rather than silently pointing a compliance system at an unknown host.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit
from ..config import settings
from ..models import Case, CaseStatus, Report, ReportStatus, ReportType, Submission, User
from ..util import iso, stable_hash, utcnow
from . import fintrac_mapper as fm
from . import validation

MOCK_ENDPOINT = "mock-fintrac://reports"

_NUMERIC_RE = re.compile(r"^\d+$")
_AMOUNT_RE = re.compile(r"^\d+(\.\d+)?$")


class SubmissionBlocked(Exception):
    """Raised when a local control refuses to let a report be submitted."""


@dataclass
class MockResponse:
    status: str
    submission_id: str | None
    validation_messages: list[dict]
    received_at: str

    def as_dict(self) -> dict:
        return {
            "status": self.status,
            "submission_id": self.submission_id,
            "validation_messages": self.validation_messages,
            "received_at": self.received_at,
            "endpoint": MOCK_ENDPOINT,
            "notice": "SIMULATED RECEIVER - this response did not come from FINTRAC.",
        }


# ---------------------------------------------------------------------------
# The receiver's own rules
# ---------------------------------------------------------------------------


def _check_lvctr(payload: dict, *, known_references: set[str]) -> list[dict]:
    messages: list[dict] = []

    def reject(field: str, code: str, message: str) -> None:
        messages.append({"field": field, "code": code, "message": message})

    entity_number = payload.get("reportingEntityNumber")
    if not entity_number or not _NUMERIC_RE.match(str(entity_number)):
        reject("reportingEntityNumber", "VAL-101", "Reporting entity number is missing or not numeric.")

    reference = payload.get("reportReference")
    if not reference:
        reject("reportReference", "VAL-102", "Report reference is required.")
    elif reference in known_references:
        reject(
            "reportReference",
            "VAL-103",
            f"Report reference '{reference}' has already been accepted for this reporting entity.",
        )

    details = payload.get("details") or {}
    if not _NUMERIC_RE.match(str(details.get("contactNumber", ""))):
        reject("details.contactNumber", "VAL-104", "Contact number is missing or not numeric.")
    if str(details.get("activitySectorCode", "")) not in fm.ACTIVITY_SECTOR:
        reject("details.activitySectorCode", "VAL-105", "Activity sector code is not recognised.")

    aggregation_code = details.get("twentyFourHourAggregationTypeCode")
    if aggregation_code and aggregation_code != "4":
        if not details.get("twentyFourHourStartDateTime") or not details.get("twentyFourHourEndDateTime"):
            reject(
                "details.twentyFourHourStartDateTime",
                "VAL-106",
                "A 24-hour aggregation type was declared without a complete aggregation window.",
            )

    index = fm.index_references(payload)
    for ref, path in index.used:
        if ref not in index.declared:
            reject(path, "VAL-107", f"Referenced subject '{ref}' does not exist.")

    transactions = payload.get("transactions") or []
    if not transactions:
        reject("transactions", "VAL-108", "At least one transaction is required.")

    horizon = utcnow() + timedelta(minutes=5)
    for index_, txn in enumerate(transactions):
        base = f"transactions[{index_}]"
        t_details = txn.get("details") or {}
        if not t_details.get("locationReference"):
            reject(f"{base}.details.locationReference", "VAL-109", "Location reference is required.")
        when = t_details.get("transactionDateTime")
        if when:
            try:
                from datetime import datetime

                if datetime.fromisoformat(when) > horizon:
                    reject(
                        f"{base}.details.transactionDateTime",
                        "VAL-110",
                        "Transaction date-time is in the future.",
                    )
            except ValueError:
                reject(f"{base}.details.transactionDateTime", "VAL-111", "Transaction date-time is unparsable.")

        for s_index, action in enumerate(txn.get("startingActions") or []):
            s_details = action.get("details") or {}
            if not s_details.get("sendingVirtualCurrencyAddresses"):
                reject(
                    f"{base}.startingActions[{s_index}].details.sendingVirtualCurrencyAddresses",
                    "VAL-112",
                    "At least one sending virtual currency address is required.",
                )
            rate = s_details.get("canadianExchangeRate")
            if rate is None or not _AMOUNT_RE.match(str(rate)):
                reject(
                    f"{base}.startingActions[{s_index}].details.canadianExchangeRate",
                    "VAL-113",
                    "Canadian exchange rate must be a positive decimal value.",
                )

        for c_index, action in enumerate(txn.get("completingActions") or []):
            c_details = action.get("details") or {}
            code = str(c_details.get("dispositionTypeCode", ""))
            if code not in fm.DISPOSITION:
                reject(
                    f"{base}.completingActions[{c_index}].details.dispositionTypeCode",
                    "VAL-114",
                    f"Disposition type code '{code}' is not recognised.",
                )
            amount = c_details.get("canadianEquivalentAmount")
            try:
                if amount is None or Decimal(str(amount)) <= 0:
                    raise InvalidOperation
            except (InvalidOperation, TypeError):
                reject(
                    f"{base}.completingActions[{c_index}].details.canadianEquivalentAmount",
                    "VAL-115",
                    "Canadian equivalent amount must be a positive decimal value.",
                )
    return messages


def _check_str(payload: dict) -> list[dict]:
    messages: list[dict] = []
    if not (payload.get("details_of_suspicion") or "").strip():
        messages.append(
            {
                "field": "details_of_suspicion",
                "code": "VAL-201",
                "message": "Details of suspicion are required.",
            }
        )
    if not payload.get("transactions"):
        messages.append(
            {"field": "transactions", "code": "VAL-202", "message": "At least one transaction is required."}
        )
    return messages


def receive(payload: dict, report_type: str, *, known_references: set[str] | None = None) -> MockResponse:
    """The mock receiver's handler.  Pure: same input, same verdict."""
    known_references = known_references or set()
    if report_type.upper() == ReportType.LVCTR.value:
        messages = _check_lvctr(payload, known_references=known_references)
    else:
        messages = _check_str(payload)

    now = utcnow()
    if messages:
        return MockResponse(status="rejected", submission_id=None, validation_messages=messages, received_at=iso(now))
    token = stable_hash(payload.get("reportReference") or payload.get("report_reference"), report_type)[:6].upper()
    return MockResponse(
        status="accepted",
        submission_id=f"MOCK-{now.year}-{token}",
        validation_messages=[],
        received_at=iso(now),
    )


# ---------------------------------------------------------------------------
# Submission service
# ---------------------------------------------------------------------------


def submit(session: Session, report: Report, actor: User) -> Submission:
    """Submit a report through the mock endpoint, enforcing local controls first.

    The controls below are the point of the exercise: a compliance system that
    lets an unvalidated, unapproved report leave the building is worse than no
    system, because it creates a record that says the review happened.
    """
    if settings.submission_endpoint != "mock":
        raise SubmissionBlocked(
            f"Refusing to submit: submission_endpoint is {settings.submission_endpoint!r}. "
            "This build only ever submits to its own mock receiver."
        )

    case = session.get(Case, report.case_id)
    if case is None:
        raise SubmissionBlocked("report is not attached to a case")
    if report.status in {ReportStatus.SUBMITTED, ReportStatus.ACCEPTED}:
        raise SubmissionBlocked(f"{report.report_reference} has already been submitted.")
    if case.status not in {CaseStatus.APPROVED, CaseStatus.SUBMISSION_READY}:
        raise SubmissionBlocked(
            f"The case must be approved before filing (it is currently {case.status.value})."
        )
    if case.approved_by is None:
        raise SubmissionBlocked("The case has no recorded approver.")
    if (report.validation or {}).get("error_count", 1) > 0:
        raise SubmissionBlocked(
            "The report has unresolved validation errors. Fix them and revalidate before filing."
        )

    known = {
        row
        for row in session.execute(
            select(Report.report_reference)
            .join(Submission, Submission.report_id == Report.id)
            .where(Submission.response_status == "accepted", Report.id != report.id)
        )
        .scalars()
        .all()
    }

    attempt = session.execute(
        select(func.count(Submission.id)).where(Submission.report_id == report.id)
    ).scalar_one()
    request_id = stable_hash(report.report_reference, attempt, report.id)[:16]

    response = receive(report.payload, report.report_type.value, known_references=known)

    submission = Submission(
        report_id=report.id,
        endpoint=MOCK_ENDPOINT,
        request_id=request_id,
        submitted_at=utcnow(),
        response_status=response.status,
        submission_id=response.submission_id,
        response=response.as_dict(),
        submitted_by=actor.id,
    )
    session.add(submission)

    # Level 5: the receiver's verdict is folded back into the report's own
    # validation record, so a rejection is visible in the same place as a local
    # error rather than only in a response blob.
    level5 = validation.validate_level5(response.as_dict())
    existing = report.validation or {"issues": []}
    existing["issues"] = [i for i in existing.get("issues", []) if i.get("level") != 5] + [
        i.as_dict() for i in level5
    ]
    existing["levels_run"] = sorted({*existing.get("levels_run", []), 5})
    existing["error_count"] = sum(1 for i in existing["issues"] if i["severity"] == "ERROR")
    existing["warning_count"] = sum(1 for i in existing["issues"] if i["severity"] == "WARNING")
    existing["valid"] = existing["error_count"] == 0
    report.validation = existing

    if response.status == "accepted":
        report.status = ReportStatus.ACCEPTED
        report.submitted_at = submission.submitted_at
        case.status = CaseStatus.FILED
        case.closed_at = case.closed_at or utcnow()
        for event_id in case.aggregation_event_ids or []:
            from ..models import AggregationEvent

            event = session.get(AggregationEvent, event_id)
            if event is not None:
                event.reported = True
                event.report_id = report.id
    else:
        report.status = ReportStatus.REJECTED

    session.flush()
    audit.record(
        session,
        action="REPORT_SUBMITTED",
        object_type="report",
        object_id=report.id,
        actor_id=actor.id,
        actor_name=actor.username,
        after={
            "endpoint": MOCK_ENDPOINT,
            "request_id": request_id,
            "response_status": response.status,
            "submission_id": response.submission_id,
            "rejections": len(response.validation_messages),
        },
    )
    return submission
