"""Cash and electronic-funds indicators.

These evaluators sit beside the virtual-currency catalogue. They register
themselves with the rule engine and only look at the rail they name, so a
Bitcoin receipt cannot produce a Large Cash Transaction Report and a domestic
payroll wire cannot produce an EFTR.

An indicator is still not a filing decision. AML-FI-001 and AML-FI-002 record
that a reporting threshold was reached. AML-FI-003 and AML-FI-005 describe
patterns that *can* be structuring. A person decides whether suspicion exists.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select

from ..config import settings
from ..models import Direction, Instrument, Transaction
from ..util import cad
from .instruments import instrument_of, is_cash, is_eft, is_international_eft
from .rules_engine import Finding, Rule, RuleContext, evaluator, total_cad


def _customer_rows(
    ctx: RuleContext,
    *,
    hours: float,
    instrument: Instrument | None = None,
    direction: Direction | None = None,
) -> list[Transaction]:
    start = ctx.at - timedelta(hours=hours)
    stmt = select(Transaction).where(
        Transaction.customer_id == ctx.customer.id,
        Transaction.occurred_at >= start,
        Transaction.occurred_at <= ctx.at,
    )
    if direction is not None:
        stmt = stmt.where(Transaction.direction == direction)
    rows = list(ctx.session.execute(stmt.order_by(Transaction.occurred_at)).scalars().all())
    if instrument is None:
        return rows
    return [row for row in rows if instrument_of(row) is instrument]


@evaluator("lctr_threshold")
def lctr_threshold(ctx: RuleContext, rule: Rule) -> list[Finding]:
    """Cash received by one conductor, single or within 24 hours, at or above CAD 10,000."""
    if ctx.txn.direction is not Direction.INCOMING or not is_cash(ctx.txn):
        return []
    hours = int(rule.inputs.get("window_hours", settings.aggregation_window_hours))
    threshold = cad(rule.inputs.get("threshold_cad", settings.lctr_threshold_cad))
    window = _customer_rows(ctx, hours=hours, instrument=Instrument.CASH, direction=Direction.INCOMING)
    total = total_cad(window)
    if total < threshold:
        return []
    single = len(window) == 1
    kind = "a single cash receipt" if single else f"{len(window)} cash receipts in {hours} hours"
    return [
        Finding(
            rule=rule,
            title="Large cash transaction reporting threshold reached",
            observed={
                "aggregated_cad": float(total),
                "receipts": len(window),
                "single_transaction": single,
                "window_hours": hours,
                "instrument": Instrument.CASH.value,
            },
            threshold={"cad": float(threshold), "window_hours": hours},
            evidence_txn_ids=[t.id for t in window],
            detail=(
                f"{kind} total CAD {float(total):,.2f}, which meets the "
                f"CAD {float(threshold):,.2f} large cash transaction threshold. "
                "This is a reporting observation, not by itself an indicator of suspicion."
            ),
            occurred_at=window[-1].occurred_at,
        )
    ]


@evaluator("eftr_threshold")
def eftr_threshold(ctx: RuleContext, rule: Rule) -> list[Finding]:
    """International EFTs, single or within 24 hours, at or above CAD 10,000."""
    if not is_international_eft(ctx.txn):
        return []
    hours = int(rule.inputs.get("window_hours", settings.aggregation_window_hours))
    threshold = cad(rule.inputs.get("threshold_cad", settings.eftr_threshold_cad))
    window = [
        row
        for row in _customer_rows(ctx, hours=hours, instrument=Instrument.EFT)
        if is_international_eft(row)
    ]
    # The triggering transfer is international; keep same-direction transfers so
    # an inbound SWIFT and an unrelated outbound payroll do not add together.
    window = [row for row in window if row.direction is ctx.txn.direction]
    total = total_cad(window)
    if total < threshold:
        return []
    countries = sorted(
        {
            str((row.context or {}).get("counterparty_country") or "").upper()
            for row in window
            if (row.context or {}).get("counterparty_country")
        }
    )
    return [
        Finding(
            rule=rule,
            title="International electronic funds transfer reporting threshold reached",
            observed={
                "aggregated_cad": float(total),
                "transfers": len(window),
                "direction": ctx.txn.direction.value,
                "counterparty_countries": countries,
                "window_hours": hours,
                "instrument": Instrument.EFT.value,
            },
            threshold={"cad": float(threshold), "window_hours": hours, "international": True},
            evidence_txn_ids=[t.id for t in window],
            detail=(
                f"{len(window)} international {ctx.txn.direction.value.lower()} electronic funds "
                f"transfer(s) total CAD {float(total):,.2f}"
                + (f" involving {', '.join(countries)}" if countries else "")
                + f", meeting the CAD {float(threshold):,.2f} EFTR threshold. "
                "This is a reporting observation, not by itself an indicator of suspicion."
            ),
            occurred_at=window[-1].occurred_at,
        )
    ]


@evaluator("cash_structuring")
def cash_structuring(ctx: RuleContext, rule: Rule) -> list[Finding]:
    """Several sub-threshold cash receipts that together clear the LCTR line.

    Each receipt stays under CAD 10,000. Together they do not. That pattern is
    a structuring *indicator*. It is also, when the 24-hour total itself
    crosses the line, an LCTR obligation under AML-FI-001 — the two findings
    answer different questions and both are kept.
    """
    if ctx.txn.direction is not Direction.INCOMING or not is_cash(ctx.txn):
        return []
    hours = float(rule.inputs.get("window_hours", 48))
    min_txns = int(rule.inputs.get("min_transactions", 3))
    min_single = cad(rule.inputs.get("min_single_cad", 2000))
    threshold = cad(rule.inputs.get("threshold_cad", settings.lctr_threshold_cad))
    window = _customer_rows(ctx, hours=hours, instrument=Instrument.CASH, direction=Direction.INCOMING)
    pieces = [row for row in window if min_single <= cad(row.cad_value) < threshold]
    if len(pieces) < min_txns:
        return []
    total = total_cad(pieces)
    if total < threshold:
        return []
    return [
        Finding(
            rule=rule,
            title="Cash receipts structured below the reporting threshold",
            observed={
                "receipts": len(pieces),
                "aggregated_cad": float(total),
                "largest_cad": float(max(cad(row.cad_value) for row in pieces)),
                "smallest_cad": float(min(cad(row.cad_value) for row in pieces)),
                "window_hours": hours,
            },
            threshold={
                "min_transactions": min_txns,
                "min_single_cad": float(min_single),
                "max_single_cad": float(threshold),
                "min_aggregate_cad": float(threshold),
                "window_hours": hours,
            },
            evidence_txn_ids=[t.id for t in pieces],
            detail=(
                f"{len(pieces)} cash receipts between CAD {float(min_single):,.2f} and the "
                f"CAD {float(threshold):,.2f} threshold total CAD {float(total):,.2f} within "
                f"{hours:.0f} hours. Each receipt is below the large-cash line; together they "
                "are not. Threshold proximity is not proof of structuring — it is one input "
                "to a holistic review."
            ),
        )
    ]


@evaluator("rapid_cross_rail")
def rapid_cross_rail(ctx: RuleContext, rule: Rule) -> list[Finding]:
    """Value arrives on one rail and leaves on another within a few hours."""
    if ctx.txn.direction is not Direction.OUTGOING:
        return []
    hours = float(rule.inputs.get("window_hours", 6))
    min_ratio = float(rule.inputs.get("min_outflow_ratio", 0.7))
    min_cad = cad(rule.inputs.get("min_cad", 5000))
    out_rail = instrument_of(ctx.txn)
    rows = _customer_rows(ctx, hours=hours)
    inbound = [
        row
        for row in rows
        if row.direction is Direction.INCOMING and instrument_of(row) is not out_rail
    ]
    outbound = [
        row
        for row in rows
        if row.direction is Direction.OUTGOING and instrument_of(row) is out_rail
    ]
    if ctx.txn.id not in {row.id for row in outbound}:
        outbound.append(ctx.txn)
    received = total_cad(inbound)
    sent = total_cad(outbound)
    if received < min_cad or received == 0:
        return []
    ratio = float(sent / received)
    if ratio < min_ratio:
        return []
    inbound_rails = sorted({instrument_of(row).value for row in inbound})
    return [
        Finding(
            rule=rule,
            title="Rapid movement of funds across payment rails",
            observed={
                "received_cad": float(received),
                "sent_cad": float(sent),
                "outflow_ratio": round(ratio, 3),
                "inbound_instruments": inbound_rails,
                "outbound_instrument": out_rail.value,
                "window_hours": hours,
                "inbound_count": len(inbound),
                "outbound_count": len(outbound),
            },
            threshold={"min_outflow_ratio": min_ratio, "window_hours": hours, "min_cad": float(min_cad)},
            evidence_txn_ids=sorted({row.id for row in inbound} | {row.id for row in outbound}),
            detail=(
                f"CAD {float(received):,.2f} arrived via {', '.join(r.replace('_', ' ').lower() for r in inbound_rails)} "
                f"and CAD {float(sent):,.2f} ({ratio:.0%}) left via {out_rail.value.replace('_', ' ').lower()} "
                f"within {hours:.0f} hours."
            ),
        )
    ]


@evaluator("multi_conductor_cash")
def multi_conductor_cash(ctx: RuleContext, rule: Rule) -> list[Finding]:
    """Several customers place sub-threshold cash with the same beneficiary.

    The 24-hour conductor total may stay under the LCTR line for each person
    while the beneficiary still receives CAD 10,000 or more. That is the
    multi-conductor form of smurfing.
    """
    if ctx.txn.direction is not Direction.INCOMING or not is_cash(ctx.txn) or not ctx.txn.beneficiary_id:
        return []
    hours = float(rule.inputs.get("window_hours", 24))
    min_customers = int(rule.inputs.get("min_customers", 3))
    threshold = cad(rule.inputs.get("threshold_cad", settings.lctr_threshold_cad))
    start = ctx.at - timedelta(hours=hours)
    rows = list(
        ctx.session.execute(
            select(Transaction)
            .where(
                Transaction.beneficiary_id == ctx.txn.beneficiary_id,
                Transaction.direction == Direction.INCOMING,
                Transaction.occurred_at >= start,
                Transaction.occurred_at <= ctx.at,
            )
            .order_by(Transaction.occurred_at)
        )
        .scalars()
        .all()
    )
    pieces = [row for row in rows if is_cash(row) and cad(row.cad_value) < threshold]
    customers = {row.customer_id for row in pieces}
    total = total_cad(pieces)
    if len(customers) < min_customers or total < threshold:
        return []
    return [
        Finding(
            rule=rule,
            title="Sub-threshold cash from several customers to one beneficiary",
            observed={
                "beneficiary_id": ctx.txn.beneficiary_id,
                "customer_count": len(customers),
                "customer_ids": sorted(customers),
                "receipts": len(pieces),
                "aggregated_cad": float(total),
                "window_hours": hours,
            },
            threshold={
                "min_customers": min_customers,
                "max_single_cad": float(threshold),
                "min_aggregate_cad": float(threshold),
                "window_hours": hours,
            },
            evidence_txn_ids=[row.id for row in pieces],
            detail=(
                f"{len(customers)} customers placed cash under CAD {float(threshold):,.2f} "
                f"with the same beneficiary, totalling CAD {float(total):,.2f} within {hours:.0f} hours."
            ),
        )
    ]
