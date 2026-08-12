"""Ingestion and the detection pipeline.

    normalise -> value in CAD -> 24-hour aggregation -> rules -> alerts
             -> risk score (+ anomaly) -> case

Each stage is independently callable and independently tested; this module only
wires them together and owns the transactional boundaries.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..config import settings
from ..models import (
    Alert,
    AlertStatus,
    Customer,
    CustomerType,
    Direction,
    Party,
    PartyKind,
    Transaction,
    Wallet,
)
from ..util import cad, parse_dt, utcnow
from . import aggregation, anomaly, case_service, risk, rules_engine, valuation


class IngestionError(Exception):
    pass


@dataclass
class IngestResult:
    transaction: Transaction
    created: bool


@dataclass
class ProcessResult:
    transaction_id: int
    aggregation_events: list[int] = field(default_factory=list)
    alerts_created: list[int] = field(default_factory=list)
    alerts_existing: list[int] = field(default_factory=list)
    case_id: int | None = None
    case_created: bool = False
    risk_score: int = 0
    risk_tier: str = "LOW"

    def as_dict(self) -> dict:
        return {
            "transaction_id": self.transaction_id,
            "aggregation_events": self.aggregation_events,
            "alerts_created": self.alerts_created,
            "alerts_existing": self.alerts_existing,
            "case_id": self.case_id,
            "case_created": self.case_created,
            "risk_score": self.risk_score,
            "risk_tier": self.risk_tier,
        }


# ---------------------------------------------------------------------------
# Reference data
# ---------------------------------------------------------------------------


def get_or_create_wallet(
    session: Session,
    address: str,
    *,
    blockchain: str = "BTC",
    owner_customer_id: int | None = None,
    is_internal: bool = False,
    first_seen: datetime | None = None,
    external_risk_score: int | None = None,
    risk_tags: list | None = None,
) -> Wallet:
    wallet = session.execute(
        select(Wallet).where(Wallet.address == address, Wallet.blockchain == blockchain)
    ).scalar_one_or_none()
    seen = first_seen or utcnow()
    if wallet is None:
        wallet = Wallet(
            address=address,
            blockchain=blockchain,
            owner_customer_id=owner_customer_id,
            is_internal=is_internal,
            first_seen=seen,
            last_seen=seen,
            external_risk_score=external_risk_score or 0,
            risk_tags=list(risk_tags or []),
        )
        session.add(wallet)
        session.flush()
        return wallet

    wallet.first_seen = min(wallet.first_seen, seen)
    wallet.last_seen = max(wallet.last_seen, seen)
    if owner_customer_id and not wallet.owner_customer_id:
        wallet.owner_customer_id = owner_customer_id
    if external_risk_score is not None:
        wallet.external_risk_score = max(wallet.external_risk_score, external_risk_score)
    if risk_tags:
        wallet.risk_tags = sorted({*(wallet.risk_tags or []), *risk_tags})
    return wallet


def get_or_create_party(
    session: Session,
    external_id: str,
    *,
    kind: PartyKind,
    name: str,
    party_type: CustomerType = CustomerType.PERSON,
    country: str = "CA",
    kyc: dict | None = None,
) -> Party:
    party = session.execute(select(Party).where(Party.external_id == external_id)).scalar_one_or_none()
    if party is not None:
        return party
    party = Party(
        external_id=external_id,
        kind=kind,
        name=name,
        party_type=party_type,
        country=country,
        kyc=kyc or {},
    )
    session.add(party)
    session.flush()
    return party


# ---------------------------------------------------------------------------
# Ingestion
# ---------------------------------------------------------------------------


def ingest_transaction(session: Session, payload: dict) -> IngestResult:
    """Normalise one canonical transaction record and persist it.

    Idempotent on ``transaction_id``: replaying a feed cannot duplicate the
    ledger, which would silently double every aggregate downstream.
    """
    external_id = str(payload.get("transaction_id") or payload.get("external_id") or "").strip()
    if not external_id:
        raise IngestionError("transaction_id is required")

    existing = session.execute(
        select(Transaction).where(Transaction.external_id == external_id)
    ).scalar_one_or_none()
    if existing is not None:
        return IngestResult(transaction=existing, created=False)

    customer_ref = str(payload.get("customer_id") or "").strip()
    customer = session.execute(
        select(Customer).where(Customer.external_id == customer_ref)
    ).scalar_one_or_none()
    if customer is None:
        raise IngestionError(f"unknown customer {customer_ref!r}")

    occurred_at = parse_dt(payload["timestamp"])
    direction = Direction(str(payload.get("direction", "incoming")).upper())
    asset = str(payload["asset"]).upper()
    asset_amount = Decimal(str(payload["asset_amount"]))
    blockchain = str(payload.get("blockchain") or asset)

    val, quote = valuation.value_amount(
        session,
        asset,
        asset_amount,
        occurred_at,
        explicit_rate=payload.get("exchange_rate"),
        source=payload.get("rate_source"),
    )
    # An ingested cad_value is treated as a cross-check, not as the truth: if the
    # feed disagrees with rate x amount, the discrepancy is recorded rather than
    # silently accepted, because it changes threshold outcomes.
    supplied_cad = payload.get("cad_value")
    context = dict(payload.get("context") or {})
    if supplied_cad is not None and cad(supplied_cad) != val.cad_value:
        context["cad_value_discrepancy"] = {
            "supplied": float(cad(supplied_cad)),
            "recomputed": float(val.cad_value),
            "rate": str(val.price_cad),
        }

    beneficiary = None
    if payload.get("beneficiary_id"):
        beneficiary = get_or_create_party(
            session,
            str(payload["beneficiary_id"]),
            kind=PartyKind.BENEFICIARY,
            name=str(payload.get("beneficiary_name") or payload["beneficiary_id"]),
            country=str(payload.get("beneficiary_country") or "CA"),
            kyc=payload.get("beneficiary_kyc") or {},
        )
    third_party = None
    if payload.get("third_party_id"):
        third_party = get_or_create_party(
            session,
            str(payload["third_party_id"]),
            kind=PartyKind.THIRD_PARTY,
            name=str(payload.get("third_party_name") or payload["third_party_id"]),
            country=str(payload.get("third_party_country") or "CA"),
            kyc=payload.get("third_party_kyc") or {},
        )

    if payload.get("wallet_from"):
        declared_first_seen = payload.get("wallet_from_first_seen")
        get_or_create_wallet(
            session,
            str(payload["wallet_from"]),
            blockchain=blockchain,
            owner_customer_id=customer.id if direction is Direction.OUTGOING else None,
            is_internal=direction is Direction.OUTGOING,
            first_seen=parse_dt(declared_first_seen) if declared_first_seen else occurred_at,
            external_risk_score=payload.get("wallet_from_risk"),
            risk_tags=payload.get("wallet_from_tags"),
        )
    if payload.get("wallet_to"):
        get_or_create_wallet(
            session,
            str(payload["wallet_to"]),
            blockchain=blockchain,
            owner_customer_id=customer.id if direction is Direction.INCOMING else None,
            is_internal=direction is Direction.INCOMING,
            first_seen=occurred_at,
            external_risk_score=payload.get("wallet_to_risk"),
            risk_tags=payload.get("wallet_to_tags"),
        )

    txn = Transaction(
        external_id=external_id,
        customer_id=customer.id,
        wallet_from=payload.get("wallet_from"),
        wallet_to=payload.get("wallet_to"),
        asset=asset,
        asset_amount=asset_amount,
        cad_value=val.cad_value,
        exchange_rate=val.price_cad,
        price_quote_id=quote.id,
        valuation_methodology=val.methodology_version,
        occurred_at=occurred_at,
        direction=direction,
        blockchain=blockchain,
        tx_hash=payload.get("blockchain_tx_hash") or payload.get("tx_hash"),
        beneficiary_id=beneficiary.id if beneficiary else None,
        third_party_id=third_party.id if third_party else None,
        context=context,
        synthetic_scenario=payload.get("scenario"),
        ingested_at=utcnow(),
    )
    session.add(txn)
    session.flush()
    return IngestResult(transaction=txn, created=True)


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------


def process_transaction(
    session: Session,
    txn: Transaction,
    *,
    anomaly_result: dict | None = None,
) -> ProcessResult:
    result = ProcessResult(transaction_id=txn.id)

    events = aggregation.evaluate_transaction(session, txn)
    result.aggregation_events = [e.id for e in events]

    baseline = risk.compute_baseline(session, txn.customer_id, as_of=txn.occurred_at)
    findings = rules_engine.evaluate(session, txn, baseline=baseline, aggregation_events=events)

    alerts: list[Alert] = []
    for finding in findings:
        alert, created = case_service.upsert_alert(session, txn.customer_id, finding)
        alerts.append(alert)
        (result.alerts_created if created else result.alerts_existing).append(alert.id)

    if not alerts:
        return result

    # Score against every live alert for the customer, not only this batch: an
    # investigator sees one subject, so the score has to reflect all of it.
    live = list(
        session.execute(
            select(Alert).where(
                Alert.customer_id == txn.customer_id,
                Alert.status != AlertStatus.DISMISSED,
            )
        )
        .scalars()
        .all()
    )
    assessment = risk.assess(live, anomaly=anomaly_result)
    result.risk_score = assessment.score
    result.risk_tier = assessment.tier

    # A case is opened when there is a reporting obligation, or when the score
    # clears the triage threshold.  Lower-scoring alerts stay in the alert queue
    # for an analyst to triage rather than manufacturing a case per indicator.
    reportable = [e for e in events if e.threshold_met]
    if reportable or assessment.score >= settings.case_creation_score:
        customer = session.get(Customer, txn.customer_id)
        case, created = case_service.open_case_for(
            session, customer, alerts, assessment, aggregation_events=events
        )
        result.case_id = case.id
        result.case_created = created
    return result


def run(
    session: Session,
    *,
    transaction_ids: list[int] | None = None,
    with_anomaly: bool = True,
) -> dict:
    """Run detection across a set of transactions (default: everything).

    Transactions are processed in chronological order so that windows, baselines
    and dedup behave the way they would in a live stream.
    """
    rules_engine.sync_rule_versions(session)

    stmt = select(Transaction).order_by(Transaction.occurred_at, Transaction.id)
    if transaction_ids:
        stmt = stmt.where(Transaction.id.in_(transaction_ids))
    txns = list(session.execute(stmt).scalars().all())

    anomaly_by_customer: dict[int, dict] = {}
    if with_anomaly and txns:
        results = anomaly.run(session, as_of=max(t.occurred_at for t in txns))
        anomaly_by_customer = {cid: res.as_dict() for cid, res in results.items()}

    # Aggregation events are counted as *distinct* candidates, not as touches:
    # one event that absorbs six receipts is one reporting obligation, and a
    # summary that says six would misstate the workload.
    events_touched: set[int] = set()
    cases_touched: set[int] = set()
    summary = {
        "transactions_processed": 0,
        "aggregation_events": 0,
        "alerts_created": 0,
        "cases_opened": 0,
        "cases_touched": [],
    }
    for txn in txns:
        outcome = process_transaction(
            session, txn, anomaly_result=anomaly_by_customer.get(txn.customer_id)
        )
        summary["transactions_processed"] += 1
        summary["alerts_created"] += len(outcome.alerts_created)
        events_touched.update(outcome.aggregation_events)
        if outcome.case_created:
            summary["cases_opened"] += 1
        if outcome.case_id:
            cases_touched.add(outcome.case_id)

    summary["aggregation_events"] = len(events_touched)
    summary["cases_touched"] = sorted(cases_touched)
    audit.record(
        session,
        action="PIPELINE_RUN",
        object_type="pipeline",
        object_id="detection",
        after={k: v for k, v in summary.items() if k != "cases_touched"},
    )
    session.flush()
    return summary
