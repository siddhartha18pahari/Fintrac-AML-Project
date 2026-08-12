"""Seed the demo deployment: users, synthetic ledger, then a full detection run.

    python -m scripts.seed --customers 40 --days 45 --reset

Everything it writes is synthetic.  The script refuses to run against a
deployment that has ``SYNTHETIC_DATA_ONLY`` turned off, because ``--reset``
drops tables.
"""

from __future__ import annotations

import argparse
import os
import sys
from decimal import Decimal
from pathlib import Path

if __package__ in (None, ""):  # allow `python scripts/seed.py`
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from app import audit
from app.config import settings
from app.db import init_db, reset_db, session_scope
from app.models import Customer, CustomerType, PartyKind, Role, User
from app.security import hash_password
from app.services import pipeline, rules_engine
from app.util import parse_dt
from scripts.generate_synthetic import generate

#: Demo accounts.  The default password is intentionally obvious - this is a
#: demo deployment with synthetic data, and pretending otherwise would be
#: theatre.  It is documented in this repository, though, so any deployment
#: with a public URL must override it: set DEMO_PASSWORD in the environment.
#: docs/SECURITY.md and docs/DEPLOY_VERCEL.md cover the rest.
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "sentinel1234")
DEMO_USERS = [
    ("admin", "System Administrator", Role.ADMINISTRATOR),
    ("j.okafor", "Joy Okafor", Role.ANALYST),
    ("m.tremblay", "Marc Tremblay", Role.ANALYST),
    ("s.rahman", "Sana Rahman", Role.SENIOR_ANALYST),
    ("l.chen", "Lily Chen", Role.COMPLIANCE_OFFICER),
    ("d.vasquez", "Diego Vasquez", Role.APPROVER),
    ("a.petrov", "Anna Petrov", Role.AUDITOR),
]


def ensure_users(session) -> int:
    created = 0
    for username, full_name, role in DEMO_USERS:
        if session.execute(select(User).where(User.username == username)).scalar_one_or_none():
            continue
        session.add(
            User(
                username=username,
                full_name=full_name,
                role=role,
                password_hash=hash_password(DEMO_PASSWORD),
            )
        )
        created += 1
    session.flush()
    return created


def load_dataset(session, dataset) -> dict:
    for record in dataset.customers:
        if session.execute(
            select(Customer).where(Customer.external_id == record["customer_id"])
        ).scalar_one_or_none():
            continue
        session.add(
            Customer(
                external_id=record["customer_id"],
                name=record["name"],
                customer_type=CustomerType(record["customer_type"]),
                kyc_risk=record["kyc_risk"],
                country=record["country"],
                occupation_or_business=record["occupation_or_business"],
                expected_monthly_volume_cad=Decimal(record["expected_monthly_volume_cad"]),
                onboarded_at=parse_dt(record["onboarded_at"]),
                kyc=record["kyc"],
            )
        )
    session.flush()

    for record in dataset.parties:
        pipeline.get_or_create_party(
            session,
            record["party_id"],
            kind=PartyKind(record["kind"]),
            name=record["name"],
            party_type=CustomerType(record["party_type"]),
            country=record["country"],
            kyc=record["kyc"],
        )
    session.flush()

    ingested, duplicates, failures = 0, 0, []
    for payload in dataset.transactions:
        try:
            result = pipeline.ingest_transaction(session, payload)
        except pipeline.IngestionError as exc:
            failures.append({"transaction_id": payload.get("transaction_id"), "error": str(exc)})
            continue
        if result.created:
            ingested += 1
        else:
            duplicates += 1
    session.flush()
    return {"ingested": ingested, "duplicates": duplicates, "failures": failures}


def seed_everything(
    *,
    customers: int = 40,
    days: int = 45,
    seed: int = 20260811,
    reset: bool = True,
    include_demo_case: bool = True,
    run_detection: bool = True,
) -> dict:
    if reset and not settings.synthetic_data_only:
        raise RuntimeError(
            "Refusing to reset: SYNTHETIC_DATA_ONLY is not set for this deployment."
        )
    if reset:
        reset_db()
    else:
        init_db()

    dataset = generate(seed=seed, customers=customers, days=days)
    if not include_demo_case:
        dataset.transactions = [t for t in dataset.transactions if not str(t.get("scenario", "")).startswith("demo_")]
        dataset.expectations = [e for e in dataset.expectations if not e.scenario.startswith("demo_")]

    with session_scope() as session:
        users_created = ensure_users(session)
        rules_engine.sync_rule_versions(session)
        load = load_dataset(session, dataset)
        audit.record(
            session,
            action="SYNTHETIC_DATA_SEEDED",
            object_type="deployment",
            object_id="seed",
            after={"seed": seed, "customers": customers, "days": days, **load},
            reason="Synthetic demo dataset generated. No real customer data is present.",
        )

    detection = None
    if run_detection:
        with session_scope() as session:
            detection = pipeline.run(session)

    return {
        "users_created": users_created,
        "dataset": dataset.summary(),
        "load": load,
        "detection": detection,
        "expectations": [e.as_dict() for e in dataset.expectations],
        "demo_credentials": {"username": "l.chen", "password": DEMO_PASSWORD, "role": "COMPLIANCE_OFFICER"},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed FINTRAC Sentinel with synthetic data")
    parser.add_argument("--customers", type=int, default=40)
    parser.add_argument("--days", type=int, default=45)
    parser.add_argument("--seed", type=int, default=20260811)
    parser.add_argument("--no-reset", action="store_true", help="add to the existing database")
    parser.add_argument("--no-detection", action="store_true", help="load data without running detection")
    args = parser.parse_args()

    summary = seed_everything(
        customers=args.customers,
        days=args.days,
        seed=args.seed,
        reset=not args.no_reset,
        run_detection=not args.no_detection,
    )

    dataset = summary["dataset"]
    print("FINTRAC Sentinel - synthetic seed complete")
    print("-" * 52)
    print(f"  customers      {dataset['customers']}")
    print(f"  parties        {dataset['parties']}")
    print(f"  transactions   {dataset['transactions']}")
    print(f"  ingested       {summary['load']['ingested']} ({summary['load']['duplicates']} duplicates skipped)")
    if summary["load"]["failures"]:
        print(f"  FAILURES       {len(summary['load']['failures'])}")
        for failure in summary["load"]["failures"][:5]:
            print(f"    - {failure}")
    if summary["detection"]:
        detection = summary["detection"]
        print(f"  alerts raised  {detection['alerts_created']}")
        print(f"  agg. events    {detection['aggregation_events']}")
        print(f"  cases opened   {detection['cases_opened']}")
    print()
    print("  planted scenarios:")
    for scenario, count in sorted(dataset["scenarios"].items()):
        print(f"    {scenario:<28} {count:>5} transactions")
    print()
    print(f"  sign in as l.chen / {DEMO_PASSWORD}  (compliance officer)")
    print("  all data is SYNTHETIC")
    for problem in settings.check_deployment():
        print(f"  ! {problem}")


if __name__ == "__main__":
    main()
