"""CAD valuation of virtual-currency amounts.

A reporting entity has to establish the CAD-equivalent of a virtual-currency
receipt consistently, and has to be able to justify that figure later.  So the
rate used for each transaction is *snapshotted* into ``price_quotes`` together
with its source and methodology version, and the transaction points at that
snapshot.  Re-running valuation later never silently changes an old decision.

The bundled oracle is a deterministic offline feed: prices are a reproducible
function of ``(asset, hour)``, so the whole demo replays identically on any
machine with no network access.  Swap :class:`PriceOracle` for a real market
data client in production - the rest of the system only depends on
:func:`value_amount` returning a quote it can persist.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import PriceQuote
from ..util import cad, utcnow

#: Anchor prices in CAD.  Chosen to be plausible, not current - this is an
#: offline synthetic feed and is labelled as such in every quote it emits.
ANCHOR_PRICES_CAD: dict[str, Decimal] = {
    "BTC": Decimal("118400.00"),
    "ETH": Decimal("3475.00"),
    "USDT": Decimal("1.37"),
    "USDC": Decimal("1.37"),
    "LTC": Decimal("142.00"),
    "XMR": Decimal("236.00"),
    "SOL": Decimal("205.00"),
    "DOGE": Decimal("0.21"),
}

#: Relative daily volatility used by the synthetic walk.
VOLATILITY: dict[str, float] = {"USDT": 0.001, "USDC": 0.001}
DEFAULT_VOLATILITY = 0.035

SOURCE_NAME = "sentinel_offline_reference_feed"


@dataclass(frozen=True)
class Valuation:
    asset: str
    asset_amount: Decimal
    price_cad: Decimal
    cad_value: Decimal
    source: str
    quoted_at: datetime
    methodology_version: str


class PriceOracle:
    """Deterministic offline price feed.

    ``price(asset, at)`` is a pure function of the asset and the *hour* of
    ``at``: identical inputs always produce an identical rate, which is what
    makes an audit re-run reproducible.
    """

    def __init__(self, methodology_version: str | None = None) -> None:
        self.methodology_version = methodology_version or settings.valuation_methodology_version

    @staticmethod
    def _wobble(asset: str, bucket: int) -> float:
        """Smooth pseudo-random multiplier in roughly [-1, 1]."""
        seed = hashlib.sha256(f"{asset}:{bucket}".encode()).digest()
        a = int.from_bytes(seed[:4], "big") / 0xFFFFFFFF
        b = int.from_bytes(seed[4:8], "big") / 0xFFFFFFFF
        return math.sin(2 * math.pi * a) * (0.4 + 0.6 * b)

    def price(self, asset: str, at: datetime) -> Decimal:
        asset = asset.upper()
        anchor = ANCHOR_PRICES_CAD.get(asset)
        if anchor is None:
            raise ValueError(f"No reference price configured for asset {asset!r}")
        vol = VOLATILITY.get(asset, DEFAULT_VOLATILITY)
        hour_bucket = int(at.timestamp() // 3600)
        # Two overlapping scales: a slow drift plus an hourly wobble.
        drift = self._wobble(asset + "|drift", hour_bucket // 168) * vol * 3
        tick = self._wobble(asset, hour_bucket) * vol
        multiplier = Decimal(str(round(1.0 + drift + tick, 8)))
        return (anchor * multiplier).quantize(Decimal("0.0000000001"))

    def valuation(self, asset: str, amount: Decimal, at: datetime) -> Valuation:
        rate = self.price(asset, at)
        return Valuation(
            asset=asset.upper(),
            asset_amount=Decimal(str(amount)),
            price_cad=rate,
            cad_value=cad(Decimal(str(amount)) * rate),
            source=SOURCE_NAME,
            quoted_at=at,
            methodology_version=self.methodology_version,
        )


oracle = PriceOracle()


def value_amount(
    session: Session,
    asset: str,
    amount: Decimal | float | str,
    at: datetime,
    *,
    explicit_rate: Decimal | float | str | None = None,
    source: str | None = None,
) -> tuple[Valuation, PriceQuote]:
    """Value ``amount`` of ``asset`` at time ``at`` and persist the quote.

    ``explicit_rate`` lets an ingestion feed supply the rate the reporting
    entity actually used (which is what must be reported); the oracle is only a
    fallback for feeds that do not carry one.
    """
    amount = Decimal(str(amount))
    if explicit_rate is not None:
        rate = Decimal(str(explicit_rate))
        valuation = Valuation(
            asset=asset.upper(),
            asset_amount=amount,
            price_cad=rate,
            cad_value=cad(amount * rate),
            source=source or "reporting_entity_supplied",
            quoted_at=at,
            methodology_version=oracle.methodology_version,
        )
    else:
        valuation = oracle.valuation(asset, amount, at)

    quote = _get_or_create_quote(session, valuation)
    return valuation, quote


def _get_or_create_quote(session: Session, valuation: Valuation) -> PriceQuote:
    """Reuse an identical quote rather than writing a row per transaction."""
    existing = session.execute(
        select(PriceQuote).where(
            PriceQuote.asset == valuation.asset,
            PriceQuote.price_cad == valuation.price_cad,
            PriceQuote.quoted_at == valuation.quoted_at,
            PriceQuote.methodology_version == valuation.methodology_version,
            PriceQuote.source == valuation.source,
        )
    ).scalar_one_or_none()
    if existing:
        return existing
    quote = PriceQuote(
        asset=valuation.asset,
        price_cad=valuation.price_cad,
        source=valuation.source,
        quoted_at=valuation.quoted_at,
        methodology_version=valuation.methodology_version,
        created_at=utcnow(),
    )
    session.add(quote)
    session.flush()
    return quote


def reproduce(session: Session, quote_id: int, amount: Decimal | float | str) -> Decimal:
    """Recompute a CAD figure from a stored quote - the auditor's entry point."""
    quote = session.get(PriceQuote, quote_id)
    if quote is None:
        raise LookupError(f"price quote {quote_id} not found")
    return cad(Decimal(str(amount)) * Decimal(str(quote.price_cad)))
