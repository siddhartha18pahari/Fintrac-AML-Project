"""Seeded book simulator and the rules it is willing to light up."""

from __future__ import annotations

from app.services.book_simulator import evaluate, simulate


def _controls(**overrides):
    base = {
        "seed": 11,
        "days": 14,
        "customers": 12,
        "structuring": False,
        "layering": False,
        "mules": False,
        "trade": False,
        "offramp": False,
        "round_trip": False,
        "payroll": False,
        "rent": False,
    }
    base.update(overrides)
    return base


def test_the_same_seed_repeats_the_ledger():
    first = simulate(_controls())
    second = simulate(_controls())
    assert [row["cad"] for row in first["transactions"]] == [row["cad"] for row in second["transactions"]]
    assert first["summary"]["transactions"] > 20


def test_retail_amounts_follow_a_positive_lognormal_draw():
    book = simulate(_controls(mu=6.2, sigma=0.85))
    retail = [row for row in book["transactions"] if row["typology"] == "retail"]
    assert retail
    assert all(row["cad"] > 0 for row in retail)
    assert any(row["channel"] == "VIRTUAL_CURRENCY" for row in retail)
    assert any(row["city"] == "Toronto" for row in retail)


def test_structuring_stays_under_the_cash_line_and_fires_fi_003():
    book = simulate(_controls(structuring=True))
    planted = [row for row in book["transactions"] if row["typology"] == "structuring" and row["beneficiary"] == "Harbour Counter"]
    assert len(planted) >= 3
    assert all(row["cad"] < 10000 for row in planted)
    assert all(row["channel"] == "CASH" for row in planted)
    rules = {hit["rule_id"] for hit in book["hits"]}
    assert "AML-FI-003" in rules
    assert "AML-FI-005" in rules


def test_each_planted_typology_has_a_hit():
    book = simulate(
        _controls(
            structuring=True,
            layering=True,
            mules=True,
            trade=True,
            offramp=True,
            round_trip=True,
            payroll=True,
            rent=True,
        )
    )
    rules = {hit["rule_id"] for hit in book["hits"]}
    for rule_id in (
        "AML-FI-002",
        "AML-FI-003",
        "AML-FI-004",
        "AML-FI-005",
        "TYPOLOGY-LAYERING",
        "TYPOLOGY-MULE",
        "TYPOLOGY-TBML",
        "TYPOLOGY-OFFRAMP",
        "TYPOLOGY-ROUNDTRIP",
    ):
        assert rule_id in rules
    payroll = [row for row in book["transactions"] if row["typology"] == "payroll"]
    assert payroll
    assert all(row["channel"] == "EFT" and row["direction"] == "IN" for row in payroll)
    hours = book["summary"]["by_hour"]
    assert sum(hours) == book["summary"]["transactions"]
    assert sum(hours[9:17]) > sum(hours[0:6])


def test_turning_typologies_off_removes_their_hits():
    quiet = simulate(_controls())
    rules = {hit["rule_id"] for hit in quiet["hits"]}
    assert "TYPOLOGY-MULE" not in rules
    assert "AML-FI-003" not in rules


def test_customers_carry_kyc_and_the_rails_a_report_would_name():
    book = simulate(_controls(payroll=True, rent=True))
    profile = book["customers"][0]
    assert profile["occupation"]
    assert profile["income_band"]
    assert profile["account_number"].startswith("700")
    assert profile["province"]
    sample = book["transactions"][0]
    for field in ("conductor", "method", "disposition", "account_type", "purpose", "counterparty"):
        assert field in sample
    channels = {row["channel"] for row in book["transactions"]}
    assert {"E_TRANSFER", "CARD", "EFT"} <= channels
    assert book["summary"]["window_start"] == "2026-02-02"
    assert "merchants" in book["directory"]


def test_camouflage_plants_a_benign_lookalike_the_cash_rule_can_flag():
    book = simulate(_controls(camouflage=0.35))
    lookalikes = [row for row in book["transactions"] if row["typology"] == "lookalike"]
    assert lookalikes
    assert all(row["ground_truth"] == "benign" for row in lookalikes)
    assert any(hit["rule_id"] == "AML-FI-003" for hit in book["hits"])
    assert book["evaluation"]["fp"] > 0
    assert book["evaluation"]["precision"] < 1


def test_a_spread_out_structuring_plant_can_be_missed():
    book = simulate(_controls(structuring=True, camouflage=0.9, intensity=0.2))
    stats = {item["typology"]: item for item in book["evaluation"]["by_typology"]}
    assert stats["structuring"]["plants"] > stats["structuring"]["detected"]
    assert book["evaluation"]["fn"] > 0
    assert book["evaluation"]["median_hours_to_detect"] is not None


def test_python_book_matches_the_typescript_engine():
    import subprocess
    from pathlib import Path

    from app.services.bank_engine import fingerprint

    root = Path(__file__).resolve().parents[1]
    completed = subprocess.run(
        ["npx", "--yes", "tsx", "web/scripts/sim-fingerprint.ts"],
        cwd=root,
        capture_output=True,
        text=True,
        check=True,
        timeout=90,
    )
    book = simulate(
        _controls(
            structuring=True,
            layering=True,
            mules=True,
            trade=True,
            offramp=True,
            round_trip=True,
            funnel=True,
            rapid=True,
            professional=True,
            payroll=True,
            rent=True,
            camouflage=0,
            intensity=0.55,
        )
    )
    assert fingerprint(book) == completed.stdout.strip()
    assert book["evaluation"]["by_typology"]


def test_evaluate_flags_a_single_large_cash_receipt():
    hits = evaluate(
        [
            {
                "id": "cash-1",
                "at": "2026-03-04T11:00:00",
                "customer": "Solo",
                "channel": "CASH",
                "direction": "IN",
                "counterparty_country": "CA",
                "cad": 12500,
                "typology": "retail",
                "beneficiary": "",
                "flow_id": "",
            }
        ]
    )
    assert hits[0]["rule_id"] == "AML-FI-001"
