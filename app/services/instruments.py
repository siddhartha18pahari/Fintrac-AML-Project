"""Instrument helpers.

Virtual-currency receipts are the original ledger. Cash and electronic funds
transfers were added later, and every threshold that is specific to one rail
goes through this module so a missing column (or an older row) cannot be
misread as cash.
"""

from __future__ import annotations

from ..models import Instrument, Transaction


def instrument_of(txn: Transaction) -> Instrument:
    value = getattr(txn, "instrument", None)
    if isinstance(value, Instrument):
        return value
    if value is None or value == "":
        return Instrument.VIRTUAL_CURRENCY
    try:
        return Instrument(str(value))
    except ValueError:
        return Instrument.VIRTUAL_CURRENCY


def is_virtual_currency(txn: Transaction) -> bool:
    return instrument_of(txn) is Instrument.VIRTUAL_CURRENCY


def is_cash(txn: Transaction) -> bool:
    return instrument_of(txn) is Instrument.CASH


def is_eft(txn: Transaction) -> bool:
    return instrument_of(txn) is Instrument.EFT


def is_international_eft(txn: Transaction) -> bool:
    """An EFT that crosses the Canadian border.

    Explicit ``context.international`` wins. Otherwise a recorded counterparty
    country other than Canada is treated as international. A domestic wire with
    no country and no flag is not an EFTR candidate.
    """
    if not is_eft(txn):
        return False
    context = txn.context or {}
    if context.get("international") is True:
        return True
    if context.get("international") is False:
        return False
    country = str(context.get("counterparty_country") or "").upper()
    return bool(country) and country != "CA"
