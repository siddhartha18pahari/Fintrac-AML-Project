"""Customers, wallets, parties, transactions and ingestion."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select

from .. import audit
from ..deps import SessionDep, UserDep, require
from ..models import Customer, Direction, Party, PartyKind, Transaction, User, Wallet
from ..schemas import BatchIngestRequest, CustomerCreate, PartyCreate, TransactionIn
from ..serializers import customer_json, customer_map, party_json, transaction_json, wallet_json
from ..services import pipeline, risk, valuation
from ..util import parse_dt, utcnow

router = APIRouter(prefix="/api", tags=["data"])


# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------


@router.get("/customers")
def list_customers(
    session: SessionDep,
    _: UserDep,
    q: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict:
    stmt = select(Customer)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(func.lower(Customer.name).like(like) | func.lower(Customer.external_id).like(like))
    total = session.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = session.execute(stmt.order_by(Customer.id).limit(limit).offset(offset)).scalars().all()
    return {"total": total, "customers": [customer_json(c) for c in rows]}


@router.post("/customers", status_code=status.HTTP_201_CREATED)
def create_customer(body: CustomerCreate, session: SessionDep, actor: User = Depends(require("admin"))) -> dict:
    if session.execute(select(Customer).where(Customer.external_id == body.customer_id)).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, f"customer {body.customer_id} already exists")
    customer = Customer(
        external_id=body.customer_id,
        name=body.name,
        customer_type=body.customer_type,
        kyc_risk=body.kyc_risk,
        country=body.country,
        occupation_or_business=body.occupation_or_business,
        expected_monthly_volume_cad=body.expected_monthly_volume_cad,
        onboarded_at=parse_dt(body.onboarded_at) if body.onboarded_at else utcnow(),
        kyc=body.kyc,
    )
    session.add(customer)
    session.flush()
    audit.record(
        session,
        action="CUSTOMER_CREATED",
        object_type="customer",
        object_id=customer.id,
        actor_id=actor.id,
        actor_name=actor.username,
        after={"customer_id": customer.external_id, "name": customer.name},
    )
    session.commit()
    return customer_json(customer, include_kyc=True)


@router.get("/customers/{customer_id}")
def get_customer(customer_id: int, session: SessionDep, _: UserDep) -> dict:
    customer = session.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "customer not found")
    baseline = risk.compute_baseline(session, customer.id, persist=False)
    wallets = (
        session.execute(select(Wallet).where(Wallet.owner_customer_id == customer.id)).scalars().all()
    )
    return {
        "customer": customer_json(customer, include_kyc=True),
        "baseline": {
            "lookback_days": baseline.lookback_days,
            "txn_count": baseline.txn_count,
            "total_cad": float(baseline.total_cad),
            "avg_daily_cad": float(baseline.avg_daily_cad),
            "avg_txn_cad": float(baseline.avg_txn_cad),
            "stdev_txn_cad": float(baseline.stdev_txn_cad),
            "distinct_counterparties": baseline.distinct_counterparties,
        },
        "wallets": [wallet_json(w) for w in wallets],
    }


@router.get("/customers/{customer_id}/transactions")
def customer_transactions(
    customer_id: int,
    session: SessionDep,
    _: UserDep,
    limit: int = Query(200, ge=1, le=1000),
) -> dict:
    customer = session.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "customer not found")
    rows = (
        session.execute(
            select(Transaction)
            .where(Transaction.customer_id == customer_id)
            .order_by(Transaction.occurred_at.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    return {"transactions": [transaction_json(t, customer=customer) for t in rows]}


# ---------------------------------------------------------------------------
# Parties and wallets
# ---------------------------------------------------------------------------


@router.post("/parties", status_code=status.HTTP_201_CREATED)
def create_party(body: PartyCreate, session: SessionDep, _: User = Depends(require("admin"))) -> dict:
    party = pipeline.get_or_create_party(
        session,
        body.party_id,
        kind=body.kind,
        name=body.name,
        party_type=body.party_type,
        country=body.country,
        kyc=body.kyc,
    )
    session.commit()
    return party_json(party)


@router.get("/parties")
def list_parties(session: SessionDep, _: UserDep, kind: PartyKind | None = None) -> dict:
    stmt = select(Party)
    if kind:
        stmt = stmt.where(Party.kind == kind)
    rows = session.execute(stmt.order_by(Party.id)).scalars().all()
    return {"parties": [party_json(p) for p in rows]}


@router.get("/wallets")
def list_wallets(
    session: SessionDep,
    _: UserDep,
    risky_only: bool = False,
    limit: int = Query(200, ge=1, le=1000),
) -> dict:
    stmt = select(Wallet)
    if risky_only:
        stmt = stmt.where(Wallet.external_risk_score >= 70)
    rows = session.execute(stmt.order_by(Wallet.external_risk_score.desc()).limit(limit)).scalars().all()
    return {"wallets": [wallet_json(w) for w in rows]}


@router.get("/wallets/{address}")
def get_wallet(address: str, session: SessionDep, _: UserDep, blockchain: str | None = None) -> dict:
    # An address string can exist on more than one chain, so this cannot assume
    # a single row.
    stmt = select(Wallet).where(Wallet.address == address)
    if blockchain:
        stmt = stmt.where(Wallet.blockchain == blockchain)
    wallet = session.execute(stmt.order_by(Wallet.id)).scalars().first()
    if wallet is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "wallet not found")
    rows = (
        session.execute(
            select(Transaction)
            .where((Transaction.wallet_from == address) | (Transaction.wallet_to == address))
            .order_by(Transaction.occurred_at.desc())
            .limit(200)
        )
        .scalars()
        .all()
    )
    customers = customer_map(session, [t.customer_id for t in rows])
    return {
        "wallet": wallet_json(wallet),
        "transactions": [transaction_json(t, customer=customers.get(t.customer_id)) for t in rows],
    }


# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------


@router.get("/transactions")
def list_transactions(
    session: SessionDep,
    _: UserDep,
    customer_id: int | None = None,
    direction: Direction | None = None,
    min_cad: float | None = None,
    since: datetime | None = None,
    q: str | None = None,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> dict:
    stmt = select(Transaction)
    if customer_id:
        stmt = stmt.where(Transaction.customer_id == customer_id)
    if direction:
        stmt = stmt.where(Transaction.direction == direction)
    if min_cad is not None:
        stmt = stmt.where(Transaction.cad_value >= min_cad)
    if since:
        stmt = stmt.where(Transaction.occurred_at >= parse_dt(since))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            Transaction.external_id.like(like)
            | Transaction.wallet_from.like(like)
            | Transaction.wallet_to.like(like)
            | Transaction.tx_hash.like(like)
        )
    total = session.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = (
        session.execute(stmt.order_by(Transaction.occurred_at.desc()).limit(limit).offset(offset))
        .scalars()
        .all()
    )
    customers = customer_map(session, [t.customer_id for t in rows])
    return {
        "total": total,
        "transactions": [transaction_json(t, customer=customers.get(t.customer_id)) for t in rows],
    }


@router.get("/transactions/{transaction_id}")
def get_transaction(transaction_id: int, session: SessionDep, _: UserDep) -> dict:
    txn = session.get(Transaction, transaction_id)
    if txn is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "transaction not found")
    customer = session.get(Customer, txn.customer_id)
    payload = transaction_json(txn, customer=customer)
    if txn.price_quote_id:
        payload["valuation"] = {
            "price_quote_id": txn.price_quote_id,
            "recomputed_cad": float(valuation.reproduce(session, txn.price_quote_id, txn.asset_amount)),
            "methodology_version": txn.valuation_methodology,
        }
    return payload


@router.post("/transactions", status_code=status.HTTP_201_CREATED)
def ingest_one(
    body: TransactionIn,
    session: SessionDep,
    run_detection: bool = True,
    actor: User = Depends(require("pipeline:run")),
) -> dict:
    try:
        result = pipeline.ingest_transaction(session, body.model_dump(mode="json"))
    except pipeline.IngestionError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    outcome = None
    if run_detection and result.created:
        outcome = pipeline.process_transaction(session, result.transaction).as_dict()
    audit.record(
        session,
        action="TRANSACTION_INGESTED",
        object_type="transaction",
        object_id=result.transaction.id,
        actor_id=actor.id,
        actor_name=actor.username,
        after={"transaction_id": result.transaction.external_id, "created": result.created},
    )
    session.commit()
    return {
        "created": result.created,
        "transaction": transaction_json(result.transaction),
        "detection": outcome,
    }


@router.post("/transactions/batch")
def ingest_batch(
    body: BatchIngestRequest,
    session: SessionDep,
    actor: User = Depends(require("pipeline:run")),
) -> dict:
    created, skipped, errors = [], [], []
    for item in body.transactions:
        try:
            result = pipeline.ingest_transaction(session, item.model_dump(mode="json"))
        except pipeline.IngestionError as exc:
            errors.append({"transaction_id": item.transaction_id, "error": str(exc)})
            continue
        (created if result.created else skipped).append(result.transaction.id)

    detection = None
    if body.run_detection and created:
        detection = pipeline.run(session, transaction_ids=created)
    audit.record(
        session,
        action="BATCH_INGESTED",
        object_type="transaction",
        object_id="batch",
        actor_id=actor.id,
        actor_name=actor.username,
        after={"created": len(created), "skipped": len(skipped), "errors": len(errors)},
    )
    session.commit()
    return {
        "created": len(created),
        "skipped_duplicates": len(skipped),
        "errors": errors,
        "detection": detection,
    }
