"""ORM -> JSON projections shared by the routers.

Kept in one place so the UI never has to guess which shape a customer or a case
arrives in, and so a field rename shows up as one diff.
"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from .models import (
    AggregationEvent,
    Alert,
    Case,
    Customer,
    Party,
    Report,
    Submission,
    Transaction,
    User,
    Wallet,
)
from .util import cad, iso, token_amount


def user_json(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "role": user.role.value,
        "is_active": user.is_active,
    }


def customer_json(customer: Customer, *, include_kyc: bool = False) -> dict:
    payload = {
        "id": customer.id,
        "customer_id": customer.external_id,
        "name": customer.name,
        "customer_type": customer.customer_type.value,
        "kyc_risk": customer.kyc_risk,
        "country": customer.country,
        "occupation_or_business": customer.occupation_or_business,
        "expected_monthly_volume_cad": float(cad(customer.expected_monthly_volume_cad or 0)),
        "onboarded_at": iso(customer.onboarded_at),
    }
    if include_kyc:
        payload["kyc"] = customer.kyc or {}
    return payload


def wallet_json(wallet: Wallet) -> dict:
    return {
        "id": wallet.id,
        "address": wallet.address,
        "blockchain": wallet.blockchain,
        "owner_customer_id": wallet.owner_customer_id,
        "is_internal": wallet.is_internal,
        "first_seen": iso(wallet.first_seen),
        "last_seen": iso(wallet.last_seen),
        "external_risk_score": wallet.external_risk_score,
        "risk_tags": wallet.risk_tags or [],
    }


def party_json(party: Party) -> dict:
    return {
        "id": party.id,
        "party_id": party.external_id,
        "kind": party.kind.value,
        "name": party.name,
        "party_type": party.party_type.value,
        "country": party.country,
    }


def transaction_json(txn: Transaction, *, customer: Customer | None = None) -> dict:
    return {
        "id": txn.id,
        "transaction_id": txn.external_id,
        "customer_id": txn.customer_id,
        "customer_name": customer.name if customer else None,
        "customer_reference": customer.external_id if customer else None,
        "wallet_from": txn.wallet_from,
        "wallet_to": txn.wallet_to,
        "asset": txn.asset,
        "asset_amount": token_amount(txn.asset_amount),
        "cad_value": float(cad(Decimal(str(txn.cad_value)))),
        "exchange_rate": token_amount(txn.exchange_rate),
        "valuation_methodology": txn.valuation_methodology,
        "price_quote_id": txn.price_quote_id,
        "occurred_at": iso(txn.occurred_at),
        "direction": txn.direction.value,
        "blockchain": txn.blockchain,
        "tx_hash": txn.tx_hash,
        "beneficiary_id": txn.beneficiary_id,
        "third_party_id": txn.third_party_id,
        "context": txn.context or {},
        "scenario": txn.synthetic_scenario,
    }


def alert_json(alert: Alert, *, customer: Customer | None = None) -> dict:
    return {
        "id": alert.id,
        "customer_id": alert.customer_id,
        "customer_name": customer.name if customer else None,
        "rule_id": alert.rule_id,
        "rule_version": alert.rule_version,
        "title": alert.title,
        "severity": alert.severity,
        "score_contribution": alert.score_contribution,
        "explanation": alert.explanation or {},
        "evidence_txn_ids": alert.evidence_txn_ids or [],
        "status": alert.status.value,
        "case_id": alert.case_id,
        "assigned_to": alert.assigned_to,
        "occurred_at": iso(alert.occurred_at),
        "created_at": iso(alert.created_at),
    }


def aggregation_json(event: AggregationEvent) -> dict:
    return {
        "id": event.id,
        "group_type": event.group_type.value,
        "group_key": event.group_key,
        "customer_id": event.customer_id,
        "window_start": iso(event.window_start),
        "window_end": iso(event.window_end),
        "total_cad": float(cad(Decimal(str(event.total_cad)))),
        "threshold_cad": float(cad(Decimal(str(event.threshold_cad)))),
        "covered_txn_ids": event.covered_txn_ids or [],
        "receipt_count": len(event.covered_txn_ids or []),
        "single_transaction": event.single_transaction,
        "threshold_met": event.threshold_met,
        "reported": event.reported,
        "report_id": event.report_id,
        "due_at": iso(event.due_at),
    }


def case_json(case: Case, *, customer: Customer | None = None, detail: bool = False) -> dict:
    payload = {
        "id": case.id,
        "reference": case.reference,
        "customer_id": case.customer_id,
        "customer_name": customer.name if customer else None,
        "customer_reference": customer.external_id if customer else None,
        "status": case.status.value,
        "priority": case.priority,
        "risk_score": case.risk_score,
        "effective_score": case.overridden_score if case.overridden_score is not None else case.risk_score,
        "risk_tier": case.risk_tier,
        "overridden_score": case.overridden_score,
        "override_reason": case.override_reason,
        "lvctr_required": case.lvctr_required,
        "str_candidate": case.str_candidate,
        "disposition": case.disposition.value if case.disposition else None,
        "owner_id": case.owner_id,
        "approved_by": case.approved_by,
        "approved_at": iso(case.approved_at),
        "opened_at": iso(case.opened_at),
        "due_at": iso(case.due_at),
        "closed_at": iso(case.closed_at),
    }
    if detail:
        payload.update(
            {
                "risk_drivers": case.risk_drivers or [],
                "disposition_rationale": case.disposition_rationale,
                "aggregation_event_ids": case.aggregation_event_ids or [],
                "notes": [
                    {
                        "id": n.id,
                        "author_id": n.author_id,
                        "body": n.body,
                        "note_type": n.note_type,
                        "created_at": iso(n.created_at),
                    }
                    for n in case.notes
                ],
                "evidence": [
                    {
                        "id": e.id,
                        "evidence_type": e.evidence_type,
                        "evidence_id": e.evidence_id,
                        "label": e.label,
                        "payload": e.payload or {},
                    }
                    for e in case.evidence
                ],
            }
        )
    return payload


def report_json(report: Report, *, include_payload: bool = False) -> dict:
    payload = {
        "id": report.id,
        "case_id": report.case_id,
        "report_type": report.report_type.value,
        "report_reference": report.report_reference,
        "schema_version": report.schema_version,
        "status": report.status.value,
        "validation": report.validation or {},
        "due_at": iso(report.due_at),
        "created_at": iso(report.created_at),
        "submitted_at": iso(report.submitted_at),
        "has_narrative": bool(report.narrative),
        "submissions": [submission_json(s) for s in report.submissions],
    }
    if include_payload:
        payload["payload"] = report.payload or {}
        payload["canonical"] = report.canonical or {}
        payload["narrative"] = report.narrative
        payload["narrative_citations"] = report.narrative_citations or []
    return payload


def submission_json(submission: Submission) -> dict:
    return {
        "id": submission.id,
        "endpoint": submission.endpoint,
        "request_id": submission.request_id,
        "submitted_at": iso(submission.submitted_at),
        "response_status": submission.response_status,
        "submission_id": submission.submission_id,
        "response": submission.response or {},
    }


def customer_map(session: Session, customer_ids) -> dict[int, Customer]:
    from sqlalchemy import select

    ids = {int(c) for c in customer_ids}
    if not ids:
        return {}
    rows = session.execute(select(Customer).where(Customer.id.in_(ids))).scalars().all()
    return {c.id: c for c in rows}
