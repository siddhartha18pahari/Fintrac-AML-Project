"""Build canonical reports from a case, then render them for FINTRAC.

    case + evidence  ->  canonical report  ->  mapper  ->  FINTRAC payload
                                           ->  validator -> issues

The canonical body is what gets stored and reasoned about; the rendered payload
is a derived artefact.  Both are persisted on the report row so that a filing
can be reproduced exactly, including under a schema that has since changed.

Scope note: the LVCTR mapping is implemented in full against the 2021 JSON-LD
format reconstructed from the reference repository.  The STR path produces the
canonical body, the evidence-grounded narrative and a validated internal
structure, but does **not** claim a FINTRAC STR schema mapping - that schema was
not available to reconcile against, and inventing one would be worse than
declaring the gap.  See docs/FINTRAC_MAPPING.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..config import settings
from ..models import (
    AggregationEvent,
    Case,
    Customer,
    CustomerType,
    Direction,
    Party,
    Report,
    ReportStatus,
    ReportType,
    Transaction,
    User,
)
from ..util import cad, iso_local_naive, utcnow
from . import fintrac_mapper as fm
from . import validation
from .aggregation import aggregation_type_code

#: Deposit of virtual currency into a wallet held by the reporting entity.
DEFAULT_DISPOSITION_CODE = "17"
#: Online, which is what a dealer in virtual currency normally records.
DEFAULT_METHOD_CODE = "8"


class ReportBuildError(Exception):
    pass


# ---------------------------------------------------------------------------
# Subject construction
# ---------------------------------------------------------------------------


def _person_subject(ref: str, kyc: dict, *, name: str, country: str) -> dict:
    surname = kyc.get("surname") or (name.split()[-1] if name else "")
    given = kyc.get("given_name") or (name.split()[0] if name else "")
    return {
        "ref": ref,
        "kind": "person",
        "surname": surname,
        "given_name": given,
        "other_name": kyc.get("other_name"),
        "alias": kyc.get("alias"),
        "birth_date": kyc.get("birth_date"),
        "occupation": kyc.get("occupation"),
        "employer_name": kyc.get("employer_name"),
        "telephone": kyc.get("telephone"),
        "country": kyc.get("residence_country") or country,
        "address": kyc.get("address") or {},
        "identifications": [
            {**i, "node_type": "LvctrPersonIdentificationDetails"} for i in kyc.get("identifications", [])
        ],
    }


def _entity_subject(ref: str, kyc: dict, *, name: str, country: str) -> dict:
    return {
        "ref": ref,
        "kind": "entity",
        "legal_name": kyc.get("legal_name") or name,
        "business_nature": kyc.get("business_nature"),
        "telephone": kyc.get("telephone"),
        "registration_indicator": bool(kyc.get("registration_number")),
        "registration_number": kyc.get("registration_number"),
        "registration_country": kyc.get("registration_country") or country,
        "registration_province": kyc.get("registration_province"),
        "address": kyc.get("address") or {},
        "authorized_persons": kyc.get("authorized_persons", []),
        "identifications": [
            {**i, "node_type": "LvctrEntityIdentificationDetails"} for i in kyc.get("identifications", [])
        ],
    }


def _subject_for_customer(customer: Customer, ref: str) -> dict:
    builder = _entity_subject if customer.customer_type is CustomerType.ENTITY else _person_subject
    return builder(ref, customer.kyc or {}, name=customer.name, country=customer.country)


def _subject_for_party(party: Party, ref: str) -> dict:
    builder = _entity_subject if party.party_type is CustomerType.ENTITY else _person_subject
    return builder(ref, party.kyc or {}, name=party.name, country=party.country)


# ---------------------------------------------------------------------------
# Canonical LVCTR
# ---------------------------------------------------------------------------


@dataclass
class SubjectRegistry:
    """Allocates the ``$id`` values that transactions reference."""

    subjects: list[dict]
    by_key: dict[str, str]

    @classmethod
    def empty(cls) -> "SubjectRegistry":
        return cls(subjects=[], by_key={})

    def add_customer(self, customer: Customer) -> str:
        key = f"customer:{customer.id}"
        if key not in self.by_key:
            ref = f"C{customer.id}"
            self.by_key[key] = ref
            self.subjects.append(_subject_for_customer(customer, ref))
        return self.by_key[key]

    def add_party(self, party: Party) -> str:
        key = f"party:{party.id}"
        if key not in self.by_key:
            prefix = "B" if party.kind.value == "BENEFICIARY" else "T"
            ref = f"{prefix}{party.id}"
            self.by_key[key] = ref
            self.subjects.append(_subject_for_party(party, ref))
        return self.by_key[key]


def build_lvctr_canonical(
    session: Session,
    case: Case,
    *,
    aggregation_events: list[AggregationEvent] | None = None,
) -> dict:
    customer = session.get(Customer, case.customer_id)
    if customer is None:
        raise ReportBuildError("case has no customer")

    events = aggregation_events or list(
        session.execute(
            select(AggregationEvent).where(AggregationEvent.id.in_(case.aggregation_event_ids or []))
        )
        .scalars()
        .all()
    )
    events = [e for e in events if e.threshold_met]
    if not events:
        raise ReportBuildError(
            "This case has no aggregation event that reached the reporting threshold, "
            "so there is nothing to report on an LVCTR."
        )

    txn_ids = sorted({tid for e in events for tid in (e.covered_txn_ids or [])})
    txns = list(
        session.execute(
            select(Transaction).where(Transaction.id.in_(txn_ids)).order_by(Transaction.occurred_at)
        )
        .scalars()
        .all()
    )
    if not txns:
        raise ReportBuildError("no transactions found for the case's aggregation events")

    # Subjects are registered lazily, as each receipt names the parties it
    # actually involves.  Registering the case's customer up front would
    # declare an unused subject on a beneficiary-grouped report where they
    # happen not to be one of the conductors.
    registry = SubjectRegistry.empty()

    # The aggregation type reported is the one that actually triggered the
    # obligation.  Where more than one grouping fired, the earliest-created
    # event is used and the rest are recorded in the canonical body so the
    # reasoning is not lost.
    primary = min(events, key=lambda e: (e.window_end, e.id))
    single = len(txn_ids) == 1 and primary.single_transaction
    aggregation_block = (
        {"type_code": "4"}
        if single
        else {
            "type_code": aggregation_type_code(primary.group_type),
            "start": iso_local_naive(primary.window_start),
            "end": iso_local_naive(primary.window_end),
        }
    )

    canonical_transactions = []
    for index, txn in enumerate(txns, start=1):
        if txn.direction is not Direction.INCOMING:
            continue

        # Each receipt names *its own* conductor. A beneficiary or third-party
        # aggregation exists precisely because the conductors differ, so
        # reporting the case's customer against every transaction would name
        # the wrong person on someone else's receipt.
        conducted_by = session.get(Customer, txn.customer_id) or customer
        txn_conductor_ref = registry.add_customer(conducted_by)

        beneficiary_ref = None
        if txn.beneficiary_id:
            party = session.get(Party, txn.beneficiary_id)
            if party is not None:
                beneficiary_ref = registry.add_party(party)
        on_behalf = []
        if txn.third_party_id:
            party = session.get(Party, txn.third_party_id)
            if party is not None:
                on_behalf.append(
                    {
                        "ref": registry.add_party(party),
                        "client_number": (party.kyc or {}).get("client_number"),
                        "relationship_type_code": (party.kyc or {}).get("relationship_type_code", "5"),
                        "relationship_type_other": (party.kyc or {}).get("relationship_type_other"),
                    }
                )

        context = txn.context or {}
        canonical_transactions.append(
            {
                "reference": _transaction_reference(case, index),
                "occurred_at": iso_local_naive(txn.occurred_at),
                "location_reference": settings.entity.location_reference,
                "method_code": context.get("method_code", DEFAULT_METHOD_CODE),
                "purpose": context.get("purpose") or "Receipt of virtual currency from external address",
                "threshold_indicator": bool(single and cad(txn.cad_value) >= cad(settings.lvctr_threshold_cad)),
                "identifiers": [txn.tx_hash] if txn.tx_hash else [],
                "internal_transaction_id": txn.external_id,
                "starting_actions": [
                    {
                        "asset": txn.asset,
                        "asset_amount": Decimal(str(txn.asset_amount)),
                        "exchange_rate": Decimal(str(txn.exchange_rate)),
                        "conductor_indicator": True,
                        "conductor_ref": txn_conductor_ref,
                        "client_indicator": True,
                        "client_number": conducted_by.external_id,
                        "username": context.get("username"),
                        "email": (conducted_by.kyc or {}).get("email"),
                        "request_datetime": iso_local_naive(txn.occurred_at),
                        "device_type_code": context.get("device_type_code"),
                        "device_id": context.get("device_id"),
                        "device_ip": context.get("ip_address"),
                        "sending_addresses": [txn.wallet_from] if txn.wallet_from else [],
                        "on_behalf_of": on_behalf,
                        "sources": [],
                    }
                ],
                "completing_actions": [
                    {
                        "disposition_type_code": context.get("disposition_type_code", DEFAULT_DISPOSITION_CODE),
                        "asset": txn.asset,
                        "asset_amount": Decimal(str(txn.asset_amount)),
                        "cad_value": cad(txn.cad_value),
                        "currency_type_code": "CAD",
                        "receiving_addresses": [txn.wallet_to] if txn.wallet_to else [],
                        "account_number": context.get("account_number") or conducted_by.external_id,
                        "account_type_code": "2" if conducted_by.customer_type is CustomerType.ENTITY else "1",
                        "account_asset": txn.asset,
                        "beneficiary": (
                            {"ref": beneficiary_ref, "client_number": context.get("beneficiary_client_number")}
                            if beneficiary_ref
                            else None
                        ),
                        "involvements": [],
                        "account_holders": [],
                    }
                ],
            }
        )

    return {
        "report_type": ReportType.LVCTR.value,
        "schema_version": fm.SCHEMA_VERSION,
        "report_reference": _report_reference(case),
        "reporting_entity": {
            "reporting_entity_number": settings.entity.reporting_entity_number,
            "contact_number": settings.entity.contact_number,
            "activity_sector_code": settings.entity.activity_sector_code,
            "legal_name": settings.entity.legal_name,
        },
        "aggregation": aggregation_block,
        "subjects": registry.subjects,
        "transactions": canonical_transactions,
        "provenance": {
            "case_reference": case.reference,
            "aggregation_event_ids": [e.id for e in events],
            "all_groupings": [
                {
                    "event_id": e.id,
                    "group_type": e.group_type.value,
                    "aggregation_type_code": aggregation_type_code(e.group_type),
                    "total_cad": float(e.total_cad),
                    "covered_txn_ids": e.covered_txn_ids,
                }
                for e in events
            ],
            "total_reported_cad": float(cad(sum((Decimal(str(t.cad_value)) for t in txns), Decimal("0")))),
            "valuation_methodology": txns[0].valuation_methodology,
            "built_at": iso_local_naive(utcnow()),
        },
    }


def _report_reference(case: Case) -> str:
    return f"{settings.entity.report_reference_prefix}-{case.reference}"


def _transaction_reference(case: Case, index: int) -> str:
    """Max 20 characters in the report format, so the case number is compressed."""
    digits = "".join(ch for ch in case.reference if ch.isdigit())
    return f"T{digits[-10:]}-{index:03d}"[:20]


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


def build_report(
    session: Session,
    case: Case,
    report_type: ReportType,
    *,
    actor: User | None = None,
    narrative: str | None = None,
    citations: list | None = None,
) -> Report:
    """Create or refresh the case's report of ``report_type`` and validate it."""
    if report_type is ReportType.LVCTR:
        canonical = build_lvctr_canonical(session, case)
        payload = fm.to_fintrac_lvctr(canonical)
        result = validation.validate(payload)
    else:
        canonical = build_str_canonical(session, case, narrative=narrative, citations=citations)
        payload = canonical  # no external STR schema mapping is claimed
        result = validation.ValidationResult(issues=validate_str(canonical), levels_run=[1, 2])

    report = session.execute(
        select(Report).where(Report.case_id == case.id, Report.report_type == report_type)
    ).scalar_one_or_none()
    created = report is None
    if report is None:
        report = Report(
            case_id=case.id,
            report_type=report_type,
            report_reference=canonical["report_reference"],
            schema_version=canonical["schema_version"],
            created_by=actor.id if actor else None,
        )
        session.add(report)

    if report.status in {ReportStatus.SUBMITTED, ReportStatus.ACCEPTED}:
        raise ReportBuildError(
            f"{report_type.value} {report.report_reference} has already been submitted and cannot be rebuilt. "
            "Create an amendment instead."
        )

    report.canonical = _jsonable(canonical)
    report.payload = _jsonable(payload)
    report.validation = result.as_dict()
    report.status = ReportStatus.VALIDATED if result.valid else ReportStatus.INVALID
    report.due_at = case.due_at
    if narrative is not None:
        report.narrative = narrative
        report.narrative_citations = citations or []
    session.flush()

    audit.record(
        session,
        action="REPORT_BUILT" if created else "REPORT_REBUILT",
        object_type="report",
        object_id=report.id,
        actor_id=actor.id if actor else None,
        actor_name=actor.username if actor else "system",
        after={
            "report_type": report_type.value,
            "report_reference": report.report_reference,
            "status": report.status.value,
            "errors": result.as_dict()["error_count"],
            "warnings": result.as_dict()["warning_count"],
        },
    )
    return report


def revalidate(session: Session, report: Report, *, actor: User | None = None) -> Report:
    if report.report_type is ReportType.LVCTR:
        result = validation.validate(report.payload)
    else:
        result = validation.ValidationResult(issues=validate_str(report.canonical), levels_run=[1, 2])
    report.validation = result.as_dict()
    if report.status in {ReportStatus.DRAFT, ReportStatus.VALIDATED, ReportStatus.INVALID}:
        report.status = ReportStatus.VALIDATED if result.valid else ReportStatus.INVALID
    session.flush()
    audit.record(
        session,
        action="REPORT_VALIDATED",
        object_type="report",
        object_id=report.id,
        actor_id=actor.id if actor else None,
        actor_name=actor.username if actor else "system",
        after={"status": report.status.value, "errors": result.as_dict()["error_count"]},
    )
    return report


def _jsonable(value):
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    if isinstance(value, Decimal):
        return str(value)
    return value


# ---------------------------------------------------------------------------
# Canonical STR
# ---------------------------------------------------------------------------


def build_str_canonical(
    session: Session,
    case: Case,
    *,
    narrative: str | None = None,
    citations: list | None = None,
) -> dict:
    from .case_service import case_timeline, effective_score  # local import avoids a cycle

    customer = session.get(Customer, case.customer_id)
    timeline = case_timeline(session, case)
    return {
        "report_type": ReportType.STR.value,
        "schema_version": "sentinel-str-canonical-1",
        "report_reference": f"{settings.entity.report_reference_prefix.replace('LVCTR', 'STR')}-{case.reference}",
        "reporting_entity": {
            "reporting_entity_number": settings.entity.reporting_entity_number,
            "contact_number": settings.entity.contact_number,
            "legal_name": settings.entity.legal_name,
        },
        "subject": {
            "customer_reference": customer.external_id,
            "name": customer.name,
            "customer_type": customer.customer_type.value,
            "country": customer.country,
            "occupation_or_business": customer.occupation_or_business,
            "kyc_risk": customer.kyc_risk,
        },
        "case": {
            "reference": case.reference,
            "risk_score": effective_score(case),
            "risk_tier": case.risk_tier,
            "opened_at": iso_local_naive(case.opened_at),
            "disposition": case.disposition.value if case.disposition else None,
        },
        "indicators": [
            {
                "rule_id": d.get("key"),
                "rule_version": d.get("version"),
                "label": d.get("label"),
                "detail": d.get("detail"),
                "observed": d.get("observed"),
            }
            for d in (case.risk_drivers or [])
            if d.get("source") == "rule"
        ],
        "transactions": timeline,
        "details_of_suspicion": narrative or "",
        "citations": citations or [],
        "action_taken": case.disposition_rationale or "",
        "built_at": iso_local_naive(utcnow()),
    }


def validate_str(canonical: dict) -> list[validation.Issue]:
    """Completeness checks for an STR draft.

    Deliberately conservative: it checks that the *required facts* are present,
    not that the narrative is persuasive.  Whether suspicion exists is the
    investigator's call, and no automated check should imply otherwise.
    """
    issues: list[validation.Issue] = []

    def add(code: str, path: str, message: str, severity: str = validation.ERROR) -> None:
        issues.append(validation.Issue(level=2, severity=severity, code=code, path=path, message=message))

    if not canonical.get("transactions"):
        add("STR-NO-TXNS", "transactions", "An STR must describe at least one transaction.")
    narrative = (canonical.get("details_of_suspicion") or "").strip()
    if not narrative:
        add("STR-NO-NARRATIVE", "details_of_suspicion", "The details of suspicion have not been drafted.")
    elif len(narrative) < 120:
        add(
            "STR-THIN-NARRATIVE",
            "details_of_suspicion",
            "The narrative is very short; FINTRAC expects the who, what, when, where and why.",
            severity=validation.WARNING,
        )
    if not canonical.get("indicators"):
        add(
            "STR-NO-INDICATORS",
            "indicators",
            "No ML/TF indicators are attached to the report.",
            severity=validation.WARNING,
        )
    if not (canonical.get("action_taken") or "").strip():
        add(
            "STR-NO-ACTION",
            "action_taken",
            "Record the action taken and the reasoning behind the filing decision.",
            severity=validation.WARNING,
        )
    subject = canonical.get("subject") or {}
    for required in ("name", "customer_reference"):
        if not subject.get(required):
            add("STR-SUBJECT", f"subject.{required}", f"Subject {required} is required.")
    return issues
