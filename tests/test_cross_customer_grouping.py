"""Beneficiary and third-party groupings across *different* conductors.

This is the case the 24-hour rule exists for, and the one most likely to be got
wrong: the grouping is the party, and the conductors differ by design. Anything
that scopes by customer breaks here.
"""

from __future__ import annotations

from datetime import timedelta

from app.models import AggregationType, PartyKind, ReportType
from app.services import aggregation, pipeline, report_builder
from app.services import fintrac_mapper as fm
from conftest import NOW, make_customer, make_party, receipt


def test_one_candidate_per_beneficiary_not_per_conductor(session):
    """Three customers paying one beneficiary must raise ONE candidate."""
    beneficiary = make_party(session, "ben_shared")
    customers = [
        make_customer(session, "cust_a", "Alpha One"),
        make_customer(session, "cust_b", "Bravo Two"),
        make_customer(session, "cust_c", "Charlie Three"),
    ]
    for index, (customer, amount) in enumerate(zip(customers, ["6000", "5000", "4000"])):
        txn = receipt(
            session, customer, cad=amount, at=NOW + timedelta(hours=2 * index), beneficiary=beneficiary
        )
        aggregation.evaluate_transaction(session, txn)

    events = [
        e for e in aggregation.open_events(session) if e.group_type is AggregationType.BENEFICIARY
    ]
    assert len(events) == 1, (
        "a second conductor paying the same beneficiary must extend the open event, "
        "not raise an overlapping duplicate"
    )
    assert len(events[0].covered_txn_ids) == 3
    assert float(events[0].total_cad) == 15000.00


def test_one_candidate_per_third_party_not_per_conductor(session):
    third_party = make_party(session, "tp_shared", kind=PartyKind.THIRD_PARTY)
    for index, name in enumerate(["cust_d", "cust_e"]):
        customer = make_customer(session, name, f"Subject {index}")
        txn = receipt(
            session, customer, cad="6000", at=NOW + timedelta(hours=index), third_party=third_party
        )
        aggregation.evaluate_transaction(session, txn)

    events = [
        e for e in aggregation.open_events(session) if e.group_type is AggregationType.ON_BEHALF_OF
    ]
    assert len(events) == 1
    assert len(events[0].covered_txn_ids) == 2


def test_conductor_groupings_stay_separate_per_customer(session):
    """The fix must not merge two different customers' own conductor windows."""
    for name in ["cust_f", "cust_g"]:
        customer = make_customer(session, name, f"Conductor {name}")
        txn = receipt(session, customer, cad="12000", at=NOW)
        aggregation.evaluate_transaction(session, txn)

    events = [e for e in aggregation.open_events(session) if e.group_type is AggregationType.CONDUCTOR]
    assert len(events) == 2, "each customer conducts their own transactions"
    assert {e.customer_id for e in events} == {e.customer_id for e in events}


def test_each_receipt_names_its_own_conductor_in_the_report(session, users):
    """A beneficiary-grouped LVCTR must not attribute every receipt to one person."""
    beneficiary = make_party(session, "ben_report")
    customers = [
        make_customer(session, "cust_h", "Hotel Four"),
        make_customer(session, "cust_i", "India Five"),
        make_customer(session, "cust_j", "Juliet Six"),
    ]
    for index, (customer, amount) in enumerate(zip(customers, ["4000", "3500", "3000"])):
        receipt(session, customer, cad=amount, at=NOW + timedelta(hours=index), beneficiary=beneficiary)
    pipeline.run(session, with_anomaly=False)

    from sqlalchemy import select

    from app.models import AggregationEvent, Case

    event = session.execute(
        select(AggregationEvent).where(AggregationEvent.group_type == AggregationType.BENEFICIARY)
    ).scalars().one()
    # Report the beneficiary grouping from the case that owns it.
    case = session.execute(select(Case).order_by(Case.id)).scalars().first()
    case.aggregation_event_ids = [event.id]
    case.lvctr_required = True
    session.flush()

    report = report_builder.build_report(session, case, ReportType.LVCTR, actor=users["officer"])
    payload = report.payload

    conductors = {
        action["conductors"][0]["subject"]["$ref"]
        for txn in payload["transactions"]
        for action in txn["startingActions"]
        if action.get("conductors")
    }
    assert len(conductors) == 3, f"expected three distinct conductors, got {conductors}"

    client_numbers = {
        action["conductors"][0]["details"]["clientNumber"]
        for txn in payload["transactions"]
        for action in txn["startingActions"]
    }
    assert client_numbers == {"cust_h", "cust_i", "cust_j"}

    # Every conductor reference must resolve, and nothing may be declared unused.
    index = fm.index_references(payload)
    used = {ref for ref, _ in index.used}
    assert conductors <= set(index.declared)
    assert set(index.declared) - used == set(), "the report declared a subject nothing references"
    assert report.validation["error_count"] == 0, report.validation["issues"]


def test_a_shared_beneficiary_report_covers_every_conductors_receipt(session, users):
    beneficiary = make_party(session, "ben_cover")
    for index, name in enumerate(["cust_k", "cust_l"]):
        customer = make_customer(session, name, f"Subject {name}")
        receipt(session, customer, cad="6000", at=NOW + timedelta(hours=index), beneficiary=beneficiary)
    pipeline.run(session, with_anomaly=False)

    from sqlalchemy import select

    from app.models import AggregationEvent

    event = session.execute(
        select(AggregationEvent).where(AggregationEvent.group_type == AggregationType.BENEFICIARY)
    ).scalars().one()
    assert len(event.covered_txn_ids) == 2
    assert float(event.total_cad) == 12000.00
