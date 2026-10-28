"""Observations the workspace can re-threshold, plus labelled-scenario recall.

The tuning series are not a second rule engine. Each control stores the
numbers the in-force rule already compares — a 24-hour cash total, a name
score, a play ratio — so moving a slider recounts how many of those
observations would clear the new line.

Labelled recall counts planted ``indicators_expected`` pairs that also produced
an alert. Alerts outside those pairs are unlabelled. They are not adjudicated
false positives, and they are not a precision claim about money laundering.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import HIGH_RISK_JURISDICTIONS
from ..models import Customer, Direction, Party, Transaction
from ..util import cad
from .instruments import is_cash, is_international_eft
from .rules_engine import load_catalogue
from .screening import best_match
from .typology_rules import TRAVEL_FIELDS, is_msb_business

TUNING_DISCLAIMER = (
    "Projected volume replays observations stored from this book against a new "
    "threshold. It does not re-run detection, and it does not file anything."
)

PERFORMANCE_DISCLAIMER = (
    "Recall here is the share of planted scenario indicators that produced an "
    "alert. It measures whether the engine rediscovered patterns the generator "
    "inserted. Alerts outside those labels are unlabelled activity — background "
    "retail, or an extra indicator the scenario did not list. They are not "
    "adjudicated false positives and they are not a measure of money laundering."
)

COUNTRY_NAMES = {
    "AE": "United Arab Emirates",
    "AF": "Afghanistan",
    "CA": "Canada",
    "CN": "China",
    "DE": "Germany",
    "GB": "United Kingdom",
    "IR": "Iran",
    "KP": "North Korea",
    "MM": "Myanmar",
    "SY": "Syria",
    "US": "United States",
}

PROVINCE_NAMES = {
    "AB": "Alberta",
    "BC": "British Columbia",
    "MB": "Manitoba",
    "NB": "New Brunswick",
    "NL": "Newfoundland and Labrador",
    "NS": "Nova Scotia",
    "NT": "Northwest Territories",
    "NU": "Nunavut",
    "ON": "Ontario",
    "PE": "Prince Edward Island",
    "QC": "Quebec",
    "SK": "Saskatchewan",
    "YT": "Yukon",
}


def project(observations: list[float], threshold: float, direction: str) -> int:
    if direction == "gte":
        return sum(1 for value in observations if value + 1e-9 >= threshold)
    if direction == "lte":
        return sum(1 for value in observations if value <= threshold + 1e-9)
    raise ValueError(f"unknown direction {direction!r}")


def _rule_inputs(rule_id: str) -> dict:
    chosen = None
    for rule in load_catalogue().rules:
        if rule.id != rule_id:
            continue
        if rule.effective_to is not None:
            continue
        chosen = rule
    return dict(chosen.inputs) if chosen else {}


def _daily_peaks(rows: list[Transaction], *, hours: int = 24) -> list[float]:
    groups: dict[tuple, list[Transaction]] = defaultdict(list)
    for row in rows:
        groups[(row.customer_id, row.direction.value)].append(row)
    peaks: list[float] = []
    for group in groups.values():
        group.sort(key=lambda txn: (txn.occurred_at, txn.id))
        best: dict[str, float] = {}
        for txn in group:
            start = txn.occurred_at - timedelta(hours=hours)
            total = sum(
                float(other.cad_value)
                for other in group
                if start <= other.occurred_at <= txn.occurred_at
            )
            day = txn.occurred_at.date().isoformat()
            best[day] = max(best.get(day, 0.0), total)
        peaks.extend(round(value, 2) for value in best.values())
    return peaks


def _control(
    *,
    control_id: str,
    rule_id: str,
    label: str,
    parameter: str,
    unit: str,
    direction: str,
    default: float,
    low: float,
    high: float,
    step: float,
    help_text: str,
    observations: list[float],
) -> dict:
    return {
        "id": control_id,
        "rule_id": rule_id,
        "label": label,
        "parameter": parameter,
        "unit": unit,
        "direction": direction,
        "default": default,
        "min": low,
        "max": high,
        "step": step,
        "help": help_text,
        "observations": observations,
        "baseline": project(observations, default, direction),
    }


def tuning_snapshot(session: Session) -> dict:
    rows = list(session.execute(select(Transaction)).scalars().all())
    customers = list(session.execute(select(Customer)).scalars().all())
    parties = list(session.execute(select(Party)).scalars().all())
    by_customer = {customer.id: customer for customer in customers}

    lctr_inputs = _rule_inputs("AML-FI-001")
    lctr_default = float(lctr_inputs.get("threshold_cad", 10000))
    cash_in = [row for row in rows if is_cash(row) and row.direction is Direction.INCOMING]

    eftr_inputs = _rule_inputs("AML-FI-002")
    eftr_default = float(eftr_inputs.get("threshold_cad", 10000))
    international = [row for row in rows if is_international_eft(row)]

    sanctions_inputs = _rule_inputs("AML-SC-001")
    sanctions_default = float(sanctions_inputs.get("min_score", 0.90))
    scores: list[float] = []
    for customer in customers:
        hit = best_match(customer.name, kinds={"SANCTIONS"})
        if hit is not None:
            scores.append(round(hit.score, 4))
    for party in parties:
        hit = best_match(party.name, kinds={"SANCTIONS"})
        if hit is not None:
            scores.append(round(hit.score, 4))

    trade_inputs = _rule_inputs("AML-TB-001")
    trade_default = float(trade_inputs.get("min_discrepancy_ratio", 0.25))
    trade_min_invoice = cad(trade_inputs.get("min_invoice_cad", 1000))
    trade_ratios: list[float] = []
    for row in rows:
        trade = (row.context or {}).get("trade") or {}
        if not isinstance(trade, dict) or not trade:
            continue
        try:
            invoice = cad(trade.get("invoice_cad"))
            goods = cad(trade.get("declared_goods_cad"))
        except (TypeError, ValueError, ArithmeticError):
            continue
        if goods <= 0 or invoice < trade_min_invoice:
            continue
        trade_ratios.append(round(float(abs(invoice - goods) / goods), 4))

    travel_inputs = _rule_inputs("AML-TR-001")
    travel_floor = cad(travel_inputs.get("min_cad", 1000))
    required = [str(field) for field in (travel_inputs.get("required_fields") or TRAVEL_FIELDS)]
    missing_counts: list[float] = []
    for row in international:
        if cad(row.cad_value) < travel_floor:
            continue
        travel = (row.context or {}).get("travel") or {}
        if not isinstance(travel, dict):
            travel = {}
        missing = sum(1 for field in required if not str(travel.get(field) or "").strip())
        missing_counts.append(float(missing))

    casino_inputs = _rule_inputs("AML-TB-003")
    casino_default = float(casino_inputs.get("max_play_ratio", 0.20))
    min_chips = cad(casino_inputs.get("min_chips_cad", 3000))
    play_ratios: list[float] = []
    for row in rows:
        casino = (row.context or {}).get("casino") or {}
        if not isinstance(casino, dict) or not casino:
            continue
        try:
            chips = cad(casino.get("chips_purchased_cad") or 0)
            play = cad(casino.get("gaming_activity_cad") or 0)
        except (TypeError, ValueError, ArithmeticError):
            continue
        if chips < min_chips:
            continue
        play_ratios.append(round(float(play / chips), 4))

    msb_inputs = _rule_inputs("AML-TB-002")
    msb_default = float(msb_inputs.get("min_beneficiaries", 3))
    msb_cash_floor = cad(msb_inputs.get("min_cash_cad", 5000))
    msb_hours = float(msb_inputs.get("window_hours", 24))
    msb_counts: list[float] = []
    msb_rows: dict[int, list[Transaction]] = defaultdict(list)
    for row in rows:
        customer = by_customer.get(row.customer_id)
        if customer is None or not is_msb_business(customer.occupation_or_business):
            continue
        msb_rows[row.customer_id].append(row)
    for group in msb_rows.values():
        group.sort(key=lambda txn: (txn.occurred_at, txn.id))
        best: dict[str, int] = {}
        for txn in group:
            start = txn.occurred_at - timedelta(hours=msb_hours)
            window = [other for other in group if start <= other.occurred_at <= txn.occurred_at]
            cash_receipts = [
                other
                for other in window
                if is_cash(other) and other.direction is Direction.INCOMING
            ]
            received = sum((cad(other.cad_value) for other in cash_receipts), start=cad(0))
            payouts = [
                other
                for other in window
                if other.direction is Direction.OUTGOING and not is_cash(other)
            ]
            if received < msb_cash_floor or not payouts:
                continue
            beneficiaries = len({other.beneficiary_id for other in window if other.beneficiary_id})
            day = txn.occurred_at.date().isoformat()
            best[day] = max(best.get(day, 0), beneficiaries)
        msb_counts.extend(float(value) for value in best.values())

    controls = [
        _control(
            control_id="lctr_threshold",
            rule_id="AML-FI-001",
            label="Large cash threshold",
            parameter="threshold_cad",
            unit="CAD",
            direction="gte",
            default=lctr_default,
            low=2000,
            high=30000,
            step=500,
            help_text="Customer-days whose largest trailing 24-hour cash receipt total would meet the line.",
            observations=_daily_peaks(cash_in),
        ),
        _control(
            control_id="eftr_threshold",
            rule_id="AML-FI-002",
            label="International EFT threshold",
            parameter="threshold_cad",
            unit="CAD",
            direction="gte",
            default=eftr_default,
            low=2000,
            high=50000,
            step=500,
            help_text="Customer-days, split by direction, whose trailing 24-hour international EFT total would meet the line.",
            observations=_daily_peaks(international),
        ),
        _control(
            control_id="sanctions_score",
            rule_id="AML-SC-001",
            label="Sanctions name similarity",
            parameter="min_score",
            unit="score",
            direction="gte",
            default=sanctions_default,
            low=0.70,
            high=1,
            step=0.01,
            help_text="Customer and party names whose best score against the sample sanctions list would clear the line.",
            observations=scores,
        ),
        _control(
            control_id="trade_discrepancy",
            rule_id="AML-TB-001",
            label="Trade invoice discrepancy",
            parameter="min_discrepancy_ratio",
            unit="ratio",
            direction="gte",
            default=trade_default,
            low=0.05,
            high=3,
            step=0.05,
            help_text="Trade payments whose invoice-to-goods gap would clear the ratio. 0.25 means the invoice differs by a quarter of the goods value.",
            observations=trade_ratios,
        ),
        _control(
            control_id="travel_missing",
            rule_id="AML-TR-001",
            label="Travel-rule fields missing",
            parameter="min_missing_fields",
            unit="fields",
            direction="gte",
            default=1,
            low=0,
            high=float(len(required)),
            step=1,
            help_text="International EFTs at or above the travel-rule floor, counted when at least this many required fields are blank.",
            observations=missing_counts,
        ),
        _control(
            control_id="casino_play",
            rule_id="AML-TB-003",
            label="Casino maximum play ratio",
            parameter="max_play_ratio",
            unit="ratio",
            direction="lte",
            default=casino_default,
            low=0,
            high=1,
            step=0.05,
            help_text="Chip purchases of at least the catalogue minimum whose recorded play is at or under this share of the buy-in.",
            observations=play_ratios,
        ),
        _control(
            control_id="msb_beneficiaries",
            rule_id="AML-TB-002",
            label="MSB distinct beneficiaries",
            parameter="min_beneficiaries",
            unit="beneficiaries",
            direction="gte",
            default=msb_default,
            low=0,
            high=8,
            step=1,
            help_text="MSB customer-days with enough cash and a payout on another rail, counted when the distinct beneficiaries reach this number.",
            observations=msb_counts,
        ),
    ]
    return {"disclaimer": TUNING_DISCLAIMER, "controls": controls}


def _score_stats(scores: list[float]) -> dict:
    if not scores:
        return {"count": 0, "median": None, "mean": None, "p90": None}
    ordered = sorted(scores)

    def percentile(fraction: float) -> float:
        index = min(len(ordered) - 1, max(0, int(round(fraction * (len(ordered) - 1)))))
        return round(ordered[index], 4)

    return {
        "count": len(scores),
        "median": round(float(statistics.median(scores)), 4),
        "mean": round(float(statistics.fmean(scores)), 4),
        "p90": percentile(0.90),
    }


def labelled_performance(
    *,
    expectations: list[dict],
    alerts: list[dict],
    customers: list[dict],
    anomalies: list[dict],
    rules: list[dict],
) -> dict:
    names = {}
    for rule in rules:
        names.setdefault(rule["rule_id"], rule["name"])
    ref_by_id = {customer["id"]: customer["customer_id"] for customer in customers}
    name_by_ref = {customer["customer_id"]: customer["name"] for customer in customers}
    alerts_by_ref: dict[str, set[str]] = defaultdict(set)
    for alert in alerts:
        ref = ref_by_id.get(alert["customer_id"])
        if ref:
            alerts_by_ref[ref].add(alert["rule_id"])

    expected_pairs: set[tuple[str, str]] = set()
    scenario_by_pair: dict[tuple[str, str], str] = {}
    for expectation in expectations:
        for rule_id in expectation.get("indicators_expected") or []:
            pair = (expectation["customer_id"], rule_id)
            expected_pairs.add(pair)
            scenario_by_pair[pair] = expectation.get("scenario_type") or ""

    alert_pairs = {(ref, rule_id) for ref, rule_ids in alerts_by_ref.items() for rule_id in rule_ids}
    detected = expected_pairs & alert_pairs
    missed = expected_pairs - alert_pairs
    outside = alert_pairs - expected_pairs

    by_rule: dict[str, dict] = {}
    for ref, rule_id in expected_pairs | outside:
        bucket = by_rule.setdefault(
            rule_id,
            {"rule_id": rule_id, "name": names.get(rule_id, rule_id), "expected": 0, "detected": 0, "missed": 0, "outside": 0},
        )
        if (ref, rule_id) in expected_pairs:
            bucket["expected"] += 1
            if (ref, rule_id) in detected:
                bucket["detected"] += 1
            else:
                bucket["missed"] += 1
        else:
            bucket["outside"] += 1
    rows = []
    for bucket in by_rule.values():
        bucket["recall"] = round(bucket["detected"] / bucket["expected"], 4) if bucket["expected"] else None
        rows.append(bucket)
    rows.sort(key=lambda item: (-item["expected"], -item["outside"], item["rule_id"]))

    misses = [
        {
            "customer_id": ref,
            "customer_name": name_by_ref.get(ref),
            "rule_id": rule_id,
            "scenario": scenario_by_pair.get((ref, rule_id)),
        }
        for ref, rule_id in sorted(missed)
    ]

    positive_refs = {item["customer_id"] for item in expectations if item.get("alert_expected")}
    planted_scores: list[float] = []
    other_scores: list[float] = []
    for anomaly in anomalies:
        ref = ref_by_id.get(anomaly["customer_id"])
        score = float(anomaly["score"])
        if ref in positive_refs:
            planted_scores.append(score)
        else:
            other_scores.append(score)

    recall = round(len(detected) / len(expected_pairs), 4) if expected_pairs else None
    return {
        "disclaimer": PERFORMANCE_DISCLAIMER,
        "planted_indicators": len(expected_pairs),
        "detected": len(detected),
        "missed": len(missed),
        "recall": recall,
        "alerts_total": len(alerts),
        "alerts_inside_labels": len(detected),
        "alerts_outside_labels": len(outside),
        "by_rule": rows,
        "misses": misses[:40],
        "anomaly": {
            "available": bool(anomalies),
            "planted_alert_customers": _score_stats(planted_scores),
            "other_customers": _score_stats(other_scores),
            "note": (
                "The anomaly score is unsupervised. The split below compares customers "
                "the generator marked alert_expected with everyone else. A higher median "
                "on the planted side is a sanity check, not an ROC and not a precision claim."
            ),
        },
    }


def geography(customers: list[dict], transactions: list[dict], alerts: list[dict]) -> dict:
    by_id = {customer["id"]: customer for customer in customers}
    provinces: dict[str, dict] = defaultdict(
        lambda: {"customers": 0, "alerts": 0, "residual_sum": 0.0, "high_residual": 0}
    )
    for customer in customers:
        code = str((customer.get("profile") or {}).get("province") or "").upper() or "—"
        bucket = provinces[code]
        bucket["customers"] += 1
        bucket["residual_sum"] += float(customer["risk"]["residual"])
        if customer["risk"]["tier"] in {"HIGH", "CRITICAL"}:
            bucket["high_residual"] += 1
    for alert in alerts:
        customer = by_id.get(alert["customer_id"])
        if customer is None:
            continue
        code = str((customer.get("profile") or {}).get("province") or "").upper() or "—"
        provinces[code]["alerts"] += 1

    province_rows = []
    for code, bucket in provinces.items():
        customers_n = bucket["customers"] or 1
        province_rows.append(
            {
                "code": code,
                "name": PROVINCE_NAMES.get(code, code),
                "customers": bucket["customers"],
                "alerts": bucket["alerts"],
                "high_residual": bucket["high_residual"],
                "mean_residual": round(bucket["residual_sum"] / customers_n, 1),
            }
        )
    province_rows.sort(key=lambda item: (-item["alerts"], item["code"]))

    countries: dict[str, dict] = defaultdict(
        lambda: {"transactions": 0, "cad": 0.0, "incoming_cad": 0.0, "outgoing_cad": 0.0}
    )
    for txn in transactions:
        context = txn.get("context") or {}
        code = str(context.get("counterparty_country") or context.get("beneficiary_country") or "").upper()
        if not code or code == "CA":
            continue
        bucket = countries[code]
        amount = float(txn["cad_value"])
        bucket["transactions"] += 1
        bucket["cad"] += amount
        if txn["direction"] == "INCOMING":
            bucket["incoming_cad"] += amount
        else:
            bucket["outgoing_cad"] += amount
    country_rows = []
    for code, bucket in countries.items():
        country_rows.append(
            {
                "code": code,
                "name": COUNTRY_NAMES.get(code, code),
                "transactions": bucket["transactions"],
                "cad": round(bucket["cad"], 2),
                "incoming_cad": round(bucket["incoming_cad"], 2),
                "outgoing_cad": round(bucket["outgoing_cad"], 2),
                "high_risk_jurisdiction": code in HIGH_RISK_JURISDICTIONS,
            }
        )
    country_rows.sort(key=lambda item: (-item["cad"], item["code"]))
    return {
        "disclaimer": (
            "Province is the customer's onboarding address. Foreign exposure is the "
            "counterparty country recorded on a transaction. The higher-risk set is "
            "the same placeholder list as AML-VC-009, not a sanctions list."
        ),
        "provinces": province_rows,
        "countries": country_rows,
    }
