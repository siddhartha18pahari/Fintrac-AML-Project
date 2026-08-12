"""The 24-hour rule engine.

An LVCTR obligation arises when a reporting entity receives virtual currency
worth CAD 10,000 or more, and *also* when two or more receipts totalling CAD
10,000 or more occur within a consecutive 24-hour window and the entity knows
they relate to the same conductor, the same beneficiary, or the same third
party.  So the engine is not ``amount >= 10000``; it is a sliding window
evaluated independently per grouping relationship.

Window semantics
----------------
For a receipt at ``t`` the window is the closed interval ``[t - 24h, t]``.
Both endpoints are inclusive: a receipt exactly 24 hours earlier is still
inside a *consecutive 24-hour period*.  ``WINDOW_START_INCLUSIVE`` makes this
explicit and testable rather than an accident of a comparison operator.

Deduplication
-------------
A naive implementation raises a fresh candidate every time the window is
recomputed, so three receipts crossing the threshold produce three cases.
Instead each grouping keeps one open :class:`AggregationEvent` that *absorbs*
later receipts: the event's ``covered_txn_ids`` is the authoritative set it
reports on, and a new event is only opened when no open event for that grouping
still overlaps the current window.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import AggregationEvent, AggregationType, Direction, Transaction
from ..util import add_working_days, cad, utcnow

#: Whether a receipt landing exactly on ``t - 24h`` counts as inside the window.
WINDOW_START_INCLUSIVE = True


@dataclass(frozen=True)
class GroupKey:
    group_type: AggregationType
    key: str
    label: str


@dataclass
class WindowResult:
    group: GroupKey
    transactions: list[Transaction]
    total_cad: Decimal
    window_start: datetime
    window_end: datetime

    @property
    def proximity(self) -> float:
        """``total / threshold``.  0.988 means "CAD 9,880 of a 10,000 threshold".

        Proximity is *not* evidence of structuring on its own; it is one input
        to a holistic review and is surfaced as such.
        """
        threshold = Decimal(settings.lvctr_threshold_cad)
        if threshold == 0:
            return 0.0
        return float(self.total_cad / threshold)


def grouping_keys(txn: Transaction) -> list[GroupKey]:
    """The relationships a receipt can be aggregated on.

    ``CONDUCTOR`` is the customer conducting the transaction; the other two are
    only present when the reporting entity actually knows about them, which is
    exactly the statutory condition ("and the entity knows that they were
    conducted on behalf of / for the benefit of the same person or entity").
    """
    keys = [GroupKey(AggregationType.CONDUCTOR, f"customer:{txn.customer_id}", "same conductor")]
    if txn.beneficiary_id:
        keys.append(GroupKey(AggregationType.BENEFICIARY, f"party:{txn.beneficiary_id}", "same beneficiary"))
    if txn.third_party_id:
        keys.append(GroupKey(AggregationType.ON_BEHALF_OF, f"party:{txn.third_party_id}", "same third party"))
    return keys


def _group_filter(group: GroupKey):
    kind, raw = group.key.split(":", 1)
    value = int(raw)
    if group.group_type is AggregationType.CONDUCTOR:
        return Transaction.customer_id == value
    if group.group_type is AggregationType.BENEFICIARY:
        return Transaction.beneficiary_id == value
    return Transaction.third_party_id == value


def window_for(
    session: Session,
    group: GroupKey,
    end: datetime,
    *,
    hours: int | None = None,
) -> WindowResult:
    """Receipts belonging to ``group`` inside the window ending at ``end``."""
    hours = hours or settings.aggregation_window_hours
    start = end - timedelta(hours=hours)
    lower = Transaction.occurred_at >= start if WINDOW_START_INCLUSIVE else Transaction.occurred_at > start
    rows = (
        session.execute(
            select(Transaction)
            .where(
                and_(
                    _group_filter(group),
                    Transaction.direction == Direction.INCOMING,
                    lower,
                    Transaction.occurred_at <= end,
                )
            )
            .order_by(Transaction.occurred_at)
        )
        .scalars()
        .all()
    )
    total = cad(sum((Decimal(str(t.cad_value)) for t in rows), Decimal("0")))
    return WindowResult(group=group, transactions=rows, total_cad=total, window_start=start, window_end=end)


def threshold_met(total: Decimal) -> bool:
    """CAD 10,000 **or more** - the boundary value itself is reportable."""
    return cad(total) >= cad(settings.lvctr_threshold_cad)


def _open_event_for(session: Session, group: GroupKey) -> AggregationEvent | None:
    """The open event for a grouping, if one exists.

    Scoped by ``group_key`` alone and deliberately **not** by customer.  For a
    beneficiary or third-party grouping the conductors differ by design - that
    is the whole point of the rule - so filtering on the customer would fail to
    find the open event and raise a second, overlapping candidate for the same
    beneficiary.  ``group_key`` already encodes the customer for conductor
    groupings (``customer:N``), so nothing is lost.
    """
    return session.execute(
        select(AggregationEvent)
        .where(
            AggregationEvent.group_type == group.group_type,
            AggregationEvent.group_key == group.key,
            AggregationEvent.reported.is_(False),
        )
        .order_by(AggregationEvent.id.desc())
    ).scalars().first()


def evaluate_transaction(session: Session, txn: Transaction) -> list[AggregationEvent]:
    """Evaluate one receipt against every grouping and return touched events.

    Only incoming receipts create an LVCTR obligation; outgoing dispositions are
    still monitored by the rules engine but are not aggregated here.
    """
    if txn.direction is not Direction.INCOMING:
        return []

    touched: list[AggregationEvent] = []
    for group in grouping_keys(txn):
        result = window_for(session, group, txn.occurred_at)
        if not threshold_met(result.total_cad):
            continue

        txn_ids = [t.id for t in result.transactions]
        event = _open_event_for(session, group)

        if event is not None and set(event.covered_txn_ids) & set(txn_ids):
            # The existing open event still overlaps the live window: absorb the
            # new receipt instead of raising a duplicate candidate.
            covered = sorted(set(event.covered_txn_ids) | set(txn_ids))
            event.covered_txn_ids = covered
            event.window_start = min(event.window_start, result.window_start)
            event.window_end = max(event.window_end, result.window_end)
            event.total_cad = _sum_of(session, covered)
            event.single_transaction = len(covered) == 1
            event.threshold_met = threshold_met(event.total_cad)
            event.updated_at = utcnow()
        else:
            event = AggregationEvent(
                group_type=group.group_type,
                group_key=group.key,
                customer_id=txn.customer_id,
                window_start=result.window_start,
                window_end=result.window_end,
                total_cad=result.total_cad,
                covered_txn_ids=txn_ids,
                threshold_met=True,
                single_transaction=len(txn_ids) == 1,
                threshold_cad=cad(settings.lvctr_threshold_cad),
                due_at=filing_due_date(result.window_end),
            )
            session.add(event)
            session.flush()

        # The clock runs from the day the reportable amount was received.
        event.due_at = filing_due_date(event.window_end)
        touched.append(event)

    session.flush()
    return touched


def _sum_of(session: Session, txn_ids: list[int]) -> Decimal:
    if not txn_ids:
        return cad(0)
    rows = session.execute(select(Transaction.cad_value).where(Transaction.id.in_(txn_ids))).scalars().all()
    return cad(sum((Decimal(str(v)) for v in rows), Decimal("0")))


def filing_due_date(received_at: datetime) -> datetime:
    """Five working days after the day on which the amount was received."""
    return add_working_days(received_at, settings.filing_deadline_working_days)


def aggregation_type_code(group_type: AggregationType) -> str:
    """Map to FINTRAC's ``twentyFourHourAggregationTypeCode``."""
    return {
        AggregationType.BENEFICIARY: "1",
        AggregationType.CONDUCTOR: "2",
        AggregationType.ON_BEHALF_OF: "3",
        AggregationType.NOT_APPLICABLE: "4",
    }[group_type]


def open_events(session: Session, *, customer_id: int | None = None) -> list[AggregationEvent]:
    stmt = select(AggregationEvent).where(AggregationEvent.reported.is_(False))
    if customer_id is not None:
        stmt = stmt.where(AggregationEvent.customer_id == customer_id)
    return list(session.execute(stmt.order_by(AggregationEvent.due_at)).scalars().all())


def events_due_within(session: Session, hours: int) -> list[AggregationEvent]:
    cutoff = utcnow() + timedelta(hours=hours)
    return list(
        session.execute(
            select(AggregationEvent)
            .where(
                AggregationEvent.reported.is_(False),
                AggregationEvent.due_at.is_not(None),
                AggregationEvent.due_at <= cutoff,
            )
            .order_by(AggregationEvent.due_at)
        )
        .scalars()
        .all()
    )


def near_threshold_windows(
    session: Session, txn: Transaction, *, floor: float = 0.75
) -> list[WindowResult]:
    """Windows that approach but do not reach the threshold.

    Surfaced for holistic review only.  See ``AML-VC-002``.
    """
    out = []
    for group in grouping_keys(txn):
        result = window_for(session, group, txn.occurred_at)
        if not threshold_met(result.total_cad) and result.proximity >= floor:
            out.append(result)
    return out
