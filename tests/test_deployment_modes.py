"""Deployment-shape guarantees.

The app runs in two environments with meaningfully different constraints: a
local server with a durable disk, and a serverless function with a read-only
filesystem, a request deadline and a size budget. These tests pin the
behaviours that make the difference visible rather than silent.
"""

from __future__ import annotations

import importlib
import sys

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client(session):
    return TestClient(app)


# ---------------------------------------------------------------------------
# Health contract
# ---------------------------------------------------------------------------


def test_health_declares_storage_durability(client):
    """An ephemeral deployment must never look like a durable one.

    The whole value of this system is a record that survives; a demo running on
    a wiped-every-cold-start database has to say so.
    """
    body = client.get("/api/health").json()
    assert "storage" in body
    assert set(body["storage"]) == {"backend", "durable", "serverless"}
    assert isinstance(body["storage"]["durable"], bool)


def test_health_declares_whether_the_model_layer_is_present(client):
    body = client.get("/api/health").json()
    assert "anomaly_detection" in body["capabilities"]


# ---------------------------------------------------------------------------
# Graceful degradation without scikit-learn
# ---------------------------------------------------------------------------


class _BlockSklearn:
    """Simulates a slim build with scikit-learn dropped from requirements.

    ``find_spec`` is what Python 3.12 consults. Raising here is the import
    system's signal that the module is absent, which is what a deployment
    without the optional dependency actually looks like.
    """

    def find_spec(self, name, path, target=None):
        if name == "sklearn" or name.startswith("sklearn."):
            raise ImportError(f"No module named {name!r} (simulated slim build)")
        return None


@pytest.fixture()
def without_sklearn():
    blocker = _BlockSklearn()
    sys.meta_path.insert(0, blocker)
    cached = {k: v for k, v in sys.modules.items() if k.startswith("sklearn")}
    for key in cached:
        del sys.modules[key]
    import app.services.anomaly as anomaly

    importlib.reload(anomaly)
    try:
        yield anomaly
    finally:
        sys.meta_path.remove(blocker)
        sys.modules.update(cached)
        importlib.reload(anomaly)


def test_anomaly_layer_abstains_when_sklearn_is_absent(without_sklearn, session, customer):
    from conftest import NOW, receipt

    assert without_sklearn.SKLEARN_AVAILABLE is False
    receipt(session, customer, cad="12000", at=NOW)
    session.flush()

    results = without_sklearn.run(session)
    result = results[customer.id]
    assert result.score == 0.0
    assert result.model_version.endswith("unavailable"), (
        "an abstention must be labelled, so a 0.0 is never read as 'this customer is normal'"
    )


def test_abstention_is_distinguishable_from_a_small_population(session, customer):
    """Two different reasons to abstain must not share one label."""
    from app.services import anomaly

    detector = anomaly.AnomalyDetector().fit([])
    assert detector.abstain_reason == anomaly.ABSTAIN_SMALL_POPULATION
    assert anomaly.ABSTAIN_SMALL_POPULATION != anomaly.ABSTAIN_NO_SKLEARN


def test_rule_engine_is_unaffected_by_a_missing_model(without_sklearn, session, customer):
    """Every deterministic control must survive the optional dependency going away."""
    from conftest import NOW, receipt
    from app.services import pipeline

    receipt(session, customer, cad="14250", at=NOW)
    session.flush()
    summary = pipeline.run(session, with_anomaly=True)

    assert summary["aggregation_events"] == 1, "the LVCTR threshold test must still fire"
    assert summary["alerts_created"] >= 1
    assert summary["cases_opened"] == 1


# ---------------------------------------------------------------------------
# Serverless guards
# ---------------------------------------------------------------------------


def test_bootstrap_is_idempotent():
    """It runs from both the lifespan and module import on serverless hosts."""
    from app import main

    main.bootstrap()
    main.bootstrap()  # must not raise or duplicate rule versions

    from sqlalchemy import func, select

    from app.db import SessionLocal
    from app.models import RuleVersion
    from app.services.rules_engine import load_catalogue

    with SessionLocal() as db:
        count = db.execute(select(func.count(RuleVersion.id))).scalar_one()
    assert count == len(load_catalogue().rules)


def test_vercel_entrypoint_exports_the_asgi_app():
    """The deployment entrypoint must import cleanly and expose `app`."""
    import api.index as entrypoint

    assert hasattr(entrypoint, "app")
    assert entrypoint.app is app
