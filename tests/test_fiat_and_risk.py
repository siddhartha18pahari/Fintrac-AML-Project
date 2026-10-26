"""Cash, electronic funds transfers, customer risk and linked accounts.

Virtual-currency behaviour is covered elsewhere. These tests pin the boundary
between a reporting obligation and a suspicion indicator, and they pin the
fact that cash never becomes an LVCTR.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest

from app.config import settings
from app.models import AggregationEvent, Case
from app.services import aggregation, customer_risk, link_analysis, pipeline, rules_engine, str_copilot, valuation
from app.services.pipeline import IngestionError
from conftest import NOW, make_customer, make_party, receipt
from scripts.generate_synthetic import generate


def _fire(session, customer, txn, rule_id: str):
    from app.services.risk import compute_baseline

    baseline = compute_baseline(session, customer.id, as_of=txn.occurred_at)
    events = aggregation.evaluate_transaction(session, txn)
    findings = rules_engine.evaluate(session, txn, baseline=baseline, aggregation_events=events)
    return [finding for finding in findings if finding.rule.id == rule_id]


def test_cad_reference_rate_is_par():
    assert valuation.oracle.price("CAD", NOW) == Decimal("1.00")


def test_cash_at_the_threshold_is_an_lctr_and_not_an_lvctr(session, customer):
    txn = receipt(session, customer, cad="10000", at=NOW, instrument="CASH")
    assert aggregation.evaluate_transaction(session, txn) == []
    assert session.query(AggregationEvent).count() == 0
    found = _fire(session, customer, txn, "AML-FI-001")
    assert found
    assert found[0].observed["aggregated_cad"] == 10000
    assert found[0].observed["single_transaction"] is True
    assert not _fire(session, customer, txn, "AML-VC-012")
    assert "reporting observation" in found[0].detail


def test_cash_just_below_the_line_does_not_report(session, customer):
    txn = receipt(session, customer, cad="9999.99", at=NOW, instrument="CASH")
    assert not _fire(session, customer, txn, "AML-FI-001")


def test_structured_cash_fires_both_the_obligation_and_the_indicator(session, customer):
    txn = None
    for index, amount in enumerate(("9000", "8500", "9200")):
        txn = receipt(
            session,
            customer,
            cad=amount,
            at=NOW + timedelta(hours=index),
            instrument="CASH",
        )
    structuring = _fire(session, customer, txn, "AML-FI-003")
    obligation = _fire(session, customer, txn, "AML-FI-001")
    assert structuring and obligation
    assert structuring[0].observed["receipts"] == 3
    assert structuring[0].observed["largest_cad"] < 10000
    assert obligation[0].observed["aggregated_cad"] == 26700
    assert "not proof of structuring" in structuring[0].detail


def test_one_small_cash_deposit_is_not_structuring(session, customer):
    txn = receipt(session, customer, cad="500", at=NOW, instrument="CASH")
    assert not _fire(session, customer, txn, "AML-FI-003")
    assert not _fire(session, customer, txn, "AML-FI-001")


def test_international_eft_meets_eftr_and_a_domestic_wire_does_not(session, customer):
    international = receipt(
        session,
        customer,
        cad="15000",
        at=NOW,
        instrument="EFT",
        direction="outgoing",
        international=True,
        counterparty_country="DE",
        counterparty_institution="Nordhalle Bank AG",
    )
    found = _fire(session, customer, international, "AML-FI-002")
    assert found
    assert found[0].observed["counterparty_countries"] == ["DE"]
    assert aggregation.evaluate_transaction(session, international) == []

    domestic = receipt(
        session,
        customer,
        cad="15000",
        at=NOW + timedelta(hours=1),
        instrument="EFT",
        direction="outgoing",
        international=False,
        counterparty_country="CA",
    )
    assert not _fire(session, customer, domestic, "AML-FI-002")


def test_cash_in_and_virtual_currency_out_is_cross_rail_movement(session, customer):
    incoming = receipt(session, customer, cad="18000", at=NOW, instrument="CASH")
    outgoing = receipt(
        session,
        customer,
        cad="15500",
        at=NOW + timedelta(hours=2),
        direction="outgoing",
        asset="USDT",
    )
    found = _fire(session, customer, outgoing, "AML-FI-004")
    assert found
    assert found[0].observed["inbound_instruments"] == ["CASH"]
    assert found[0].observed["outbound_instrument"] == "VIRTUAL_CURRENCY"
    assert found[0].observed["outflow_ratio"] >= 0.7
    # The virtual-currency pass-through rule measures the VC rail only.
    assert not _fire(session, customer, incoming, "AML-VC-003")


def test_several_customers_below_the_line_still_surface_smurfing(session):
    beneficiary = make_party(session, "ben_smurf")
    last = None
    last_customer = None
    for index in range(3):
        customer = make_customer(session, f"cust_smurf_{index}", f"Smurf {index}")
        last = receipt(
            session,
            customer,
            cad="4500",
            at=NOW + timedelta(minutes=20 * index),
            instrument="CASH",
            beneficiary=beneficiary,
            device_id="dev-smurf-ring",
        )
        last_customer = customer
    found = _fire(session, last_customer, last, "AML-FI-005")
    assert found
    assert found[0].observed["customer_count"] == 3
    assert found[0].observed["aggregated_cad"] == 13500
    assert not _fire(session, last_customer, last, "AML-FI-001")


def test_unknown_instrument_is_rejected(session, customer):
    with pytest.raises(IngestionError, match="unknown instrument"):
        pipeline.ingest_transaction(
            session,
            {
                "transaction_id": "tx_gold",
                "customer_id": customer.external_id,
                "instrument": "GOLD",
                "asset": "CAD",
                "asset_amount": "100",
                "exchange_rate": "1",
                "timestamp": NOW.isoformat(),
                "direction": "incoming",
            },
        )


def test_lctr_opens_a_case_without_calling_it_an_str_or_an_lvctr(session, customer):
    txn = receipt(session, customer, cad="12500", at=NOW, instrument="CASH")
    pipeline.process_transaction(session, txn)
    case = session.query(Case).one()
    assert case.lvctr_required is False
    assert case.str_candidate is False
    draft, verification = str_copilot.draft_for_case(session, case)
    assert verification.supported, verification.unsupported_claims
    suspicion = draft.text.split("WHY SUSPICIOUS")[-1]
    assert "AML-FI-001" not in suspicion


def test_customer_risk_names_every_factor_and_stays_in_range(session):
    quiet = make_customer(session, "cust_quiet", "Quiet Person")
    quiet.kyc_risk = "LOW"
    quiet.occupation_or_business = "Teacher"
    loud = make_customer(session, "cust_loud", "Loud MSB")
    loud.kyc_risk = "HIGH"
    loud.occupation_or_business = "Money services and remittance"
    loud.country = "IR"
    session.flush()

    low = customer_risk.assess_customer(session, quiet, as_of=NOW)
    high = customer_risk.assess_customer(session, loud, as_of=NOW)
    assert high.inherent > low.inherent
    assert 0 <= high.residual <= 100
    assert high.tier == settings.risk_tier(high.residual)
    assert any(factor.code == "customer_jurisdiction" and factor.points > 0 for factor in high.factors)
    assert any(factor.code == "product_risk" for factor in high.factors)
    assert all(factor.detail and factor.label for factor in high.factors)


def test_shared_device_clusters_customers(session):
    first = make_customer(session, "cust_link_a", "Link A")
    second = make_customer(session, "cust_link_b", "Link B")
    receipt(session, first, cad="400", at=NOW, instrument="CASH", device_id="dev-shared-handset")
    receipt(session, second, cad="450", at=NOW, instrument="CASH", device_id="dev-shared-handset")
    result = link_analysis.analyze(session)
    clustered = [set(cluster["customer_ids"]) for cluster in result["clusters"]]
    assert {first.id, second.id} in clustered
    kinds = {link["kind"] for cluster in result["clusters"] for link in cluster["links"]}
    assert "device" in kinds


def test_generator_plants_the_fiat_scenarios():
    dataset = generate(customers=16, days=12, end=NOW, seed=11)
    planted = {item.scenario: item for item in dataset.expectations}
    for name in ("lctr_single", "cash_structuring", "eftr_international", "rapid_cross_rail", "smurf_ring"):
        assert name in planted
        assert planted[name].lvctr_expected is False
        assert planted[name].alert_expected is True
    assert "AML-FI-001" in planted["lctr_single"].indicators_expected
    assert "AML-FI-003" in planted["cash_structuring"].indicators_expected
    assert "AML-FI-002" in planted["eftr_international"].indicators_expected
    assert "AML-FI-004" in planted["rapid_cross_rail"].indicators_expected
    assert "AML-FI-005" in planted["smurf_ring"].indicators_expected
    instruments = {txn.get("instrument", "VIRTUAL_CURRENCY") for txn in dataset.transactions}
    assert {"CASH", "EFT", "VIRTUAL_CURRENCY"} <= instruments
