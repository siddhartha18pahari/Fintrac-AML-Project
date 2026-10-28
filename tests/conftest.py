"""Test fixtures.

The database URL is set *before* the app is imported, because ``app.db``
builds its engine at import time.  Each test session gets a throwaway SQLite
file rather than ``:memory:`` so that every session in the pool sees the same
database.
"""

from __future__ import annotations

import os
import tempfile
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="sentinel-tests-"))
os.environ.setdefault("DATABASE_URL", f"sqlite:///{(_TMP / 'test.db').as_posix()}")
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("AUTH_REQUIRED", "1")

from app.db import SessionLocal, reset_db  # noqa: E402
from app.models import Customer, CustomerType, Party, PartyKind, Role, User  # noqa: E402
from app.security import hash_password  # noqa: E402
from app.services import pipeline, rules_engine  # noqa: E402

#: Fixed reference instant so that window arithmetic in tests is not a function
#: of when the suite happens to run.
NOW = datetime(2026, 8, 10, 12, 0, 0)


@pytest.fixture()
def session():
    reset_db()
    db = SessionLocal()
    rules_engine.sync_rule_versions(db)
    db.commit()
    try:
        yield db
    finally:
        db.rollback()
        db.close()


@pytest.fixture()
def customer(session):
    return make_customer(session, "cust_0001", "Test Subject")


@pytest.fixture()
def users(session):
    made = {}
    for username, role in [
        ("analyst", Role.ANALYST),
        ("senior", Role.SENIOR_ANALYST),
        ("officer", Role.COMPLIANCE_OFFICER),
        ("approver", Role.APPROVER),
        ("auditor", Role.AUDITOR),
        ("admin", Role.ADMINISTRATOR),
    ]:
        user = User(
            username=username,
            full_name=username.title(),
            role=role,
            password_hash=hash_password("password1234"),
        )
        session.add(user)
        made[username] = user
    session.flush()
    session.commit()
    return made


# ---------------------------------------------------------------------------
# Factories
# ---------------------------------------------------------------------------


def make_customer(
    session,
    external_id: str = "cust_0001",
    name: str = "Test Subject",
    *,
    entity: bool = False,
    expected_monthly: str = "20000",
    onboarded_days_ago: int = 400,
) -> Customer:
    customer = Customer(
        external_id=external_id,
        name=name,
        customer_type=CustomerType.ENTITY if entity else CustomerType.PERSON,
        kyc_risk="LOW",
        country="CA",
        occupation_or_business="Software developer",
        expected_monthly_volume_cad=Decimal(expected_monthly),
        onboarded_at=NOW - timedelta(days=onboarded_days_ago),
        kyc={
            "surname": name.split()[-1],
            "given_name": name.split()[0],
            "birth_date": "1985-04-12",
            "occupation": "Software developer",
            "residence_country": "CA",
            "address": {
                "building": "120",
                "street": "King Street West",
                "city": "Toronto",
                "province": "ON",
                "postal_code": "M5H 1A1",
                "country": "CA",
            },
            "identifications": [
                {"type_code": "4", "number": "D1234567", "country": "CA", "province": "ON"}
            ],
        },
    )
    session.add(customer)
    session.flush()
    return customer


def make_party(session, external_id: str = "ben_0001", kind: PartyKind = PartyKind.BENEFICIARY) -> Party:
    return pipeline.get_or_create_party(
        session,
        external_id,
        kind=kind,
        name="Receiving Party",
        country="CA",
        kyc={"surname": "Party", "given_name": "Receiving", "client_number": "CN000001"},
    )


_counter = {"n": 0}


def receipt(
    session,
    customer: Customer,
    *,
    cad: str | Decimal,
    at: datetime,
    asset: str = "USDT",
    sender: str | None = None,
    beneficiary: Party | None = None,
    third_party: Party | None = None,
    direction: str = "incoming",
    sender_risk: int | None = None,
    sender_tags: list[str] | None = None,
    sender_first_seen: datetime | None = None,
    instrument: str = "VIRTUAL_CURRENCY",
    international: bool | None = None,
    counterparty_country: str | None = None,
    counterparty_institution: str | None = None,
    device_id: str | None = None,
    context: dict | None = None,
):
    """Ingest one transaction with an exact CAD value.

    ``exchange_rate`` is pinned to 1 and the token amount set to the CAD figure,
    so a test that means "CAD 9,999.99" gets exactly that and the assertion is
    about the threshold logic rather than about the price oracle.
    """
    _counter["n"] += 1
    amount = Decimal(str(cad))
    if instrument != "VIRTUAL_CURRENCY" and asset == "USDT":
        asset = "CAD"
    payload = {
        "transaction_id": f"tx_test_{_counter['n']:05d}",
        "customer_id": customer.external_id,
        "asset": asset,
        "asset_amount": str(amount),
        "exchange_rate": "1",
        "rate_source": "test_fixture",
        "timestamp": at.isoformat(),
        "direction": direction,
        "wallet_from": sender or (f"ext_{_counter['n']:05d}" if direction == "incoming" else "int_wallet_1"),
        "wallet_to": "int_wallet_1" if direction == "incoming" else f"ext_out_{_counter['n']:05d}",
        "blockchain": "FIAT" if instrument != "VIRTUAL_CURRENCY" else asset,
        "blockchain_tx_hash": f"hash{_counter['n']:060d}",
        "instrument": instrument,
    }
    if international is not None:
        payload["international"] = international
    if counterparty_country:
        payload["counterparty_country"] = counterparty_country
    if counterparty_institution:
        payload["counterparty_institution"] = counterparty_institution
    if device_id or context:
        payload["context"] = {**(context or {}), **({"device_id": device_id} if device_id else {})}
    if beneficiary is not None:
        payload["beneficiary_id"] = beneficiary.external_id
        payload["beneficiary_name"] = beneficiary.name
    if third_party is not None:
        payload["third_party_id"] = third_party.external_id
        payload["third_party_name"] = third_party.name
    if sender_risk is not None:
        payload["wallet_from_risk"] = sender_risk
    if sender_tags:
        payload["wallet_from_tags"] = sender_tags
    if sender_first_seen is not None:
        payload["wallet_from_first_seen"] = sender_first_seen.isoformat()

    result = pipeline.ingest_transaction(session, payload)
    session.flush()
    return result.transaction
