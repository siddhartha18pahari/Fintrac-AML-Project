#!/usr/bin/env python
"""Convenience launcher: seed on first run, then serve.

    python run.py              # serve on http://127.0.0.1:8099
    python run.py --seed       # regenerate the synthetic dataset first
    python run.py --port 9000
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.config import settings  # noqa: E402
from app.db import init_db  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Run FINTRAC Sentinel")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8099)
    parser.add_argument("--seed", action="store_true", help="regenerate synthetic data before serving")
    parser.add_argument("--reload", action="store_true", help="auto-reload on code changes")
    args = parser.parse_args()

    init_db()

    from sqlalchemy import func, select

    from app.db import session_scope
    from app.models import Transaction

    with session_scope() as session:
        empty = session.execute(select(func.count(Transaction.id))).scalar_one() == 0

    if args.seed or empty:
        print("Seeding synthetic dataset…")
        from scripts.seed import seed_everything

        summary = seed_everything()
        print(
            f"  {summary['dataset']['transactions']} transactions, "
            f"{summary['detection']['alerts_created']} alerts, "
            f"{summary['detection']['cases_opened']} cases"
        )

    print()
    print(f"  {settings.app_name} {settings.version}")
    print(f"  console  http://{args.host}:{args.port}/")
    print(f"  api docs http://{args.host}:{args.port}/docs")
    print("  sign in  l.chen / sentinel1234")
    print("  ALL DATA IS SYNTHETIC. Reports go to a local mock receiver only.")
    print()

    import uvicorn

    uvicorn.run("app.main:app", host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
