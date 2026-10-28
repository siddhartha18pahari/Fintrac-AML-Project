"""Sanctions and PEP screening, terrorist-property, travel rule, and typologies.

The sample list is fictional. These tests pin the matcher, the boundary between
a reporting observation and an indicator, and the fact that ordinary generator
names do not collide with the list.
"""

from __future__ import annotations

from datetime import timedelta

from app.config import REPORTING_RULE_IDS
from app.services import book_metrics, draft_filings, pipeline, rules_engine, screening
from app.services.book_metrics import project
from conftest import NOW, make_customer, receipt
from scripts.generate_synthetic import BUSINESS_WORDS, GIVEN_NAMES, SURNAMES, generate


def _fire(session, customer, txn, rule_id: str):
    from app.services import aggregation
    from app.services.risk import compute_baseline

    baseline = compute_baseline(session, customer.id, as_of=txn.occurred_at)
    events = aggregation.evaluate_transaction(session, txn)
    findings = rules_engine.evaluate(session, txn, baseline=baseline, aggregation_events=events)
    return [finding for finding in findings if finding.rule.id == rule_id]


def test_one_edit_matches_and_a_different_name_does_not():
    score = screening.similarity("Soren Halburg", "Soren Halberg")
    assert score >= 0.90
    assert score < 0.99
    assert screening.similarity("Sofia Halbert", "Soren Halberg") < 0.90
    assert screening.similarity("Marisol Quayle", "Marisol Quayle") == 1.0
    hits = screening.match_name("Soren Halburg", kinds={"SANCTIONS"}, min_score=0.90)
    assert hits and hits[0].entry_id == "SMP-001"
    assert screening.match_name("Sofia Halbert", kinds={"SANCTIONS"}, min_score=0.90) == []
    assert screening.match_name("Soren K. Halberg", kinds={"SANCTIONS"}, min_score=0.90)


def test_reordered_tokens_match_the_canonical_name():
    assert screening.similarity("Halberg, Soren", "Soren Halberg") >= 0.90


def test_generator_names_and_the_test_subject_stay_off_the_list():
    for given in GIVEN_NAMES:
        for surname in SURNAMES:
            name = f"{given} {surname}"
            hits = screening.match_name(name, min_score=0.90)
            assert not hits, f"{name} collided with {hits[0].entry_id}"
    for head, tail in BUSINESS_WORDS:
        for suffix in ("Ltd.", "Inc."):
            name = f"{head} {tail} {suffix}"
            hits = screening.match_name(name, min_score=0.90)
            assert not hits, f"{name} collided with {hits[0].entry_id}"
    assert screening.match_name("Test Subject", min_score=0.90) == []


def test_fuzzy_customer_name_is_a_sanctions_hit_and_a_near_name_is_not(session):
    listed = make_customer(session, "cust_soren", "Soren Halburg")
    txn = receipt(session, listed, cad="1800", at=NOW)
    found = _fire(session, listed, txn, "AML-SC-001")
    assert found
    assert found[0].observed["entry_id"] == "SMP-001"
    assert found[0].observed["score"] >= 0.90
    assert "not a legal designation" in found[0].detail
    assert not _fire(session, listed, txn, "AML-SC-002")

    near = make_customer(session, "cust_sofia", "Sofia Halbert")
    other = receipt(session, near, cad="1800", at=NOW)
    assert not _fire(session, near, other, "AML-SC-001")


def test_beneficiary_entity_is_screened_on_the_customers_transaction(session, customer):
    pipeline.get_or_create_party(
        session,
        "ben_orun",
        kind=pipeline.PartyKind.BENEFICIARY,
        name="Orun Commodities DMCC",
        party_type=pipeline.CustomerType.ENTITY,
        country="AE",
    )
    from app.models import Party

    party = session.query(Party).filter_by(external_id="ben_orun").one()
    txn = receipt(session, customer, cad="1600", at=NOW, beneficiary=party)
    found = _fire(session, customer, txn, "AML-SC-001")
    assert found
    assert found[0].observed["matched_on"] == "beneficiary"
    assert found[0].observed["canonical_name"] == "Orun Commodities DMCC"


def test_exact_pep_and_terrorist_property_matches(session):
    pep = make_customer(session, "cust_pep", "Marisol Quayle")
    pep_txn = receipt(session, pep, cad="900", at=NOW)
    found = _fire(session, pep, pep_txn, "AML-SC-002")
    assert found
    assert found[0].observed["score"] == 1.0
    assert not _fire(session, pep, pep_txn, "AML-TF-001")

    listed = make_customer(session, "cust_tpr", "Nabil Qureshi")
    tpr_txn = receipt(session, listed, cad="6400", at=NOW)
    property_hit = _fire(session, listed, tpr_txn, "AML-TF-001")
    assert property_hit
    assert property_hit[0].rule.severity == "reporting"
    assert "AML-TF-001" in REPORTING_RULE_IDS
    assert "sample" in property_hit[0].detail.lower()


def test_travel_rule_fires_on_a_gap_and_ignores_a_complete_or_domestic_wire(session, customer):
    gap = receipt(
        session,
        customer,
        cad="4200",
        at=NOW,
        instrument="EFT",
        direction="outgoing",
        international=True,
        counterparty_country="AE",
        context={
            "travel": {
                "originator_name": "Tamsin Crowe",
                "originator_account": "CA77SENTINEL001928",
                "originator_address": "120 King Street West, Toronto, ON, CA",
                "beneficiary_name": "Rashid Noor Trading",
                "beneficiary_account": "",
                "beneficiary_address": "",
                "beneficiary_institution": "",
            }
        },
    )
    found = _fire(session, customer, gap, "AML-TR-001")
    assert found
    assert "beneficiary_account" in found[0].observed["missing_fields"]
    assert "beneficiary_institution" in found[0].observed["missing_fields"]

    complete = receipt(
        session,
        customer,
        cad="4200",
        at=NOW + timedelta(hours=1),
        instrument="EFT",
        direction="outgoing",
        international=True,
        counterparty_country="DE",
        context={
            "travel": {
                "originator_name": "Tamsin Crowe",
                "originator_account": "CA77SENTINEL001928",
                "originator_address": "120 King Street West, Toronto, ON, CA",
                "beneficiary_name": "Klaus Reinhardt",
                "beneficiary_account": "DE89370400440532013000",
                "beneficiary_address": "Hauptstrasse 12, Hamburg, DE",
                "beneficiary_institution": "Nordhalle Bank AG",
            }
        },
    )
    assert not _fire(session, customer, complete, "AML-TR-001")

    domestic = receipt(
        session,
        customer,
        cad="4200",
        at=NOW + timedelta(hours=2),
        instrument="EFT",
        direction="outgoing",
        international=False,
        counterparty_country="CA",
    )
    assert not _fire(session, customer, domestic, "AML-TR-001")

    small = receipt(
        session,
        customer,
        cad="400",
        at=NOW + timedelta(hours=3),
        instrument="EFT",
        direction="outgoing",
        international=True,
        counterparty_country="DE",
    )
    assert not _fire(session, customer, small, "AML-TR-001")


def test_trade_discrepancy_needs_the_configured_gap(session, customer):
    wide = receipt(
        session,
        customer,
        cad="48000",
        at=NOW,
        instrument="EFT",
        direction="outgoing",
        international=True,
        counterparty_country="AE",
        context={
            "travel": {
                "originator_name": "Aurora Cross-Border Trading Ltd.",
                "originator_account": "CA1",
                "originator_address": "1 King St, Toronto, CA",
                "beneficiary_name": "Harbour Goods",
                "beneficiary_account": "AE1",
                "beneficiary_address": "Dubai, AE",
                "beneficiary_institution": "Gulf Settlement Bank",
            },
            "trade": {
                "invoice_cad": 48000,
                "declared_goods_cad": 12000,
                "goods_description": "plastic household articles",
                "hs_code": "3924.10",
                "shipment_reference": "SHP-4419",
            },
        },
    )
    found = _fire(session, customer, wide, "AML-TB-001")
    assert found
    assert found[0].observed["discrepancy_ratio"] == 3.0
    assert "not a finding" in found[0].detail

    close = receipt(
        session,
        customer,
        cad="8000",
        at=NOW + timedelta(hours=2),
        instrument="EFT",
        direction="outgoing",
        international=True,
        counterparty_country="US",
        context={
            "trade": {"invoice_cad": 8000, "declared_goods_cad": 7200, "goods_description": "canned vegetables"}
        },
    )
    assert not _fire(session, customer, close, "AML-TB-001")


def test_msb_payouts_need_several_beneficiaries(session):
    business = make_customer(session, "cust_msb", "Prairie Transfer MSB Ltd.", entity=True)
    business.occupation_or_business = "Money services business"
    base = NOW.replace(hour=9)
    for index, amount in enumerate(("1600", "1700", "1500", "1600")):
        receipt(session, business, cad=amount, at=base + timedelta(minutes=30 * index), instrument="CASH")
    last = None
    for index in range(4):
        party = pipeline.get_or_create_party(
            session,
            f"ben_payee_{index}",
            kind=pipeline.PartyKind.BENEFICIARY,
            name=f"Payee {index}",
        )
        last = receipt(
            session,
            business,
            cad="1400",
            at=base + timedelta(hours=10, minutes=15 * index),
            instrument="EFT",
            direction="outgoing",
            international=False,
            counterparty_country="CA",
            beneficiary=party,
        )
    found = _fire(session, business, last, "AML-TB-002")
    assert found
    assert found[0].observed["distinct_beneficiaries"] == 4
    assert not _fire(session, business, last, "AML-FI-004")

    retail = make_customer(session, "cust_retail_msb", "Ordinary Retail Ltd.", entity=True)
    cash = receipt(session, retail, cad="8000", at=NOW, instrument="CASH")
    assert not _fire(session, retail, cash, "AML-TB-002")


def test_casino_minimal_play_fires_and_ordinary_play_does_not(session, customer):
    minimal = receipt(
        session,
        customer,
        cad="9000",
        at=NOW,
        instrument="CASH",
        context={
            "casino": {
                "chips_purchased_cad": 9000,
                "gaming_activity_cad": 450,
                "redemption_cad": 8500,
                "redemption_instrument": "EFT",
                "redemption_to_third_party": True,
                "third_party_name": "Payee North",
            }
        },
    )
    found = _fire(session, customer, minimal, "AML-TB-003")
    assert found
    assert found[0].observed["play_ratio"] < 0.2
    assert "not a finding" in found[0].detail
    assert not _fire(session, customer, minimal, "AML-FI-001")

    ordinary = receipt(
        session,
        customer,
        cad="5000",
        at=NOW + timedelta(hours=3),
        instrument="CASH",
        context={
            "casino": {
                "chips_purchased_cad": 5000,
                "gaming_activity_cad": 3500,
                "redemption_cad": 1400,
                "redemption_instrument": "CASH",
                "redemption_to_third_party": False,
            }
        },
    )
    assert not _fire(session, customer, ordinary, "AML-TB-003")


def test_tuning_projection_and_draft_shape(session, customer):
    assert project([10000, 9999, 15000], 10000, "gte") == 2
    assert project([0.05, 0.70], 0.20, "lte") == 1
    receipt(session, customer, cad="12500", at=NOW, instrument="CASH")
    second = make_customer(session, "cust_cash2", "Helene Bouchard")
    receipt(session, second, cad="9000", at=NOW, instrument="CASH")
    listed = make_customer(session, "cust_score", "Soren Halburg")
    receipt(session, listed, cad="100", at=NOW)
    tuning = book_metrics.tuning_snapshot(session)
    cash = next(item for item in tuning["controls"] if item["id"] == "lctr_threshold")
    assert 12500 in cash["observations"]
    assert 9000 in cash["observations"]
    assert project(cash["observations"], 10000, "gte") >= 1
    assert project(cash["observations"], 13000, "gte") == project(
        [value for value in cash["observations"] if value >= 13000], 13000, "gte"
    )
    scores = next(item for item in tuning["controls"] if item["id"] == "sanctions_score")
    assert any(score >= 0.90 for score in scores["observations"])

    document = draft_filings.threshold_document(
        kind="LCTR",
        alert={
            "id": 1,
            "rule_id": "AML-FI-001",
            "rule_version": "1.0",
            "customer_name": customer.name,
            "evidence_txn_ids": [],
            "explanation": {"detail": "Cash totalled CAD 12,500.00.", "observed": {"aggregated_cad": 12500}, "threshold": {}},
        },
        customer={"id": customer.id, "customer_id": customer.external_id, "name": customer.name, "customer_type": "PERSON", "country": "CA", "occupation_or_business": "Software developer", "profile": {}, "risk": {}},
        transactions=[],
    )
    encoded = str(document).lower()
    assert document["schema"] == "sentinel-draft-1"
    assert document["reportType"] == "LCTR"
    assert "not a determination" in document["disclaimer"].lower()
    assert "money launderer" not in encoded
    assert "is a terrorist" not in encoded


def test_planted_scenarios_name_the_new_indicators():
    dataset = generate(customers=16, days=14, end=NOW, seed=11)
    planted = {item.scenario: item for item in dataset.expectations}
    assert "AML-SC-001" in planted["sanctions_fuzzy"].indicators_expected
    assert "AML-SC-002" in planted["pep_match"].indicators_expected
    assert "AML-TF-001" in planted["terrorist_property"].indicators_expected
    assert "AML-TR-001" in planted["travel_rule_gap"].indicators_expected
    assert "AML-TB-001" in planted["trade_based"].indicators_expected
    assert "AML-TB-002" in planted["msb_payouts"].indicators_expected
    assert "AML-TB-003" in planted["casino_minimal_play"].indicators_expected
    assert planted["trade_within_tolerance"].alert_expected is False
    assert planted["casino_ordinary_play"].alert_expected is False
