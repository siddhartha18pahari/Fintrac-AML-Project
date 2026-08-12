"""FINTRAC Sentinel application entry point."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import SERVERLESS, settings
from .db import init_db, session_scope
from .routers import auth, cases, data, detection, insights, reports
from .services.rules_engine import sync_rule_versions

log = logging.getLogger("sentinel")
STATIC_DIR = Path(__file__).resolve().parent / "static"

DESCRIPTION = """
Explainable AML monitoring and regulatory reporting for virtual-currency transactions.

**Detect -> Investigate -> Explain -> Report**

* 24-hour FINTRAC aggregation with deduplicated candidates
* configurable, versioned AML rule engine
* explainable risk scoring with ranked drivers
* transaction-graph analytics (fan-in, fan-out, circular flow, shared wallets)
* investigator case management with four-eyes approval
* evidence-grounded STR drafting with an unsupported-claim verifier
* LVCTR generation with five-level validation
* hash-chained audit trail

All data in this deployment is **synthetic**. Reports are submitted to a local
mock receiver only; this system is not connected to FINTRAC.
"""


_bootstrapped = False


def bootstrap() -> None:
    """Create tables and load the rule catalogue.

    Idempotent and safe to call more than once, because it runs from two
    places: the ASGI lifespan locally, and module import on serverless hosts
    whose adapters do not reliably run lifespan events.  Set AUTO_MIGRATE=0
    once a deployment is provisioned so that concurrent cold starts are not
    all issuing DDL.
    """
    global _bootstrapped
    if _bootstrapped:
        return

    # A hosted deployment with a forgeable signing key or a disposable database
    # is worse than one that is down: it looks like a working compliance system.
    # Fail loudly with the fix in the message rather than serving it.
    if SERVERLESS:
        problems = settings.check_deployment()
        if problems:
            raise RuntimeError(
                "Refusing to start this deployment:\n  - " + "\n  - ".join(problems)
            )

    if not settings.auto_migrate:
        _bootstrapped = True
        return
    init_db()
    with session_scope() as session:
        written = sync_rule_versions(session)
    if written:
        log.info("Registered %s rule version(s) from the YAML catalogue", written)
    _bootstrapped = True


@asynccontextmanager
async def lifespan(_: FastAPI):
    bootstrap()
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description=DESCRIPTION,
    lifespan=lifespan,
)

app.include_router(auth.router)
app.include_router(data.router)
app.include_router(detection.router)
app.include_router(cases.router)
app.include_router(reports.router)
app.include_router(reports.mock_router)
app.include_router(insights.router)


@app.get("/api/health", tags=["meta"])
def health() -> dict:
    from .services.anomaly import SKLEARN_AVAILABLE

    return {
        "status": "ok",
        "app": settings.app_name,
        "version": settings.version,
        "synthetic_data_only": settings.synthetic_data_only,
        "submission_endpoint": settings.submission_endpoint,
        "storage": {
            "backend": "postgresql" if not settings.database_url.startswith("sqlite") else "sqlite",
            # False means the data is destroyed on restart. Reported explicitly
            # so an ephemeral deployment is never mistaken for a durable one.
            "durable": settings.durable_storage,
            "serverless": SERVERLESS,
        },
        "capabilities": {
            "anomaly_detection": SKLEARN_AVAILABLE,
        },
    }


@app.exception_handler(ValueError)
async def value_error_handler(_: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        """Serve the single-page app for any non-API path.

        Unknown paths under ``/api`` must 404 as JSON rather than falling
        through to the SPA shell: a client that typos an endpoint would
        otherwise receive HTML with a 200 and parse it as success.
        """
        if path == "api" or path.startswith("api/"):
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"No API route matches /{path}")
        candidate = STATIC_DIR / path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")
