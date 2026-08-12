"""Provision a database without loading demo data.

    DATABASE_URL="postgresql+psycopg://..." python -m scripts.provision

Creates the schema, loads the rule catalogue, and creates a single
administrator account.  Use this when the deployment will receive real
transaction feeds rather than the synthetic demo ledger; use
``scripts.seed`` when you want the walkthrough dataset.

Safe to re-run: table creation and rule-catalogue sync are both idempotent and
neither touches existing rows.
"""

from __future__ import annotations

import argparse
import secrets
import sys
from pathlib import Path

if __package__ in (None, ""):  # allow `python scripts/provision.py`
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from app import audit
from app.config import settings
from app.db import init_db, session_scope
from app.models import Role, User
from app.security import hash_password
from app.services import rules_engine


def provision(admin_username: str = "admin", admin_password: str | None = None) -> dict:
    generated = admin_password is None
    admin_password = admin_password or secrets.token_urlsafe(18)

    init_db()
    with session_scope() as session:
        rules_written = rules_engine.sync_rule_versions(session)

        existing = session.execute(
            select(User).where(User.username == admin_username)
        ).scalar_one_or_none()
        created = existing is None
        if created:
            session.add(
                User(
                    username=admin_username,
                    full_name="Administrator",
                    role=Role.ADMINISTRATOR,
                    password_hash=hash_password(admin_password),
                )
            )
            session.flush()
            audit.record(
                session,
                action="DEPLOYMENT_PROVISIONED",
                object_type="deployment",
                object_id="provision",
                after={"admin_username": admin_username, "rule_versions": rules_written},
            )

    return {
        "database": settings.database_url.split("@")[-1],
        "durable": settings.durable_storage,
        "rule_versions_written": rules_written,
        "admin_created": created,
        "admin_username": admin_username,
        "admin_password": admin_password if (created and generated) else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Provision a FINTRAC Sentinel database")
    parser.add_argument("--admin-username", default="admin")
    parser.add_argument("--admin-password", default=None, help="omit to generate one")
    args = parser.parse_args()

    problems = settings.check_deployment()

    result = provision(args.admin_username, args.admin_password)

    print("FINTRAC Sentinel - provisioning complete")
    print("-" * 52)
    print(f"  database            {result['database']}")
    print(f"  durable storage     {result['durable']}")
    print(f"  rule versions       {result['rule_versions_written']} written")
    print(f"  administrator       {result['admin_username']}"
          f"{' (created)' if result['admin_created'] else ' (already existed)'}")
    if result["admin_password"]:
        print(f"  generated password  {result['admin_password']}")
        print("                      ^ shown once. Store it now.")
    if problems:
        print()
        print("  BEFORE EXPOSING THIS DEPLOYMENT:")
        for problem in problems:
            print(f"    - {problem}")
    print()
    print("  No transaction data was loaded. Use `python -m scripts.seed` for the demo dataset.")


if __name__ == "__main__":
    main()
