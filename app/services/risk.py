"""Behavioural baselines and explainable composite risk scoring.

A bare "Risk Score: 93" is useless to an investigator and indefensible to a
regulator.  Every score produced here decomposes into ranked *drivers*, each of
which names the rule (and rule version) that produced it, what was observed,
what the threshold was, and which transactions are the evidence.

The score is an aid to triage.  It does not decide whether a report is filed -
see :mod:`app.services.case_service` for the human decision path.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Alert, CustomerBaseline, Direction, Transaction
from ..util import cad, utcnow


# ---------------------------------------------------------------------------
# Behavioural baseline
# ---------------------------------------------------------------------------


def compute_baseline(
    session: Session,
    customer_id: int,
    *,
    lookback_days: int = 90,
    as_of: datetime | None = None,
    persist: bool = True,
) -> CustomerBaseline:
    """Trailing profile of a customer's own normal behaviour.

    The window ends *before* ``as_of`` so that the activity being assessed does
    not inflate the baseline it is being compared against.
    """
    as_of = as_of or utcnow()
    start = as_of - timedelta(days=lookback_days)
    rows = list(
        session.execute(
            select(Transaction).where(
                Transaction.customer_id == customer_id,
                Transaction.direction == Direction.INCOMING,
                Transaction.occurred_at >= start,
                Transaction.occurred_at < as_of,
            )
        )
        .scalars()
        .all()
    )

    values = [Decimal(str(t.cad_value)) for t in rows]
    total = cad(sum(values, Decimal("0")))
    counterparties = {t.wallet_from for t in rows if t.wallet_from}
    avg_txn = cad(total / len(values)) if values else cad(0)
    stdev = cad(statistics.pstdev([float(v) for v in values])) if len(values) > 1 else cad(0)
    last_activity = max((t.occurred_at for t in rows), default=None)

    by_day: dict = {}
    for txn in rows:
        day = txn.occurred_at.date()
        by_day[day] = by_day.get(day, Decimal("0")) + Decimal(str(txn.cad_value))
    active_days = len(by_day)
    avg_active_day = cad(total / active_days) if active_days else cad(0)
    max_day = cad(max(by_day.values())) if by_day else cad(0)

    baseline = session.execute(
        select(CustomerBaseline).where(CustomerBaseline.customer_id == customer_id)
    ).scalar_one_or_none()
    if baseline is None:
        baseline = CustomerBaseline(customer_id=customer_id)
        if persist:
            session.add(baseline)

    baseline.lookback_days = lookback_days
    baseline.txn_count = len(rows)
    baseline.total_cad = total
    baseline.avg_daily_cad = cad(total / lookback_days) if lookback_days else cad(0)
    baseline.avg_active_day_cad = avg_active_day
    baseline.active_days = active_days
    baseline.max_day_cad = max_day
    baseline.avg_txn_cad = avg_txn
    baseline.stdev_txn_cad = stdev
    baseline.distinct_counterparties = len(counterparties)
    baseline.last_activity_at = last_activity
    baseline.computed_at = utcnow()
    if persist:
        session.flush()
    return baseline


# ---------------------------------------------------------------------------
# Composite scoring
# ---------------------------------------------------------------------------


@dataclass
class RiskDriver:
    source: str  # "rule" or "model"
    key: str  # rule id, or model name
    version: str
    points: int
    label: str
    detail: str
    evidence_txn_ids: list[int]
    observed: dict
    threshold: dict

    def as_dict(self) -> dict:
        return {
            "source": self.source,
            "key": self.key,
            "version": self.version,
            "points": self.points,
            "label": self.label,
            "detail": self.detail,
            "evidence_ids": self.evidence_txn_ids,
            "observed": self.observed,
            "threshold": self.threshold,
        }


@dataclass
class RiskAssessment:
    score: int
    tier: str
    drivers: list[RiskDriver]
    raw_score: int
    capped: bool
    confidence: str

    def as_dict(self) -> dict:
        return {
            "score": self.score,
            "tier": self.tier,
            "raw_score": self.raw_score,
            "capped": self.capped,
            "confidence": self.confidence,
            "drivers": [d.as_dict() for d in self.drivers],
        }


def _confidence(drivers: list[RiskDriver]) -> str:
    """How much independent corroboration is behind the score.

    A score built from one rule is a weaker signal than the same score built
    from four unrelated ones, and an investigator should be told which they are
    looking at.
    """
    rule_drivers = [d for d in drivers if d.source == "rule"]
    evidence = {tid for d in rule_drivers for tid in d.evidence_txn_ids}
    if len(rule_drivers) >= 3 and len(evidence) >= 3:
        return "HIGH"
    if len(rule_drivers) >= 2:
        return "MEDIUM"
    return "LOW"


def assess(
    alerts: list[Alert],
    *,
    anomaly: dict | None = None,
) -> RiskAssessment:
    """Combine rule alerts (and optionally an ML score) into one assessment.

    Contributions are additive.  Where the same rule fired more than once, only
    its highest-scoring firing counts, so a repeated indicator cannot be stacked
    into a high score on its own.
    """
    best_by_rule: dict[str, Alert] = {}
    for alert in alerts:
        current = best_by_rule.get(alert.rule_id)
        if current is None or alert.score_contribution > current.score_contribution:
            best_by_rule[alert.rule_id] = alert

    drivers: list[RiskDriver] = []
    for alert in best_by_rule.values():
        explanation = alert.explanation or {}
        drivers.append(
            RiskDriver(
                source="rule",
                key=alert.rule_id,
                version=alert.rule_version,
                points=int(alert.score_contribution),
                label=alert.title,
                detail=explanation.get("detail", ""),
                evidence_txn_ids=list(alert.evidence_txn_ids or []),
                observed=explanation.get("observed", {}),
                threshold=explanation.get("threshold", {}),
            )
        )

    if anomaly:
        points = int(round(float(anomaly.get("score", 0.0)) * settings.anomaly_max_points))
        if points > 0:
            top = anomaly.get("attributions", [])[:3]
            drivers.append(
                RiskDriver(
                    source="model",
                    key=anomaly.get("model_name", "anomaly"),
                    version=str(anomaly.get("model_version", "0")),
                    points=points,
                    label="Behavioural anomaly score",
                    detail=(
                        "Unsupervised deviation from the population's normal activity profile; "
                        + (
                            "most influential features: " + ", ".join(a["feature"] for a in top)
                            if top
                            else "no single dominant feature"
                        )
                        + ". This is an anomaly signal, not a determination of money laundering."
                    ),
                    evidence_txn_ids=[],
                    observed={"anomaly_score": round(float(anomaly.get("score", 0.0)), 4), "attributions": top},
                    threshold={"max_points": settings.anomaly_max_points},
                )
            )

    drivers.sort(key=lambda d: -d.points)
    raw = sum(d.points for d in drivers)
    score = min(100, raw)
    return RiskAssessment(
        score=score,
        tier=settings.risk_tier(score),
        drivers=drivers,
        raw_score=raw,
        capped=raw > 100,
        confidence=_confidence(drivers),
    )


def render_drivers(assessment: RiskAssessment, limit: int = 8) -> str:
    """Plain-text driver block, the shape used in the case header and reports."""
    lines = [
        f"Risk Score: {assessment.score} / 100",
        f"Risk Tier: {assessment.tier}",
        f"Confidence: {assessment.confidence.title()}",
        "",
        "Drivers",
        "-" * 52,
    ]
    for driver in assessment.drivers[:limit]:
        lines.append(f"+{driver.points:<4} {driver.label} [{driver.key} v{driver.version}]")
        if driver.detail:
            lines.append(f"      {driver.detail}")
    if assessment.capped:
        lines.append(f"(raw contributions totalled {assessment.raw_score}; capped at 100)")
    return "\n".join(lines)
