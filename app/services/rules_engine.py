"""Configurable, versioned AML rule engine.

Rules live in ``app/rules/aml_rules.yaml``.  Each one names an ``evaluator``
registered here with :func:`evaluator`; the YAML supplies the thresholds.  That
split matters for two reasons:

* a compliance officer can retune a threshold without a code change, and
* every firing records the rule *version* and the exact observed-vs-threshold
  values, so an alert can be explained and reproduced years later.

Every evaluator returns :class:`Finding` objects carrying an explainability
payload - never a bare score.
"""

from __future__ import annotations

import functools
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Callable, Iterable

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import (
    AggregationEvent,
    Customer,
    CustomerBaseline,
    Direction,
    RuleVersion,
    Transaction,
    Wallet,
)
from ..util import cad, parse_dt, stable_hash, utcnow
from . import graph_engine
from .aggregation import aggregation_type_code, window_for, grouping_keys

RULES_PATH = Path(__file__).resolve().parent.parent / "rules" / "aml_rules.yaml"

_EVALUATORS: dict[str, Callable] = {}


def evaluator(name: str):
    def wrapper(fn):
        _EVALUATORS[name] = fn
        return fn

    return wrapper


# ---------------------------------------------------------------------------
# Rule catalogue
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Rule:
    id: str
    version: str
    name: str
    category: str
    severity: str
    evaluator: str
    inputs: dict
    score_base: int
    effective_from: datetime
    effective_to: datetime | None
    description: str = ""
    #: How repeated firings collapse into one alert.
    #:
    #: ``evidence`` - identity is the exact evidence set.  Correct for rules
    #: that describe one discrete observation (a specific counterparty, a
    #: specific round trip).
    #:
    #: ``daily`` - identity is (rule, customer, calendar day).  Correct for
    #: window rules: each new receipt inside a rolling window re-fires the rule
    #: with a slightly larger evidence set, and without this the queue fills
    #: with near-duplicates of the same finding.  The surviving alert absorbs
    #: the widest evidence set seen that day.
    dedupe: str = "evidence"

    def in_force(self, at: datetime) -> bool:
        if at < self.effective_from:
            return False
        return self.effective_to is None or at < self.effective_to


@dataclass
class RuleCatalogue:
    rules: list[Rule]
    catalogue_version: str

    def in_force(self, at: datetime) -> list[Rule]:
        """Rules effective at ``at``, at most one version per rule id."""
        chosen: dict[str, Rule] = {}
        for rule in self.rules:
            if not rule.in_force(at):
                continue
            current = chosen.get(rule.id)
            if current is None or rule.effective_from > current.effective_from:
                chosen[rule.id] = rule
        return sorted(chosen.values(), key=lambda r: r.id)

    def get(self, rule_id: str, version: str) -> Rule | None:
        for rule in self.rules:
            if rule.id == rule_id and rule.version == version:
                return rule
        return None


@functools.lru_cache(maxsize=1)
def load_catalogue(path: str | None = None) -> RuleCatalogue:
    source = Path(path) if path else RULES_PATH
    raw = yaml.safe_load(source.read_text(encoding="utf-8"))
    rules = []
    for entry in raw.get("rules", []):
        rules.append(
            Rule(
                id=entry["id"],
                version=str(entry["version"]),
                name=entry["name"],
                category=entry.get("category", "other"),
                severity=entry.get("severity", "medium"),
                evaluator=entry["evaluator"],
                inputs=entry.get("inputs") or {},
                score_base=int(entry.get("score", {}).get("base", 0)),
                effective_from=parse_dt(entry["effective_from"]),
                effective_to=parse_dt(entry["effective_to"]) if entry.get("effective_to") else None,
                description=(entry.get("description") or "").strip(),
                dedupe=str(entry.get("dedupe", "evidence")).lower(),
            )
        )
    return RuleCatalogue(rules=rules, catalogue_version=str(raw.get("meta", {}).get("catalogue_version", "0")))


def sync_rule_versions(session: Session) -> int:
    """Persist the YAML catalogue so cases stay reproducible if the file moves."""
    catalogue = load_catalogue()
    written = 0
    for rule in catalogue.rules:
        exists = session.execute(
            select(RuleVersion).where(RuleVersion.rule_id == rule.id, RuleVersion.version == rule.version)
        ).scalar_one_or_none()
        if exists:
            continue
        session.add(
            RuleVersion(
                rule_id=rule.id,
                version=rule.version,
                name=rule.name,
                category=rule.category,
                severity=rule.severity,
                definition={
                    "inputs": rule.inputs,
                    "score": {"base": rule.score_base},
                    "evaluator": rule.evaluator,
                    "description": rule.description,
                },
                effective_from=rule.effective_from,
                effective_to=rule.effective_to,
            )
        )
        written += 1
    session.flush()
    return written


# ---------------------------------------------------------------------------
# Findings
# ---------------------------------------------------------------------------


@dataclass
class Finding:
    rule: Rule
    title: str
    observed: dict
    threshold: dict
    evidence_txn_ids: list[int] = field(default_factory=list)
    detail: str = ""
    score: int | None = None
    occurred_at: datetime | None = None

    @property
    def points(self) -> int:
        return self.rule.score_base if self.score is None else self.score

    def explanation(self) -> dict:
        return {
            "rule_id": self.rule.id,
            "rule_version": self.rule.version,
            "rule_name": self.rule.name,
            "category": self.rule.category,
            "severity": self.rule.severity,
            "score_contribution": self.points,
            "observed": self.observed,
            "threshold": self.threshold,
            "evidence_ids": self.evidence_txn_ids,
            "detail": self.detail,
        }

    def dedupe_key(self, customer_id: int) -> str:
        if self.rule.dedupe == "daily":
            day = (self.occurred_at or utcnow()).date().isoformat()
            return stable_hash(self.rule.id, self.rule.version, customer_id, "day", day)[:32]
        return stable_hash(self.rule.id, self.rule.version, customer_id, sorted(self.evidence_txn_ids))[:32]


# ---------------------------------------------------------------------------
# Evaluation context
# ---------------------------------------------------------------------------


@dataclass
class RuleContext:
    session: Session
    txn: Transaction
    customer: Customer
    baseline: CustomerBaseline | None = None
    aggregation_events: list[AggregationEvent] = field(default_factory=list)
    _cache: dict = field(default_factory=dict)

    @property
    def at(self) -> datetime:
        return self.txn.occurred_at

    def window(self, *, hours: float, direction: Direction | None = None) -> list[Transaction]:
        key = ("window", hours, direction)
        if key not in self._cache:
            start = self.at - timedelta(hours=hours)
            stmt = select(Transaction).where(
                Transaction.customer_id == self.customer.id,
                Transaction.occurred_at >= start,
                Transaction.occurred_at <= self.at,
            )
            if direction is not None:
                stmt = stmt.where(Transaction.direction == direction)
            self._cache[key] = list(
                self.session.execute(stmt.order_by(Transaction.occurred_at)).scalars().all()
            )
        return self._cache[key]

    def after(self, *, minutes: float, direction: Direction | None = None) -> list[Transaction]:
        """Transactions in the ``minutes`` following the trigger."""
        key = ("after", minutes, direction)
        if key not in self._cache:
            stmt = select(Transaction).where(
                Transaction.customer_id == self.customer.id,
                Transaction.occurred_at > self.at,
                Transaction.occurred_at <= self.at + timedelta(minutes=minutes),
            )
            if direction is not None:
                stmt = stmt.where(Transaction.direction == direction)
            self._cache[key] = list(
                self.session.execute(stmt.order_by(Transaction.occurred_at)).scalars().all()
            )
        return self._cache[key]

    def wallet(self, address: str | None) -> Wallet | None:
        """Look up a counterparty address.

        The same address string can exist on more than one chain (and an
        exchange's hot wallet routinely does), so this must not assume a single
        row.  The chain of the transaction under evaluation wins; otherwise the
        earliest-seen record is used.
        """
        if not address:
            return None
        key = ("wallet", address)
        if key not in self._cache:
            rows = list(
                self.session.execute(
                    select(Wallet).where(Wallet.address == address).order_by(Wallet.id)
                )
                .scalars()
                .all()
            )
            match = next((w for w in rows if w.blockchain == self.txn.blockchain), None)
            self._cache[key] = match or (rows[0] if rows else None)
        return self._cache[key]

    @property
    def graph(self) -> graph_engine.GraphView:
        if "graph" not in self._cache:
            self._cache["graph"] = graph_engine.build_graph(
                self.session, since=self.at - timedelta(days=30), until=self.at
            )
        return self._cache["graph"]


def total_cad(txns: Iterable[Transaction]) -> Decimal:
    return cad(sum((Decimal(str(t.cad_value)) for t in txns), Decimal("0")))


# ---------------------------------------------------------------------------
# Evaluators
# ---------------------------------------------------------------------------


@evaluator("aggregation_threshold")
def _aggregation_threshold(ctx: RuleContext, rule: Rule) -> list[Finding]:
    findings = []
    for event in ctx.aggregation_events:
        if not event.threshold_met:
            continue
        kind = "single receipt" if event.single_transaction else "24-hour aggregation"
        findings.append(
            Finding(
                rule=rule,
                title=f"LVCTR threshold reached by {kind}",
                observed={
                    "aggregated_cad": float(event.total_cad),
                    "receipts": len(event.covered_txn_ids),
                    "grouping": event.group_type.value,
                    "aggregation_type_code": aggregation_type_code(event.group_type),
                    "window_start": event.window_start.isoformat(),
                    "window_end": event.window_end.isoformat(),
                },
                threshold={"cad": float(event.threshold_cad), "window_hours": settings.aggregation_window_hours},
                evidence_txn_ids=list(event.covered_txn_ids),
                detail=(
                    f"{len(event.covered_txn_ids)} receipt(s) grouped on "
                    f"{event.group_type.value.replace('_', ' ').lower()} totalling "
                    f"CAD {float(event.total_cad):,.2f}."
                ),
                occurred_at=event.window_end,
            )
        )
    return findings


@evaluator("near_threshold_accumulation")
def _near_threshold(ctx: RuleContext, rule: Rule) -> list[Finding]:
    min_proximity = float(rule.inputs.get("min_proximity", 0.85))
    min_txns = int(rule.inputs.get("min_transactions", 3))
    findings = []
    for group in grouping_keys(ctx.txn):
        result = window_for(ctx.session, group, ctx.at)
        if len(result.transactions) < min_txns:
            continue
        if result.total_cad >= cad(settings.lvctr_threshold_cad):
            continue  # already a reporting obligation; AML-VC-012 covers it
        if result.proximity < min_proximity:
            continue
        findings.append(
            Finding(
                rule=rule,
                title="Receipts accumulating just below the reporting threshold",
                observed={
                    "aggregated_cad": float(result.total_cad),
                    "threshold_proximity": round(result.proximity, 4),
                    "receipts": len(result.transactions),
                    "grouping": group.group_type.value,
                },
                threshold={
                    "min_proximity": min_proximity,
                    "min_transactions": min_txns,
                    "reporting_threshold_cad": float(settings.lvctr_threshold_cad),
                },
                evidence_txn_ids=[t.id for t in result.transactions],
                detail=(
                    f"{len(result.transactions)} receipts totalling CAD {float(result.total_cad):,.2f} "
                    f"({result.proximity:.1%} of the reporting threshold) grouped on {group.label}. "
                    "Proximity to a threshold is not by itself evidence of structuring."
                ),
            )
        )
        break  # one finding per transaction is enough; the grouping is in the payload
    return findings


@evaluator("baseline_deviation")
def _baseline_deviation(ctx: RuleContext, rule: Rule) -> list[Finding]:
    """Compare a 24-hour total against the customer's *active-day* average.

    The comparator is the average over days the customer actually transacted,
    not the average over every calendar day.  For a customer who deposits twice
    a month, an all-days average is near zero, so a perfectly ordinary deposit
    scores as a 30x deviation - the rule would alert on almost everybody and
    the alert would mean nothing.  The customer's largest previous day is
    reported alongside it so a reviewer can see whether the activity is
    genuinely unprecedented for this subject.
    """
    baseline = ctx.baseline
    min_txns = int(rule.inputs.get("min_baseline_txns", 5))
    min_active = int(rule.inputs.get("min_active_days", 3))
    if baseline is None or baseline.txn_count < min_txns or baseline.active_days < min_active:
        return []
    comparator = Decimal(str(baseline.avg_active_day_cad))
    if comparator <= 0:
        return []

    window = ctx.window(hours=24, direction=Direction.INCOMING)
    observed = total_cad(window)
    min_window = cad(rule.inputs.get("min_window_cad", 0))
    if observed < min_window:
        return []

    multiple = float(observed / comparator)
    min_multiple = float(rule.inputs.get("min_multiple", 5.0))
    if multiple < min_multiple:
        return []

    previous_max = Decimal(str(baseline.max_day_cad))
    return [
        Finding(
            rule=rule,
            title="Receipt volume far above the customer's own baseline",
            observed={
                "window_24h_cad": float(observed),
                "baseline_avg_active_day_cad": float(comparator),
                "baseline_max_day_cad": float(previous_max),
                "multiple_vs_active_day_avg": round(multiple, 2),
                "multiple_vs_previous_max": round(float(observed / previous_max), 2) if previous_max else None,
                "baseline_txn_count": baseline.txn_count,
                "baseline_active_days": baseline.active_days,
                "baseline_lookback_days": baseline.lookback_days,
            },
            threshold={
                "min_multiple": min_multiple,
                "min_window_cad": float(min_window),
                "min_baseline_txns": min_txns,
                "min_active_days": min_active,
            },
            evidence_txn_ids=[t.id for t in window],
            detail=(
                f"CAD {float(observed):,.2f} received in 24 hours against an active-day average of "
                f"CAD {float(comparator):,.2f} over {baseline.active_days} active day(s) in "
                f"{baseline.lookback_days} days ({multiple:.1f}x); the customer's previous busiest day was "
                f"CAD {float(previous_max):,.2f}."
            ),
        )
    ]


@evaluator("expected_volume_breach")
def _expected_volume(ctx: RuleContext, rule: Rule) -> list[Finding]:
    expected = Decimal(str(ctx.customer.expected_monthly_volume_cad or 0))
    if expected <= 0:
        return []
    days = int(rule.inputs.get("window_days", 30))
    window = ctx.window(hours=days * 24, direction=Direction.INCOMING)
    observed = total_cad(window)
    multiple = float(observed / expected)
    min_multiple = float(rule.inputs.get("min_multiple", 3.0))
    if multiple < min_multiple:
        return []
    return [
        Finding(
            rule=rule,
            title="Activity inconsistent with the customer's stated expected volume",
            observed={
                "window_days": days,
                "received_cad": float(observed),
                "expected_monthly_cad": float(expected),
                "multiple": round(multiple, 2),
                "stated_business": ctx.customer.occupation_or_business,
            },
            threshold={"min_multiple": min_multiple},
            evidence_txn_ids=[t.id for t in window],
            detail=(
                f"CAD {float(observed):,.2f} received over {days} days against a declared expected "
                f"monthly volume of CAD {float(expected):,.2f} ({multiple:.1f}x)."
            ),
        )
    ]


@evaluator("dormant_reactivation")
def _dormant(ctx: RuleContext, rule: Rule) -> list[Finding]:
    dormant_days = int(rule.inputs.get("dormant_days", 90))
    min_cad = cad(rule.inputs.get("min_cad", 0))
    if cad(ctx.txn.cad_value) < min_cad:
        return []
    previous = ctx.session.execute(
        select(Transaction)
        .where(Transaction.customer_id == ctx.customer.id, Transaction.occurred_at < ctx.at)
        .order_by(Transaction.occurred_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if previous is None:
        return []
    gap_days = (ctx.at - previous.occurred_at).total_seconds() / 86400
    if gap_days < dormant_days:
        return []
    return [
        Finding(
            rule=rule,
            title="Dormant relationship suddenly active",
            observed={
                "days_inactive": round(gap_days, 1),
                "last_activity": previous.occurred_at.isoformat(),
                "reactivation_cad": float(ctx.txn.cad_value),
            },
            threshold={"dormant_days": dormant_days, "min_cad": float(min_cad)},
            evidence_txn_ids=[previous.id, ctx.txn.id],
            detail=(
                f"No activity for {gap_days:.0f} days, then a CAD {float(ctx.txn.cad_value):,.2f} receipt."
            ),
        )
    ]


@evaluator("rapid_multi_wallet_inbound")
def _rapid_multi_wallet(ctx: RuleContext, rule: Rule) -> list[Finding]:
    minutes = float(rule.inputs.get("window_minutes", 60))
    min_senders = int(rule.inputs.get("min_unique_senders", 5))
    min_txns = int(rule.inputs.get("min_transactions", 5))
    window = ctx.window(hours=minutes / 60, direction=Direction.INCOMING)
    senders = {t.wallet_from for t in window if t.wallet_from}
    if len(window) < min_txns or len(senders) < min_senders:
        return []
    span = (window[-1].occurred_at - window[0].occurred_at).total_seconds() / 60 if len(window) > 1 else 0
    return [
        Finding(
            rule=rule,
            title="Rapid inbound activity from multiple distinct wallets",
            observed={
                "unique_senders": len(senders),
                "transaction_count": len(window),
                "window_minutes": round(span, 1),
                "total_cad": float(total_cad(window)),
            },
            threshold={
                "min_unique_senders": min_senders,
                "min_transactions": min_txns,
                "window_minutes": minutes,
            },
            evidence_txn_ids=[t.id for t in window],
            detail=f"{len(window)} receipts from {len(senders)} distinct wallets within {span:.0f} minutes.",
        )
    ]


@evaluator("rapid_pass_through")
def _pass_through(ctx: RuleContext, rule: Rule) -> list[Finding]:
    """Value in, value straight back out.

    The denominator is everything received in the preceding window, not just
    the triggering receipt.  Dividing a consolidated withdrawal by one of the
    several deposits that funded it produces ratios over 100%, which reads as
    an error and tells a reviewer nothing about how much of the inflow left.
    """
    if ctx.txn.direction is not Direction.INCOMING:
        return []
    minutes = float(rule.inputs.get("window_minutes", 180))
    min_ratio = float(rule.inputs.get("min_outflow_ratio", 0.8))
    min_cad = cad(rule.inputs.get("min_cad", 0))

    inflow = ctx.window(hours=minutes / 60, direction=Direction.INCOMING)
    received = total_cad(inflow)
    if received < min_cad:
        return []
    outflow = ctx.after(minutes=minutes, direction=Direction.OUTGOING)
    if not outflow:
        return []

    sent = total_cad(outflow)
    ratio = float(sent / received) if received else 0.0
    if ratio < min_ratio:
        return []
    elapsed = (outflow[0].occurred_at - ctx.at).total_seconds() / 60
    return [
        Finding(
            rule=rule,
            title="Received value moved out again almost immediately",
            observed={
                "received_cad": float(received),
                "receipts_in_window": len(inflow),
                "sent_cad": float(sent),
                "outflow_ratio": round(ratio, 3),
                "minutes_to_first_outflow": round(elapsed, 1),
                "outgoing_transactions": len(outflow),
                "window_minutes": minutes,
            },
            threshold={"min_outflow_ratio": min_ratio, "window_minutes": minutes, "min_cad": float(min_cad)},
            evidence_txn_ids=sorted({t.id for t in inflow} | {t.id for t in outflow}),
            detail=(
                f"CAD {float(sent):,.2f} sent onward within {minutes:.0f} minutes of receiving CAD "
                f"{float(received):,.2f} across {len(inflow)} receipt(s) - {ratio:.0%} of the value "
                f"received in that window"
                + (" (the excess was drawn from an existing balance)" if ratio > 1 else "")
                + f". First outflow {elapsed:.0f} minutes after the triggering receipt."
            ),
        )
    ]


@evaluator("chain_hopping")
def _chain_hopping(ctx: RuleContext, rule: Rule) -> list[Finding]:
    hours = float(rule.inputs.get("window_hours", 6))
    min_assets = int(rule.inputs.get("min_distinct_assets", 3))
    window = ctx.window(hours=hours)
    assets = {t.asset for t in window}
    if len(assets) < min_assets:
        return []
    return [
        Finding(
            rule=rule,
            title="Rapid switching between virtual currencies",
            observed={
                "distinct_assets": len(assets),
                "assets": sorted(assets),
                "transaction_count": len(window),
                "window_hours": hours,
            },
            threshold={"min_distinct_assets": min_assets, "window_hours": hours},
            evidence_txn_ids=[t.id for t in window],
            detail=f"{len(assets)} different virtual currencies used within {hours:.0f} hours.",
        )
    ]


@evaluator("high_risk_counterparty")
def _high_risk_counterparty(ctx: RuleContext, rule: Rule) -> list[Finding]:
    min_risk = int(rule.inputs.get("min_external_risk", 70))
    escalating = {t.lower() for t in rule.inputs.get("escalating_tags", [])}
    findings = []
    for address in {ctx.txn.wallet_from, ctx.txn.wallet_to}:
        wallet = ctx.wallet(address)
        if wallet is None or wallet.is_internal:
            continue
        tags = {str(t).lower() for t in (wallet.risk_tags or [])}
        hits = sorted(tags & escalating)
        if wallet.external_risk_score < min_risk and not hits:
            continue
        findings.append(
            Finding(
                rule=rule,
                title="Exposure to a high-risk counterparty wallet",
                observed={
                    "address": wallet.address,
                    "blockchain": wallet.blockchain,
                    "external_risk_score": wallet.external_risk_score,
                    "risk_tags": sorted(tags),
                    "matched_tags": hits,
                    "direction": ctx.txn.direction.value,
                    "cad_value": float(ctx.txn.cad_value),
                },
                threshold={"min_external_risk": min_risk, "escalating_tags": sorted(escalating)},
                evidence_txn_ids=[ctx.txn.id],
                detail=(
                    f"Counterparty {wallet.address} carries risk score {wallet.external_risk_score}"
                    + (f" and tag(s) {', '.join(hits)}" if hits else "")
                    + "."
                ),
            )
        )
    return findings


@evaluator("fan_in")
def _fan_in(ctx: RuleContext, rule: Rule) -> list[Finding]:
    hours = int(rule.inputs.get("window_hours", 24))
    min_senders = int(rule.inputs.get("min_unique_senders", 6))
    result = graph_engine.fan_in(ctx.session, ctx.customer.id, end=ctx.at, hours=hours)
    if result["unique_senders"] < min_senders:
        return []
    return [
        Finding(
            rule=rule,
            title="Fan-in: many distinct wallets funding one customer",
            observed={
                "unique_senders": result["unique_senders"],
                "transaction_count": result["transactions"],
                "total_cad": float(result["total_cad"]),
                "window_hours": hours,
            },
            threshold={"min_unique_senders": min_senders, "window_hours": hours},
            evidence_txn_ids=result["txn_ids"],
            detail=(
                f"{result['unique_senders']} distinct sending wallets sent CAD "
                f"{float(result['total_cad']):,.2f} to this customer in {hours} hours."
            ),
        )
    ]


@evaluator("circular_flow")
def _circular(ctx: RuleContext, rule: Rule) -> list[Finding]:
    hours = int(rule.inputs.get("window_hours", 72))
    max_hops = int(rule.inputs.get("max_hops", 4))
    cycles = graph_engine.find_cycles(ctx.session, ctx.customer.id, end=ctx.at, hours=hours, max_hops=max_hops)
    if not cycles:
        return []
    best = min(cycles, key=lambda c: c["hops"])
    evidence = sorted({tid for cycle in cycles for tid in cycle["txn_ids"]})
    return [
        Finding(
            rule=rule,
            title="Circular movement of funds",
            observed={
                "cycles_found": len(cycles),
                "shortest_cycle_hops": best["hops"],
                "path": best["addresses"],
                "out_cad": best["out_cad"],
                "returned_cad": best["back_cad"],
                "window_hours": hours,
            },
            threshold={"max_hops": max_hops, "window_hours": hours},
            evidence_txn_ids=evidence,
            detail=(
                f"Value left the customer and returned after {best['hops']} hop(s): "
                f"CAD {best['out_cad']:,.2f} out, CAD {best['back_cad']:,.2f} back."
            ),
        )
    ]


@evaluator("shared_wallet")
def _shared_wallet(ctx: RuleContext, rule: Rule) -> list[Finding]:
    days = int(rule.inputs.get("lookback_days", 30))
    min_customers = int(rule.inputs.get("min_customers", 2))
    shared = graph_engine.shared_wallets(
        ctx.session, ctx.customer.id, since=ctx.at - timedelta(days=days), min_customers=min_customers
    )
    if not shared:
        return []
    top = shared[0]
    return [
        Finding(
            rule=rule,
            title="One wallet used by multiple customers",
            observed={
                "address": top["address"],
                "customer_count": top["customer_count"],
                "customer_ids": top["customer_ids"],
                "other_shared_addresses": len(shared) - 1,
                "lookback_days": days,
            },
            threshold={"min_customers": min_customers, "lookback_days": days},
            evidence_txn_ids=top["txn_ids"],
            detail=(
                f"Address {top['address']} transacted with {top['customer_count']} different customers "
                f"in the last {days} days, which can indicate an undisclosed third party."
            ),
        )
    ]


@evaluator("shared_beneficiary")
def _shared_beneficiary(ctx: RuleContext, rule: Rule) -> list[Finding]:
    if not ctx.txn.beneficiary_id:
        return []
    days = int(rule.inputs.get("lookback_days", 7))
    min_customers = int(rule.inputs.get("min_customers", 2))
    since = ctx.at - timedelta(days=days)
    rows = (
        ctx.session.execute(
            select(Transaction).where(
                Transaction.beneficiary_id == ctx.txn.beneficiary_id,
                Transaction.occurred_at >= since,
                Transaction.occurred_at <= ctx.at,
            )
        )
        .scalars()
        .all()
    )
    customers = {t.customer_id for t in rows}
    if len(customers) < min_customers:
        return []
    return [
        Finding(
            rule=rule,
            title="Beneficiary shared across apparently unrelated customers",
            observed={
                "beneficiary_id": ctx.txn.beneficiary_id,
                "customer_count": len(customers),
                "customer_ids": sorted(customers),
                "transaction_count": len(rows),
                "total_cad": float(total_cad(rows)),
                "lookback_days": days,
            },
            threshold={"min_customers": min_customers, "lookback_days": days},
            evidence_txn_ids=[t.id for t in rows],
            detail=(
                f"{len(customers)} customers directed value to the same beneficiary within {days} days."
            ),
        )
    ]


@evaluator("new_address_concentration")
def _new_addresses(ctx: RuleContext, rule: Rule) -> list[Finding]:
    hours = int(rule.inputs.get("window_hours", 24))
    age_days = int(rule.inputs.get("new_wallet_age_days", 7))
    min_share = float(rule.inputs.get("min_value_share", 0.5))
    min_window = cad(rule.inputs.get("min_window_cad", 0))

    window = ctx.window(hours=hours, direction=Direction.INCOMING)
    if not window:
        return []
    observed_total = total_cad(window)
    if observed_total < min_window:
        return []
    cutoff = ctx.at - timedelta(days=age_days)
    new_value = Decimal("0")
    new_addresses: set[str] = set()
    for txn in window:
        wallet = ctx.wallet(txn.wallet_from)
        if wallet is not None and wallet.first_seen >= cutoff:
            new_value += Decimal(str(txn.cad_value))
            new_addresses.add(wallet.address)
    if not new_addresses:
        return []
    share = float(cad(new_value) / observed_total) if observed_total else 0.0
    if share < min_share:
        return []
    return [
        Finding(
            rule=rule,
            title="Receipts concentrated in newly observed addresses",
            observed={
                "new_address_count": len(new_addresses),
                "new_address_value_cad": float(cad(new_value)),
                "window_total_cad": float(observed_total),
                "value_share": round(share, 3),
                "new_wallet_age_days": age_days,
            },
            threshold={"min_value_share": min_share, "new_wallet_age_days": age_days},
            evidence_txn_ids=[t.id for t in window],
            detail=(
                f"{share:.0%} of the value received in {hours}h came from {len(new_addresses)} "
                f"address(es) first observed within the last {age_days} days."
            ),
        )
    ]


@evaluator("high_risk_jurisdiction")
def _jurisdiction(ctx: RuleContext, rule: Rule) -> list[Finding]:
    listed = {str(c).upper() for c in rule.inputs.get("jurisdictions", [])}
    hits: dict[str, list] = defaultdict(list)
    for party in (ctx.txn.beneficiary, ctx.txn.third_party):
        if party is not None and (party.country or "").upper() in listed:
            hits[party.country.upper()].append(f"party:{party.external_id}")
    ip_country = str(ctx.txn.context.get("ip_country", "")).upper()
    if ip_country in listed:
        hits[ip_country].append("login_geography")
    if not hits:
        return []
    return [
        Finding(
            rule=rule,
            title="Counterparty exposure to a higher-risk jurisdiction",
            observed={"jurisdictions": sorted(hits), "sources": {k: v for k, v in hits.items()}},
            threshold={"jurisdictions": sorted(listed)},
            evidence_txn_ids=[ctx.txn.id],
            detail=f"Exposure to {', '.join(sorted(hits))} on this transaction.",
        )
    ]


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def evaluate(
    session: Session,
    txn: Transaction,
    *,
    baseline: CustomerBaseline | None = None,
    aggregation_events: list[AggregationEvent] | None = None,
    at: datetime | None = None,
) -> list[Finding]:
    """Run every rule in force against one transaction.

    ``at`` selects the rule versions: it defaults to the transaction time, so
    re-running an old transaction reproduces the assessment it originally got
    rather than applying today's thresholds retroactively.
    """
    catalogue = load_catalogue()
    customer = session.get(Customer, txn.customer_id)
    if customer is None:
        return []
    ctx = RuleContext(
        session=session,
        txn=txn,
        customer=customer,
        baseline=baseline,
        aggregation_events=aggregation_events or [],
    )
    as_of = at or txn.occurred_at
    findings: list[Finding] = []
    for rule in catalogue.in_force(as_of):
        fn = _EVALUATORS.get(rule.evaluator)
        if fn is None:
            continue
        for finding in fn(ctx, rule):
            finding.occurred_at = finding.occurred_at or txn.occurred_at
            findings.append(finding)
    return findings


def catalogue_summary() -> list[dict]:
    catalogue = load_catalogue()
    now = utcnow()
    out = []
    for rule in sorted(catalogue.rules, key=lambda r: (r.id, r.effective_from)):
        out.append(
            {
                "rule_id": rule.id,
                "version": rule.version,
                "name": rule.name,
                "category": rule.category,
                "severity": rule.severity,
                "score_base": rule.score_base,
                "dedupe": rule.dedupe,
                "inputs": rule.inputs,
                "description": rule.description,
                "effective_from": rule.effective_from.isoformat(),
                "effective_to": rule.effective_to.isoformat() if rule.effective_to else None,
                "in_force": rule.in_force(now),
            }
        )
    return out
