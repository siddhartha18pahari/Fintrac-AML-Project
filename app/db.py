"""Database engine and session management."""

from __future__ import annotations

import warnings
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.exc import SAWarning
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from .config import SERVERLESS, settings
from .models import Base

# SQLite has no native DECIMAL.  SQLAlchemy warns about this on every Numeric
# column.  The warning is correct but not actionable here: all threshold
# arithmetic is done in Python on quantised Decimals (see app/util.py::cad), so
# storage affinity cannot change a reporting decision.  Documented in
# docs/DATA_MODEL.md.
warnings.filterwarnings("ignore", category=SAWarning, message=r".*does \*not\* support Decimal.*")

IS_SQLITE = settings.database_url.startswith("sqlite")

if IS_SQLITE:
    # SQLite will not create a missing parent directory; do it before the first
    # connection so `reset_db()` on a fresh checkout works.  `data_dir` is
    # read-only-filesystem tolerant, so this cannot break a serverless import.
    settings.data_dir

_engine_kwargs: dict = {"echo": settings.sql_echo, "future": True}

if IS_SQLITE:
    _engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    # Serverless invocations are short-lived and can scale out to many
    # concurrent instances; a per-instance connection pool would exhaust the
    # database's connection limit while sitting mostly idle.  Hold no pool and
    # let the platform's pgbouncer-style pooler do that job.  `pool_pre_ping`
    # covers connections dropped by the pooler between invocations.
    _engine_kwargs["pool_pre_ping"] = True
    if SERVERLESS:
        _engine_kwargs["poolclass"] = NullPool
    else:
        _engine_kwargs["pool_recycle"] = 1800

engine = create_engine(settings.database_url, **_engine_kwargs)

if IS_SQLITE:

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _record):  # pragma: no cover - driver glue
        cur = dbapi_connection.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA journal_mode=WAL")
        cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


def init_db() -> None:
    Base.metadata.create_all(engine)


def reset_db() -> None:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


@contextmanager
def session_scope() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_session() -> Iterator[Session]:
    """FastAPI dependency."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
