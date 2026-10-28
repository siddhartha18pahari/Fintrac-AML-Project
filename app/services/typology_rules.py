"""Screening, travel-rule completeness, and typology indicators.

These evaluators register with the rule engine the same way the cash and wire
rules do. Each one returns an explainable finding or nothing.

An indicator is not a filing and not a legal designation:

* sanctions and PEP hits are matches against the bundled fictional list
* a terrorist-property hit is a *sample* property-report observation
* a travel-rule hit means an international EFT is missing originator or
  beneficiary fields the travel rule expects to be on file
* trade, MSB, and casino hits describe patterns associated with those
  typologies
"""

from __future__ import annotations

from decimal import Decimal

from ..models import Direction, Party
from ..util import cad
from .instruments import instrument_of, is_cash, is_international_eft
from .rules_engine import Finding, Rule, RuleContext, evaluator, total_cad
from .screening import NameHit, match_name

TRAVEL_FIELDS = (
    "originator_name",
    "originator_account",
    "originator_address",
    "beneficiary_name",
    "beneficiary_account",
    "beneficiary_address",
    "beneficiary_institution",
)

_SAMPLE_DISCLAIMER = (
    "The match is against Sentinel's bundled fictional list, not a legal "
    "designation, and it is not a finding that the person is sanctioned, "
    "politically exposed, or a listed person."
)


def is_msb_business(text: str | None) -> bool:
    lowered = (text or "").lower()
    return "money service" in lowered or "remittance" in lowered or lowered.strip() == "msb"


def _party_name(ctx: RuleContext, party_id: int | None) -> str | None:
    if not party_id:
        return None
    party = ctx.session.get(Party, party_id)
    return party.name if party else None


def _subjects(ctx: RuleContext) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = [("customer", ctx.customer.name)]
    beneficiary = _party_name(ctx, ctx.txn.beneficiary_id)
    if beneficiary:
        found.append(("beneficiary", beneficiary))
    third_party = _party_name(ctx, ctx.txn.third_party_id)
    if third_party:
        found.append(("third_party", third_party))
    context = ctx.txn.context or {}
    if context.get("counterparty_name"):
        found.append(("counterparty", str(context["counterparty_name"])))
    travel = context.get("travel") or {}
    if isinstance(travel, dict):
        if str(travel.get("originator_name") or "").strip():
            found.append(("originator", str(travel["originator_name"])))
        if str(travel.get("beneficiary_name") or "").strip():
            found.append(("travel_beneficiary", str(travel["beneficiary_name"])))
    return found


def _screen(ctx: RuleContext, rule: Rule, *, kinds: set[str], title: str, detail_lead: str) -> list[Finding]:
    min_score = float(rule.inputs.get("min_score", 0.90))
    matches: list[tuple[float, str, str, NameHit]] = []
    for label, name in _subjects(ctx):
        for hit in match_name(name, kinds=kinds, min_score=min_score):
            matches.append((hit.score, label, name, hit))
    if not matches:
        return []
    matches.sort(key=lambda item: (-item[0], item[3].entry_id))
    score, label, name, hit = matches[0]
    others = [
        {
            "matched_on": other_label,
            "query": other_name,
            "entry_id": other.entry_id,
            "canonical_name": other.canonical_name,
            "score": round(other.score, 4),
        }
        for other_score, other_label, other_name, other in matches[1:4]
        if other.entry_id != hit.entry_id or other_label != label
    ]
    return [
        Finding(
            rule=rule,
            title=title,
            observed={
                "query_name": name,
                "matched_on": label,
                "matched_name": hit.matched_name,
                "canonical_name": hit.canonical_name,
                "entry_id": hit.entry_id,
                "list": hit.kind,
                "program": hit.program,
                "country": hit.country,
                "score": round(score, 4),
                "other_matches": others,
            },
            threshold={"min_score": min_score, "lists": sorted(kinds)},
            evidence_txn_ids=[ctx.txn.id],
            detail=(
                f"{detail_lead} '{name}' scored {score:.2f} against sample entry "
                f"{hit.entry_id} ({hit.canonical_name}) on the {label.replace('_', ' ')}. "
                f"{_SAMPLE_DISCLAIMER}"
            ),
        )
    ]


@evaluator("sanctions_screen")
def sanctions_screen(ctx: RuleContext, rule: Rule) -> list[Finding]:
    return _screen(
        ctx,
        rule,
        kinds={"SANCTIONS"},
        title="Name resembles an entry on the sample sanctions list",
        detail_lead="Sanctions screen:",
    )


@evaluator("pep_screen")
def pep_screen(ctx: RuleContext, rule: Rule) -> list[Finding]:
    return _screen(
        ctx,
        rule,
        kinds={"PEP"},
        title="Name resembles an entry on the sample PEP list",
        detail_lead="PEP screen:",
    )


@evaluator("terrorist_property_screen")
def terrorist_property_screen(ctx: RuleContext, rule: Rule) -> list[Finding]:
    findings = _screen(
        ctx,
        rule,
        kinds={"TERRORIST_PROPERTY"},
        title="Sample terrorist-property list matched a party on this transaction",
        detail_lead="Terrorist property screen:",
    )
    for finding in findings:
        finding.detail += (
            " If this were a real listed-person match, a Terrorist Property Report "
            "would have to be considered. This sample hit does not create that duty."
        )
    return findings


@evaluator("travel_rule_completeness")
def travel_rule_completeness(ctx: RuleContext, rule: Rule) -> list[Finding]:
    """International EFTs at or above the floor need originator and beneficiary fields.

    Domestic wires are out of scope. A complete travel block produces nothing,
    which is the point of the control: the absence is the indicator.
    """
    if not is_international_eft(ctx.txn):
        return []
    minimum = cad(rule.inputs.get("min_cad", 1000))
    amount = cad(ctx.txn.cad_value)
    if amount < minimum:
        return []
    required = [str(field) for field in (rule.inputs.get("required_fields") or TRAVEL_FIELDS)]
    travel = (ctx.txn.context or {}).get("travel") or {}
    if not isinstance(travel, dict):
        travel = {}
    missing = [field for field in required if not str(travel.get(field) or "").strip()]
    if not missing:
        return []
    present = [field for field in required if field not in missing]
    return [
        Finding(
            rule=rule,
            title="International EFT is missing travel-rule originator or beneficiary fields",
            observed={
                "cad_value": float(amount),
                "direction": ctx.txn.direction.value,
                "missing_fields": missing,
                "present_fields": present,
                "counterparty_country": (ctx.txn.context or {}).get("counterparty_country"),
            },
            threshold={"min_cad": float(minimum), "required_fields": required},
            evidence_txn_ids=[ctx.txn.id],
            detail=(
                f"This international {ctx.txn.direction.value.lower()} EFT of CAD {float(amount):,.2f} "
                f"is missing {', '.join(missing).replace('_', ' ')}. The travel rule expects the "
                "originator and the beneficiary to be identified on the transfer. A gap is a record "
                "defect to cure. It is not, by itself, a ground for suspicion."
            ),
        )
    ]


@evaluator("trade_invoice_discrepancy")
def trade_invoice_discrepancy(ctx: RuleContext, rule: Rule) -> list[Finding]:
    """Invoice value and the declared goods value diverge past a configured ratio."""
    trade = (ctx.txn.context or {}).get("trade") or {}
    if not isinstance(trade, dict) or not trade:
        return []
    try:
        invoice = cad(trade.get("invoice_cad"))
        goods = cad(trade.get("declared_goods_cad"))
    except (TypeError, ValueError, ArithmeticError):
        return []
    minimum = cad(rule.inputs.get("min_invoice_cad", 1000))
    if goods <= 0 or invoice < minimum:
        return []
    ratio = abs(invoice - goods) / goods
    min_ratio = Decimal(str(rule.inputs.get("min_discrepancy_ratio", "0.25")))
    if ratio < min_ratio:
        return []
    relation = "above" if invoice > goods else "below"
    return [
        Finding(
            rule=rule,
            title="Trade payment diverges from the declared goods value",
            observed={
                "invoice_cad": float(invoice),
                "declared_goods_cad": float(goods),
                "discrepancy_ratio": round(float(ratio), 4),
                "invoice_versus_goods": relation,
                "goods_description": trade.get("goods_description"),
                "hs_code": trade.get("hs_code"),
                "shipment_reference": trade.get("shipment_reference"),
            },
            threshold={"min_discrepancy_ratio": float(min_ratio), "min_invoice_cad": float(minimum)},
            evidence_txn_ids=[ctx.txn.id],
            detail=(
                f"The invoice of CAD {float(invoice):,.2f} is {float(ratio):.0%} {relation} the "
                f"declared goods value of CAD {float(goods):,.2f}"
                + (f" for {trade.get('goods_description')}" if trade.get("goods_description") else "")
                + ". A gap of that size is an indicator associated with over- or under-invoicing. "
                "It is not a finding that trade-based laundering occurred."
            ),
        )
    ]


@evaluator("msb_third_party_payout")
def msb_third_party_payout(ctx: RuleContext, rule: Rule) -> list[Finding]:
    """An MSB takes in cash and pays several beneficiaries out on another rail."""
    if not is_msb_business(ctx.customer.occupation_or_business):
        return []
    hours = float(rule.inputs.get("window_hours", 24))
    min_beneficiaries = int(rule.inputs.get("min_beneficiaries", 3))
    min_cash = cad(rule.inputs.get("min_cash_cad", 5000))
    window = ctx.window(hours=hours)
    cash_in = [
        row for row in window if is_cash(row) and row.direction is Direction.INCOMING
    ]
    received = total_cad(cash_in)
    if received < min_cash:
        return []
    beneficiaries = {row.beneficiary_id for row in window if row.beneficiary_id}
    if len(beneficiaries) < min_beneficiaries:
        return []
    payouts = [
        row
        for row in window
        if row.direction is Direction.OUTGOING and not is_cash(row)
    ]
    if not payouts:
        return []
    return [
        Finding(
            rule=rule,
            title="MSB cash-in followed by payouts to several beneficiaries",
            observed={
                "cash_in_cad": float(received),
                "cash_receipts": len(cash_in),
                "distinct_beneficiaries": len(beneficiaries),
                "payouts": len(payouts),
                "payout_instruments": sorted({instrument_of(row).value for row in payouts}),
                "window_hours": hours,
                "business": ctx.customer.occupation_or_business,
            },
            threshold={
                "min_cash_cad": float(min_cash),
                "min_beneficiaries": min_beneficiaries,
                "window_hours": hours,
            },
            evidence_txn_ids=sorted({row.id for row in cash_in} | {row.id for row in payouts}),
            detail=(
                f"{ctx.customer.occupation_or_business} received CAD {float(received):,.2f} in cash "
                f"and paid {len(beneficiaries)} distinct beneficiaries on another rail within "
                f"{hours:.0f} hours. Multiple third-party payouts are an MSB typology indicator. "
                "They are not proof that the business is unregistered or that the funds are illicit."
            ),
        )
    ]


@evaluator("casino_minimal_play")
def casino_minimal_play(ctx: RuleContext, rule: Rule) -> list[Finding]:
    """Chips bought for cash, little play, then value leaves to a third party or by wire."""
    casino = (ctx.txn.context or {}).get("casino") or {}
    if not isinstance(casino, dict) or not casino:
        return []
    try:
        chips = cad(casino.get("chips_purchased_cad") or 0)
        play = cad(casino.get("gaming_activity_cad") or 0)
    except (TypeError, ValueError, ArithmeticError):
        return []
    min_chips = cad(rule.inputs.get("min_chips_cad", 3000))
    if chips < min_chips:
        return []
    ratio = (play / chips) if chips else Decimal("1")
    max_ratio = Decimal(str(rule.inputs.get("max_play_ratio", "0.20")))
    if ratio > max_ratio:
        return []
    redemption_instrument = str(casino.get("redemption_instrument") or "").upper()
    third_party = bool(casino.get("redemption_to_third_party"))
    if not third_party and redemption_instrument not in {"EFT", "WIRE", "VIRTUAL_CURRENCY"}:
        return []
    return [
        Finding(
            rule=rule,
            title="Casino chips purchased and largely redeemed with minimal play",
            observed={
                "chips_purchased_cad": float(chips),
                "gaming_activity_cad": float(play),
                "play_ratio": round(float(ratio), 4),
                "redemption_cad": float(cad(casino.get("redemption_cad") or 0)),
                "redemption_instrument": redemption_instrument or None,
                "redemption_to_third_party": third_party,
                "third_party_name": casino.get("third_party_name"),
            },
            threshold={"min_chips_cad": float(min_chips), "max_play_ratio": float(max_ratio)},
            evidence_txn_ids=[ctx.txn.id],
            detail=(
                f"CAD {float(chips):,.2f} in chips were purchased and CAD {float(play):,.2f} "
                f"({float(ratio):.0%}) was recorded as gaming activity"
                + (" before a third-party redemption" if third_party else " before the value left by transfer")
                + ". Minimal play followed by a redemption is a casino typology indicator. "
                "It is not a finding that the chips were used to launder funds."
            ),
        )
    ]
