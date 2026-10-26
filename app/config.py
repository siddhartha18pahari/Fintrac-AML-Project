"""Central configuration for FINTRAC Sentinel.

Everything that a compliance officer might need to change without touching code
lives here (or in ``app/rules/aml_rules.yaml``).  Values can be overridden with
environment variables so the same image runs in dev / demo / test.
"""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


def _env_bool(name: str, default: bool) -> bool:
    return _env(name, "1" if default else "0").lower() in {"1", "true", "yes", "on"}


#: True when running on a serverless platform with a read-only project
#: filesystem (Vercel, Lambda).  Only ``/tmp`` is writable, and it does not
#: survive between invocations.
SERVERLESS = bool(os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))

#: The signing key used when none is configured. Fine on a laptop; a public
#: deployment that keeps it has forgeable session tokens, so
#: ``Settings.check_deployment`` treats it as a hard failure.
DEV_SECRET_KEY = "dev-only-not-a-production-secret-change-me"


def _default_database_url() -> str:
    """Where to store data when ``DATABASE_URL`` is not set.

    On a serverless host a project-relative SQLite file cannot be created (the
    filesystem is read-only), so fall back to ``/tmp``.  That "works" but the
    database is destroyed on every cold start, which for a system whose whole
    point is a durable audit trail is a demo, not a deployment.  The health
    endpoint reports ``storage.durable: false`` so this is never silently
    mistaken for persistence - set DATABASE_URL to Postgres for anything real.
    """
    if SERVERLESS:
        # Derived from the platform temp directory rather than hardcoding
        # /tmp, so this path is exercisable off-Linux instead of only failing
        # in production.
        return f"sqlite:///{(Path(tempfile.gettempdir()) / 'sentinel.db').as_posix()}"
    return f"sqlite:///{(PROJECT_ROOT / 'data' / 'sentinel.db').as_posix()}"


@dataclass(frozen=True)
class ReportingEntityProfile:
    """Identifies the reporting entity that this deployment files on behalf of.

    These are the F2R-era identifiers described in the legacy repository README:
    they come from the reporting entity's own FINTRAC organisation record, not
    from anything this system can derive.
    """

    reporting_entity_number: str = _env("RE_NUMBER", "1234567")
    contact_number: str = _env("RE_CONTACT_NUMBER", "7654321")
    location_reference: str = _env("RE_LOCATION_REFERENCE", "L0000001")
    activity_sector_code: str = _env("RE_ACTIVITY_SECTOR", "11")  # 11 = Money services business
    legal_name: str = _env("RE_LEGAL_NAME", "Northbound Digital Assets Inc.")
    report_reference_prefix: str = _env("RE_REPORT_PREFIX", "NDA-LVCTR")


@dataclass(frozen=True)
class Settings:
    app_name: str = "FINTRAC Sentinel"
    version: str = "1.1.0"

    # ---- persistence -----------------------------------------------------
    # SQLite by default so the project runs with zero infrastructure.
    # Set DATABASE_URL=postgresql+psycopg://... to run against PostgreSQL.
    database_url: str = _env("DATABASE_URL", _default_database_url())
    sql_echo: bool = _env_bool("SQL_ECHO", False)
    # Create tables and sync the rule catalogue on startup.  Convenient locally;
    # turn it off once a serverless deployment is provisioned so that concurrent
    # cold starts are not all racing to run DDL on every invocation.
    auto_migrate: bool = _env_bool("AUTO_MIGRATE", True)

    # ---- regulatory parameters ------------------------------------------
    # LVCTR threshold: CAD 10,000 or more received in virtual currency.
    lvctr_threshold_cad: Decimal = Decimal(_env("LVCTR_THRESHOLD_CAD", "10000"))
    # LCTR threshold: CAD 10,000 or more in cash received.
    lctr_threshold_cad: Decimal = Decimal(_env("LCTR_THRESHOLD_CAD", "10000"))
    # EFTR threshold: CAD 10,000 or more in an international electronic funds transfer.
    eftr_threshold_cad: Decimal = Decimal(_env("EFTR_THRESHOLD_CAD", "10000"))
    # The 24-hour rule window.
    aggregation_window_hours: int = int(_env("AGGREGATION_WINDOW_HOURS", "24"))
    # LVCTR must generally be filed within 5 working days of the day of receipt.
    filing_deadline_working_days: int = int(_env("FILING_DEADLINE_WORKING_DAYS", "5"))

    # ---- valuation -------------------------------------------------------
    valuation_methodology_version: str = _env("VALUATION_METHODOLOGY", "pricing-v2")

    # ---- risk ------------------------------------------------------------
    risk_tier_bounds: tuple = ((0, 24, "LOW"), (25, 49, "MEDIUM"), (50, 74, "HIGH"), (75, 100, "CRITICAL"))
    # A case is auto-created for an alert at or above this score.
    case_creation_score: int = int(_env("CASE_CREATION_SCORE", "40"))

    # ---- anomaly detection ----------------------------------------------
    anomaly_contamination: float = float(_env("ANOMALY_CONTAMINATION", "0.05"))
    anomaly_max_points: int = int(_env("ANOMALY_WEIGHT", "12"))  # max risk points from ML

    # ---- security --------------------------------------------------------
    secret_key: str = _env("SECRET_KEY", DEV_SECRET_KEY)
    token_ttl_seconds: int = int(_env("TOKEN_TTL_SECONDS", str(8 * 3600)))
    # When true the API requires a bearer token on every non-public route.
    auth_required: bool = _env_bool("AUTH_REQUIRED", True)

    # ---- demo / safety ---------------------------------------------------
    synthetic_data_only: bool = _env_bool("SYNTHETIC_DATA_ONLY", True)
    # Informed consent to run a hosted deployment whose data is wiped on every
    # cold start. Off by default: an AML console that silently forgets its own
    # audit trail is a trap, so it has to be asked for.
    allow_ephemeral_storage: bool = _env_bool("ALLOW_EPHEMERAL_STORAGE", False)
    # Hard guard: this project never talks to the real FINTRAC.
    submission_endpoint: str = _env("SUBMISSION_ENDPOINT", "mock")

    entity: ReportingEntityProfile = field(default_factory=ReportingEntityProfile)

    @property
    def data_dir(self) -> Path:
        """Writable scratch directory.

        Never raises: on a read-only serverless filesystem it falls back to
        ``/tmp`` rather than taking the whole application down at import time
        over a directory that a Postgres deployment does not even use.
        """
        candidate = Path(tempfile.gettempdir()) if SERVERLESS else PROJECT_ROOT / "data"
        try:
            candidate.mkdir(parents=True, exist_ok=True)
        except OSError:
            candidate = Path(tempfile.gettempdir())
            candidate.mkdir(parents=True, exist_ok=True)
        return candidate

    @property
    def durable_storage(self) -> bool:
        """False when data will not survive a restart.

        True for Postgres, and for local SQLite. False for SQLite on a
        serverless host, where ``/tmp`` is wiped between cold starts.
        """
        if not self.database_url.startswith("sqlite"):
            return True
        return not SERVERLESS

    @property
    def using_default_secret(self) -> bool:
        return self.secret_key == DEV_SECRET_KEY

    def check_deployment(self) -> list[str]:
        """Configuration problems that must be fixed before exposing this.

        Returned rather than logged so the caller decides how loud to be:
        :func:`app.main.bootstrap` refuses to start a hosted deployment that
        trips any of them.
        """
        problems = []
        if self.using_default_secret:
            problems.append(
                "SECRET_KEY is still the development default, so anyone who has read this "
                "source can mint a valid administrator token. Set SECRET_KEY to a long random "
                "value in the deployment's environment."
            )
        if not self.durable_storage and not self.allow_ephemeral_storage:
            problems.append(
                f"Storage is not durable: this deployment is on SQLite at "
                f"{self.database_url.split('///')[-1]}, which a serverless host destroys on every "
                "cold start. Cases, decisions and the audit trail will not survive. Provision "
                "PostgreSQL and set DATABASE_URL, or set ALLOW_EPHEMERAL_STORAGE=1 to accept a "
                "throwaway demo where the record does not persist."
            )
        return problems

    def risk_tier(self, score: float) -> str:
        for low, high, name in self.risk_tier_bounds:
            if low <= score <= high:
                return name
        return "CRITICAL"


#: Rules that record a reporting obligation. They are not, by themselves,
#: indicators that an STR should be filed. Kept here so the case service and
#: the STR copilot agree on the boundary.
REPORTING_RULE_IDS = frozenset({"AML-VC-012", "AML-FI-001", "AML-FI-002"})

#: Illustrative country-risk list for customer inherent-risk scoring. The rule
#: catalogue carries its own copy (AML-VC-009); both are placeholders for a
#: board-approved assessment and must not be treated as a sanctions list.
HIGH_RISK_JURISDICTIONS = frozenset({"KP", "IR", "MM", "SY", "AF"})


settings = Settings()
