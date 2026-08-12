"""Small shared helpers: time, money, business days, ids.

The time helpers exist because a 24-hour rule implemented with a mixture of
aware and naive datetimes is a compliance bug, not a style issue.
"""

from __future__ import annotations

import hashlib
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

CAD_QUANT = Decimal("0.01")


# ---------------------------------------------------------------------------
# Time
# ---------------------------------------------------------------------------


def utcnow() -> datetime:
    """Current UTC time as a *naive* datetime (the storage convention)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_naive_utc(value: datetime) -> datetime:
    """Normalise any datetime to naive UTC."""
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def parse_dt(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        return to_naive_utc(value)
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    return to_naive_utc(datetime.fromisoformat(text))


def iso(value: datetime | None) -> str | None:
    """Render a stored naive-UTC datetime as an ISO-8601 UTC string."""
    if value is None:
        return None
    return value.replace(microsecond=0).isoformat() + "Z"


def iso_local_naive(value: datetime | None) -> str | None:
    """ISO-8601 without a zone designator (the format FINTRAC date-times use)."""
    if value is None:
        return None
    return value.replace(microsecond=0).isoformat()


# ---------------------------------------------------------------------------
# Canadian federal holidays / working days
# ---------------------------------------------------------------------------


def _easter(year: int) -> date:
    """Anonymous Gregorian computus."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return date(year, month, day + 1)


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """n-th ``weekday`` (Mon=0) of a month."""
    d = date(year, month, 1)
    offset = (weekday - d.weekday()) % 7
    return d + timedelta(days=offset + 7 * (n - 1))


def _observed(d: date) -> date:
    """Shift a fixed-date holiday falling on a weekend to the following Monday."""
    if d.weekday() == 5:
        return d + timedelta(days=2)
    if d.weekday() == 6:
        return d + timedelta(days=1)
    return d


def federal_holidays(year: int) -> set[date]:
    """Canadian federal statutory holidays.

    Used only to compute the LVCTR filing deadline in *working* days.  A real
    deployment should reconcile this against the reporting entity's own
    published business calendar.
    """
    easter = _easter(year)
    victoria = date(year, 5, 25) - timedelta(days=1)
    while victoria.weekday() != 0 or victoria.day < 18:  # Monday before May 25
        victoria -= timedelta(days=1)
    return {
        _observed(date(year, 1, 1)),  # New Year's Day
        easter - timedelta(days=2),  # Good Friday
        victoria,  # Victoria Day
        _observed(date(year, 7, 1)),  # Canada Day
        _nth_weekday(year, 9, 0, 1),  # Labour Day
        _observed(date(year, 9, 30)),  # Truth and Reconciliation
        _nth_weekday(year, 10, 0, 2),  # Thanksgiving
        _observed(date(year, 11, 11)),  # Remembrance Day
        _observed(date(year, 12, 25)),  # Christmas Day
        _observed(date(year, 12, 26)),  # Boxing Day
    }


def is_working_day(d: date) -> bool:
    return d.weekday() < 5 and d not in federal_holidays(d.year)


def add_working_days(start: datetime, days: int) -> datetime:
    """Return the end of the n-th working day after the *day of* ``start``.

    FINTRAC's LVCTR timing is expressed as "within N working days after the day
    on which" the amount was received, so counting starts the day after.
    """
    current = start.date()
    remaining = days
    while remaining > 0:
        current += timedelta(days=1)
        if is_working_day(current):
            remaining -= 1
    return datetime.combine(current, datetime.max.time()).replace(microsecond=0)


# ---------------------------------------------------------------------------
# Money
# ---------------------------------------------------------------------------


def cad(value) -> Decimal:
    """Quantise to CAD cents with half-up rounding.

    Every threshold comparison goes through this so that a repr artefact can
    never flip a reporting decision.
    """
    if not isinstance(value, Decimal):
        value = Decimal(str(value))
    return value.quantize(CAD_QUANT, rounding=ROUND_HALF_UP)


def money_str(value) -> str:
    return f"{cad(value):,.2f}"


def token_amount(value) -> str:
    """Render a virtual-currency amount without storage padding or exponents.

    ``Numeric(38, 18)`` round-trips 0.03038853 as ``0.030388530000000000``.
    That is the column's scale showing through, not the amount, and it has no
    business appearing in a narrative or a regulatory payload.
    """
    if value is None:
        return ""
    amount = Decimal(str(value)).normalize()
    if amount == amount.to_integral_value():
        amount = amount.quantize(Decimal(1))
    return format(amount, "f")


# ---------------------------------------------------------------------------
# Identifiers
# ---------------------------------------------------------------------------


def stable_hash(*parts: object) -> str:
    joined = "|".join(str(p) for p in parts)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


def slugify(text: str, max_len: int = 40) -> str:
    out = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").upper()
    return out[:max_len]
