"""Compliance regression tests for the LVCTR threshold and the 24-hour rule.

These are the tests that matter most: every one of them encodes a reporting
outcome, so a refactor that quietly changes when an obligation arises fails
here rather than in production.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest

from app.config import settings
from app.models import AggregationType, Direction, PartyKind
from app.services import aggregation
from conftest import NOW, make_party, receipt


# ---------------------------------------------------------------------------
# Single-transaction threshold
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "amount,expected",
    [
        ("9999.99", False),   # a cent below - no obligation
        ("10000.00", True),   # "CAD 10,000 or more": the boundary itself reports
        ("10000.01", True),
        ("25000.00", True),
    ],
)
def test_single_receipt_threshold_boundary(session, customer, amount, expected):
    txn = receipt(session, customer, cad=amount, at=NOW)
    events = aggregation.evaluate_transaction(session, txn)
    assert bool(events) is expected
    if expected:
        assert events[0].single_transaction is True
        assert events[0].total_cad == Decimal(amount)


def test_outgoing_disposition_creates_no_lvctr_obligation(session, customer):
    """An LVCTR arises on *receipt* of virtual currency, not on sending it."""
    txn = receipt(session, customer, cad="50000", at=NOW, direction="outgoing")
    assert txn.direction is Direction.OUTGOING
    assert aggregation.evaluate_transaction(session, txn) == []


# ---------------------------------------------------------------------------
# 24-hour aggregation
# ---------------------------------------------------------------------------


def test_aggregate_below_threshold_does_not_report(session, customer):
    for hours in (0, 4, 8):
        txn = receipt(session, customer, cad="3000", at=NOW + timedelta(hours=hours))
        events = aggregation.evaluate_transaction(session, txn)
    assert events == []


def test_aggregate_at_threshold_reports(session, customer):
    amounts = ["4000", "3500", "2500"]
    events = []
    for index, amount in enumerate(amounts):
        txn = receipt(session, customer, cad=amount, at=NOW + timedelta(hours=4 * index))
        events = aggregation.evaluate_transaction(session, txn)
    assert len(events) == 1
    event = events[0]
    assert event.threshold_met is True
    assert event.total_cad == Decimal("10000.00")
    assert len(event.covered_txn_ids) == 3
    assert event.single_transaction is False


def test_window_boundary_inclusive_and_exclusive(session, customer):
    """A at 12:00; B at +23h59m is inside; C at +24h01m excludes A."""
    a = receipt(session, customer, cad="6000", at=NOW)
    b = receipt(session, customer, cad="5000", at=NOW + timedelta(hours=23, minutes=59))
    events = aggregation.evaluate_transaction(session, b)
    assert events and events[0].total_cad == Decimal("11000.00")
    assert sorted(events[0].covered_txn_ids) == sorted([a.id, b.id])

    session.query(type(events[0])).delete()
    session.flush()

    c = receipt(session, customer, cad="5000", at=NOW + timedelta(hours=24, minutes=1))
    window = aggregation.window_for(
        session, aggregation.grouping_keys(c)[0], c.occurred_at
    )
    covered = {t.id for t in window.transactions}
    assert a.id not in covered, "a receipt more than 24 hours earlier must fall out of the window"
    assert b.id in covered and c.id in covered


def test_exactly_24_hours_apart_is_inside_the_window(session, customer):
    """A consecutive 24-hour period is a closed interval, so t-24h counts.

    ``WINDOW_START_INCLUSIVE`` makes this an explicit, testable decision rather
    than a side effect of choosing >= over >.
    """
    assert aggregation.WINDOW_START_INCLUSIVE is True
    a = receipt(session, customer, cad="6000", at=NOW)
    b = receipt(session, customer, cad="4000", at=NOW + timedelta(hours=24))
    events = aggregation.evaluate_transaction(session, b)
    assert events, "receipts exactly 24 hours apart should aggregate"
    assert sorted(events[0].covered_txn_ids) == sorted([a.id, b.id])


# ---------------------------------------------------------------------------
# Deduplication
# ---------------------------------------------------------------------------


def test_sliding_window_does_not_create_a_case_per_receipt(session, customer):
    """09:00 4,000 / 13:00 3,500 / 18:00 4,000 must yield ONE candidate."""
    base = NOW.replace(hour=9, minute=0)
    schedule = [(0, "4000"), (4, "3500"), (9, "4000")]
    created = []
    for hours, amount in schedule:
        txn = receipt(session, customer, cad=amount, at=base + timedelta(hours=hours))
        created.extend(aggregation.evaluate_transaction(session, txn))

    open_events = aggregation.open_events(session, customer_id=customer.id)
    assert len(open_events) == 1, "the sliding window must absorb receipts, not multiply candidates"
    event = open_events[0]
    assert event.total_cad == Decimal("11500.00")
    assert len(event.covered_txn_ids) == 3


def test_later_receipt_extends_the_open_event(session, customer):
    base = NOW.replace(hour=9, minute=0)
    for hours, amount in [(0, "6000"), (2, "5000")]:
        txn = receipt(session, customer, cad=amount, at=base + timedelta(hours=hours))
        aggregation.evaluate_transaction(session, txn)

    extra = receipt(session, customer, cad="2000", at=base + timedelta(hours=5))
    aggregation.evaluate_transaction(session, extra)

    events = aggregation.open_events(session, customer_id=customer.id)
    assert len(events) == 1
    assert events[0].total_cad == Decimal("13000.00")
    assert extra.id in events[0].covered_txn_ids


# ---------------------------------------------------------------------------
# Grouping relationships
# ---------------------------------------------------------------------------


def test_same_beneficiary_across_customers_aggregates(session):
    from conftest import make_customer

    beneficiary = make_party(session, "ben_shared")
    a = make_customer(session, "cust_a", "Alpha One")
    b = make_customer(session, "cust_b", "Bravo Two")

    receipt(session, a, cad="6000", at=NOW, beneficiary=beneficiary)
    second = receipt(session, b, cad="5000", at=NOW + timedelta(hours=3), beneficiary=beneficiary)
    events = aggregation.evaluate_transaction(session, second)

    kinds = {e.group_type for e in events}
    assert AggregationType.BENEFICIARY in kinds, "receipts for the same beneficiary must aggregate"
    beneficiary_event = next(e for e in events if e.group_type is AggregationType.BENEFICIARY)
    assert beneficiary_event.total_cad == Decimal("11000.00")


def test_different_beneficiaries_do_not_aggregate(session, customer):
    first = make_party(session, "ben_one")
    second = make_party(session, "ben_two")
    receipt(session, customer, cad="6000", at=NOW, beneficiary=first)
    later = receipt(session, customer, cad="3000", at=NOW + timedelta(hours=2), beneficiary=second)
    events = aggregation.evaluate_transaction(session, later)
    assert not any(e.group_type is AggregationType.BENEFICIARY for e in events)


def test_third_party_grouping(session, customer):
    third_party = make_party(session, "tp_one", kind=PartyKind.THIRD_PARTY)
    receipt(session, customer, cad="5500", at=NOW, third_party=third_party)
    later = receipt(session, customer, cad="4500", at=NOW + timedelta(hours=6), third_party=third_party)
    events = aggregation.evaluate_transaction(session, later)
    assert any(e.group_type is AggregationType.ON_BEHALF_OF for e in events)


def test_aggregation_type_codes_match_fintrac():
    assert aggregation.aggregation_type_code(AggregationType.BENEFICIARY) == "1"
    assert aggregation.aggregation_type_code(AggregationType.CONDUCTOR) == "2"
    assert aggregation.aggregation_type_code(AggregationType.ON_BEHALF_OF) == "3"
    assert aggregation.aggregation_type_code(AggregationType.NOT_APPLICABLE) == "4"


# ---------------------------------------------------------------------------
# Threshold proximity
# ---------------------------------------------------------------------------


def test_threshold_proximity_is_reported_but_is_not_an_obligation(session, customer):
    for index, amount in enumerate(["3300", "3200", "3350"]):
        txn = receipt(session, customer, cad=amount, at=NOW + timedelta(hours=index))
    windows = aggregation.near_threshold_windows(session, txn, floor=0.75)
    assert windows, "a 98.5% window should be surfaced for review"
    assert round(windows[0].proximity, 3) == 0.985
    assert aggregation.open_events(session, customer_id=customer.id) == []


# ---------------------------------------------------------------------------
# Filing deadline
# ---------------------------------------------------------------------------


def test_filing_due_date_counts_working_days(session, customer):
    from datetime import datetime

    # Monday 2026-08-10 -> five working days -> Monday 2026-08-17.
    received = datetime(2026, 8, 10, 9, 0)
    due = aggregation.filing_due_date(received)
    assert due.date().isoformat() == "2026-08-17"
    assert settings.filing_deadline_working_days == 5


def test_filing_due_date_skips_weekends_and_holidays():
    from datetime import datetime

    from app.util import add_working_days, is_working_day

    # Christmas Day 2026 falls on a Friday.
    assert is_working_day(datetime(2026, 12, 25).date()) is False
    assert is_working_day(datetime(2026, 12, 26).date()) is False  # Saturday, Boxing Day
    # Friday + 1 working day is the following Monday.
    assert add_working_days(datetime(2026, 8, 14, 10, 0), 1).date().isoformat() == "2026-08-17"
