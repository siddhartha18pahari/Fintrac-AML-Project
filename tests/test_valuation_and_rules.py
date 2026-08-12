"""Valuation reproducibility, rule evaluation and risk scoring."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest

from app.services import aggregation, rules_engine, valuation
from app.services.risk import assess, compute_baseline
from conftest import NOW, make_customer, receipt


# ---------------------------------------------------------------------------
# Valuation
# ---------------------------------------------------------------------------


def test_oracle_is_deterministic():
    first = valuation.oracle.price("BTC", NOW)
    second = valuation.oracle.price("BTC", NOW)
    assert first == second, "the same asset and hour must always price identically"


def test_prices_move_between_hours():
    assert valuation.oracle.price("BTC", NOW) != valuation.oracle.price("BTC", NOW + timedelta(hours=6))


def test_stablecoins_barely_move():
    a = valuation.oracle.price("USDT", NOW)
    b = valuation.oracle.price("USDT", NOW + timedelta(days=3))
    assert abs(a - b) / a < Decimal("0.01")


def test_quote_is_snapshotted_and_reproducible(session, customer):
    txn = receipt(session, customer, cad="1234.56", at=NOW)
    assert txn.price_quote_id is not None
    recomputed = valuation.reproduce(session, txn.price_quote_id, txn.asset_amount)
    assert recomputed == Decimal("1234.56")


def test_supplied_cad_discrepancy_is_recorded_not_swallowed(session, customer):
    from app.services import pipeline

    result = pipeline.ingest_transaction(session, {
        "transaction_id": "tx_discrepancy",
        "customer_id": customer.external_id,
        "asset": "USDT",
        "asset_amount": "1000",
        "exchange_rate": "1",
        "cad_value": "9999.99",          # the feed disagrees with amount x rate
        "timestamp": NOW.isoformat(),
        "direction": "incoming",
        "wallet_from": "ext_disc",
        "wallet_to": "int_wallet_1",
    })
    txn = result.transaction
    assert txn.cad_value == Decimal("1000.00"), "the recomputed figure is authoritative"
    assert "cad_value_discrepancy" in txn.context
    assert txn.context["cad_value_discrepancy"]["supplied"] == 9999.99


def test_ingestion_is_idempotent(session, customer):
    from app.services import pipeline

    payload = {
        "transaction_id": "tx_repeat",
        "customer_id": customer.external_id,
        "asset": "USDT",
        "asset_amount": "500",
        "exchange_rate": "1",
        "timestamp": NOW.isoformat(),
        "direction": "incoming",
        "wallet_from": "ext_repeat",
        "wallet_to": "int_wallet_1",
    }
    first = pipeline.ingest_transaction(session, payload)
    second = pipeline.ingest_transaction(session, payload)
    assert first.created is True and second.created is False
    assert first.transaction.id == second.transaction.id


# ---------------------------------------------------------------------------
# Rule catalogue and versioning
# ---------------------------------------------------------------------------


def test_only_one_version_of_a_rule_is_in_force_at_a_time():
    catalogue = rules_engine.load_catalogue()
    in_force = catalogue.in_force(NOW)
    ids = [r.id for r in in_force]
    assert len(ids) == len(set(ids)), "two versions of the same rule must never both apply"


def test_superseded_rule_still_applies_to_its_own_era():
    from datetime import datetime

    catalogue = rules_engine.load_catalogue()
    before = {r.id: r.version for r in catalogue.in_force(datetime(2026, 2, 1))}
    after = {r.id: r.version for r in catalogue.in_force(datetime(2026, 8, 1))}
    assert before["AML-VC-001"] == "1.0"
    assert after["AML-VC-001"] == "2.1"
    assert before["AML-VC-004"] == "1.0"
    assert after["AML-VC-004"] == "2.0"


def test_every_rule_binds_to_a_registered_evaluator():
    catalogue = rules_engine.load_catalogue()
    missing = [r.id for r in catalogue.rules if r.evaluator not in rules_engine._EVALUATORS]
    assert not missing, f"rules reference evaluators that do not exist: {missing}"


def test_rule_versions_are_persisted_for_reproducibility(session):
    from sqlalchemy import func, select

    from app.models import RuleVersion

    count = session.execute(select(func.count(RuleVersion.id))).scalar_one()
    assert count == len(rules_engine.load_catalogue().rules)


# ---------------------------------------------------------------------------
# Individual evaluators
# ---------------------------------------------------------------------------


def _fire(session, customer, txn, rule_id):
    baseline = compute_baseline(session, customer.id, as_of=txn.occurred_at)
    events = aggregation.evaluate_transaction(session, txn)
    findings = rules_engine.evaluate(session, txn, baseline=baseline, aggregation_events=events)
    return [f for f in findings if f.rule.id == rule_id]


def test_rapid_multi_wallet_inbound_fires(session, customer):
    base = NOW
    for index in range(6):
        txn = receipt(session, customer, cad="900", at=base + timedelta(minutes=6 * index))
    found = _fire(session, customer, txn, "AML-VC-001")
    assert found
    assert found[0].observed["unique_senders"] >= 5
    assert found[0].threshold["min_unique_senders"] == 5


def test_high_risk_counterparty_fires_on_tag(session, customer):
    txn = receipt(session, customer, cad="4000", at=NOW, sender_risk=91, sender_tags=["mixer"])
    found = _fire(session, customer, txn, "AML-VC-005")
    assert found
    assert "mixer" in found[0].observed["matched_tags"]


def test_high_risk_counterparty_ignores_ordinary_wallets(session, customer):
    txn = receipt(session, customer, cad="4000", at=NOW, sender_risk=12)
    assert not _fire(session, customer, txn, "AML-VC-005")


def test_pass_through_fires_and_ratio_is_reported_against_the_window(session, customer):
    inbound = receipt(session, customer, cad="8000", at=NOW)
    receipt(session, customer, cad="7600", at=NOW + timedelta(minutes=30), direction="outgoing")
    found = _fire(session, customer, inbound, "AML-VC-003")
    assert found
    assert found[0].observed["outflow_ratio"] == pytest.approx(0.95, abs=0.01)


def test_baseline_deviation_uses_active_day_average(session, customer):
    """A low-frequency customer's ordinary deposit must not read as a spike."""
    # Six modest receipts spread over six weeks: ~1,500/active day.
    for week in range(6):
        receipt(session, customer, cad="1500", at=NOW - timedelta(days=7 * (week + 1)))
    ordinary = receipt(session, customer, cad="1600", at=NOW)
    assert not _fire(session, customer, ordinary, "AML-VC-004"), (
        "an ordinary deposit must not trip the deviation rule just because most days are quiet"
    )

    spike = receipt(session, customer, cad="18000", at=NOW + timedelta(hours=1))
    found = _fire(session, customer, spike, "AML-VC-004")
    assert found
    assert found[0].observed["multiple_vs_active_day_avg"] >= 5


def test_dormant_reactivation(session, customer):
    receipt(session, customer, cad="600", at=NOW - timedelta(days=200))
    wake = receipt(session, customer, cad="9200", at=NOW)
    found = _fire(session, customer, wake, "AML-VC-006")
    assert found
    assert found[0].observed["days_inactive"] > 90


def test_chain_hopping(session, customer):
    for index, asset in enumerate(["BTC", "ETH", "USDT", "LTC"]):
        txn = receipt(session, customer, cad="1200", at=NOW + timedelta(minutes=40 * index), asset=asset)
    found = _fire(session, customer, txn, "AML-VC-013")
    assert found
    assert found[0].observed["distinct_assets"] >= 3


def test_shared_wallet_across_customers(session, customer):
    other = make_customer(session, "cust_other", "Other Subject")
    shared = "ext_shared_addr"
    receipt(session, other, cad="2600", at=NOW - timedelta(hours=2), sender=shared)
    txn = receipt(session, customer, cad="2600", at=NOW, sender=shared)
    found = _fire(session, customer, txn, "AML-VC-007")
    assert found
    assert found[0].observed["customer_count"] >= 2


def test_expected_volume_breach(session, customer):
    # Evaluate at the most recent receipt so the whole 30-day window is behind it.
    for index in reversed(range(6)):
        txn = receipt(session, customer, cad="12000", at=NOW - timedelta(days=index * 3))
    found = _fire(session, customer, txn, "AML-VC-015")
    assert found
    assert found[0].observed["multiple"] >= 3


def test_every_finding_carries_evidence_and_a_threshold(session, customer):
    for index in range(6):
        txn = receipt(session, customer, cad="2500", at=NOW + timedelta(minutes=8 * index))
    baseline = compute_baseline(session, customer.id, as_of=txn.occurred_at)
    events = aggregation.evaluate_transaction(session, txn)
    findings = rules_engine.evaluate(session, txn, baseline=baseline, aggregation_events=events)
    assert findings
    for finding in findings:
        explanation = finding.explanation()
        assert explanation["rule_id"] and explanation["rule_version"]
        assert explanation["evidence_ids"], f"{finding.rule.id} produced a score with no evidence"
        assert isinstance(explanation["observed"], dict)
        assert explanation["detail"], f"{finding.rule.id} produced no human-readable explanation"


# ---------------------------------------------------------------------------
# Risk scoring
# ---------------------------------------------------------------------------


class _FakeAlert:
    def __init__(self, rule_id, points, evidence=(1,)):
        self.rule_id = rule_id
        self.rule_version = "1.0"
        self.title = f"{rule_id} finding"
        self.score_contribution = points
        self.evidence_txn_ids = list(evidence)
        self.explanation = {"detail": "d", "observed": {}, "threshold": {}}


def test_repeated_firings_of_one_rule_do_not_stack():
    assessment = assess([_FakeAlert("AML-VC-001", 18), _FakeAlert("AML-VC-001", 18), _FakeAlert("AML-VC-001", 18)])
    assert assessment.score == 18, "one indicator repeated is still one indicator"


def test_score_is_capped_and_reports_the_raw_total():
    alerts = [_FakeAlert(f"R-{i}", 30, evidence=(i,)) for i in range(5)]
    assessment = assess(alerts)
    assert assessment.score == 100
    assert assessment.raw_score == 150
    assert assessment.capped is True


def test_confidence_reflects_corroboration():
    assert assess([_FakeAlert("R-1", 20)]).confidence == "LOW"
    assert assess([_FakeAlert("R-1", 20, (1,)), _FakeAlert("R-2", 20, (2,))]).confidence == "MEDIUM"
    assert assess([
        _FakeAlert("R-1", 20, (1,)), _FakeAlert("R-2", 20, (2,)), _FakeAlert("R-3", 20, (3,)),
    ]).confidence == "HIGH"


def test_anomaly_contribution_is_bounded():
    from app.config import settings

    assessment = assess([_FakeAlert("R-1", 10)], anomaly={"score": 1.0, "model_name": "m", "model_version": "1"})
    model_driver = next(d for d in assessment.drivers if d.source == "model")
    assert model_driver.points <= settings.anomaly_max_points


def test_drivers_are_ranked_and_explain_themselves():
    assessment = assess([_FakeAlert("R-low", 5, (1,)), _FakeAlert("R-high", 25, (2,))])
    assert [d.points for d in assessment.drivers] == [25, 5]
    rendered = __import__("app.services.risk", fromlist=["render_drivers"]).render_drivers(assessment)
    assert "Risk Score:" in rendered and "R-high" in rendered
