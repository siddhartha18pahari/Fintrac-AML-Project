"""Unsupervised behavioural anomaly detection.

Why unsupervised: credible "money laundering" labels are scarce and biased -
they mostly record what a previous system already caught.  Training a supervised
classifier on them teaches it to reproduce the old system's blind spots while
looking accurate.  So this layer answers a narrower and honest question: *how
unusual is this customer's recent behaviour relative to the population?*  It
contributes a bounded number of points to the risk score and never fires an
alert on its own.

Explainability: an Isolation Forest has no coefficients to read off.  Instead
each feature is ablated in turn - replaced with the population median - and the
model is re-scored.  The drop in anomaly score is that feature's attribution.
This is an occlusion/ablation attribution, not SHAP: it is exact for the
question "what happens if this feature were typical?", but it does not decompose
feature interactions.  Stated plainly in docs/MODEL_CARD.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

try:  # scikit-learn pulls in scipy and is ~150MB unpacked.
    from sklearn.ensemble import IsolationForest

    SKLEARN_AVAILABLE = True
except ImportError:  # pragma: no cover - exercised by the slim deployment path
    IsolationForest = None
    SKLEARN_AVAILABLE = False

from ..models import AnomalyScore, Customer, Direction, Transaction, Wallet
from ..util import cad, utcnow

MODEL_NAME = "isolation_forest_customer_behaviour"
MODEL_VERSION = "1.0"
RANDOM_STATE = 20260811

FEATURES: list[str] = [
    "txn_count_24h",
    "txn_count_7d",
    "value_24h_cad",
    "value_7d_cad",
    "unique_senders_24h",
    "unique_receivers_24h",
    "avg_txn_cad",
    "value_vs_baseline",
    "distinct_assets_7d",
    "outflow_ratio_24h",
    "new_wallet_value_share_24h",
    "max_counterparty_risk",
]

#: Minimum population size for the forest to mean anything.  Below this the
#: layer abstains rather than inventing a score from four data points.
MIN_POPULATION = 12

#: Why the layer declined to score, when it did.  Surfaced on every abstained
#: result so that a 0.0 is never mistaken for "this customer is normal" - the
#: model version carries the reason with it.
ABSTAIN_NO_SKLEARN = "unavailable"
ABSTAIN_SMALL_POPULATION = "abstained"


@dataclass
class FeatureVector:
    customer_id: int
    values: dict[str, float]

    def array(self) -> np.ndarray:
        return np.array([self.values[name] for name in FEATURES], dtype=float)


def extract_features(session: Session, customer_id: int, *, as_of: datetime | None = None) -> FeatureVector:
    as_of = as_of or utcnow()
    day_start = as_of - timedelta(hours=24)
    week_start = as_of - timedelta(days=7)
    baseline_start = as_of - timedelta(days=90)

    rows = list(
        session.execute(
            select(Transaction).where(
                Transaction.customer_id == customer_id,
                Transaction.occurred_at >= baseline_start,
                Transaction.occurred_at <= as_of,
            )
        )
        .scalars()
        .all()
    )
    day = [t for t in rows if t.occurred_at >= day_start]
    week = [t for t in rows if t.occurred_at >= week_start]
    prior = [t for t in rows if t.occurred_at < day_start and t.direction is Direction.INCOMING]

    day_in = [t for t in day if t.direction is Direction.INCOMING]
    day_out = [t for t in day if t.direction is Direction.OUTGOING]

    value_24h = float(cad(sum((Decimal(str(t.cad_value)) for t in day_in), Decimal("0"))))
    value_7d = float(
        cad(sum((Decimal(str(t.cad_value)) for t in week if t.direction is Direction.INCOMING), Decimal("0")))
    )
    out_24h = float(cad(sum((Decimal(str(t.cad_value)) for t in day_out), Decimal("0"))))
    prior_total = float(cad(sum((Decimal(str(t.cad_value)) for t in prior), Decimal("0"))))
    prior_daily = prior_total / 89 if prior else 0.0

    addresses = {t.wallet_from for t in day_in if t.wallet_from}
    wallets = {}
    if addresses:
        wallets = {
            w.address: w
            for w in session.execute(select(Wallet).where(Wallet.address.in_(addresses))).scalars().all()
        }
    new_cutoff = as_of - timedelta(days=7)
    new_value = sum(
        float(t.cad_value)
        for t in day_in
        if t.wallet_from and (w := wallets.get(t.wallet_from)) is not None and w.first_seen >= new_cutoff
    )
    max_risk = max((w.external_risk_score for w in wallets.values()), default=0)

    values = {
        "txn_count_24h": float(len(day)),
        "txn_count_7d": float(len(week)),
        "value_24h_cad": value_24h,
        "value_7d_cad": value_7d,
        "unique_senders_24h": float(len({t.wallet_from for t in day_in if t.wallet_from})),
        "unique_receivers_24h": float(len({t.wallet_to for t in day_out if t.wallet_to})),
        "avg_txn_cad": (value_24h / len(day_in)) if day_in else 0.0,
        "value_vs_baseline": (value_24h / prior_daily) if prior_daily > 0 else 0.0,
        "distinct_assets_7d": float(len({t.asset for t in week})),
        "outflow_ratio_24h": (out_24h / value_24h) if value_24h > 0 else 0.0,
        "new_wallet_value_share_24h": (new_value / value_24h) if value_24h > 0 else 0.0,
        "max_counterparty_risk": float(max_risk),
    }
    return FeatureVector(customer_id=customer_id, values=values)


def _log_scale(matrix: np.ndarray) -> np.ndarray:
    """Compress heavy-tailed monetary/count features.

    Without this the forest spends its splits separating two whales from
    everyone else and stops noticing behaviour.
    """
    return np.sign(matrix) * np.log1p(np.abs(matrix))


@dataclass
class AnomalyResult:
    customer_id: int
    score: float  # 0..1, higher = more anomalous
    features: dict[str, float]
    attributions: list[dict]
    model_name: str = MODEL_NAME
    model_version: str = MODEL_VERSION

    def as_dict(self) -> dict:
        return {
            "customer_id": self.customer_id,
            "score": round(self.score, 4),
            "features": self.features,
            "attributions": self.attributions,
            "model_name": self.model_name,
            "model_version": self.model_version,
        }


class AnomalyDetector:
    def __init__(self, contamination: float = 0.05) -> None:
        self.contamination = contamination
        self.model = None
        self.medians: np.ndarray | None = None
        self.population: list[FeatureVector] = []
        self.abstain_reason: str | None = None if SKLEARN_AVAILABLE else ABSTAIN_NO_SKLEARN

    def fit(self, vectors: list[FeatureVector]) -> "AnomalyDetector":
        if not SKLEARN_AVAILABLE:
            self.model = None
            self.abstain_reason = ABSTAIN_NO_SKLEARN
            return self
        if len(vectors) < MIN_POPULATION:
            self.model = None
            self.abstain_reason = ABSTAIN_SMALL_POPULATION
            return self
        matrix = _log_scale(np.vstack([v.array() for v in vectors]))
        self.medians = np.median(matrix, axis=0)
        self.model = IsolationForest(
            n_estimators=200,
            contamination=self.contamination,
            random_state=RANDOM_STATE,
            bootstrap=False,
        ).fit(matrix)
        self.population = vectors
        self.abstain_reason = None
        return self

    def _raw(self, row: np.ndarray) -> float:
        # score_samples: lower = more anomalous.  Negate so higher = more anomalous.
        return float(-self.model.score_samples(row.reshape(1, -1))[0])

    def score(self, vector: FeatureVector) -> AnomalyResult:
        if self.model is None or self.medians is None:
            # A score of 0.0 here means "not assessed", not "normal". The model
            # version carries the reason so nothing downstream can read an
            # abstention as a clean bill of health.
            return AnomalyResult(
                customer_id=vector.customer_id,
                score=0.0,
                features=vector.values,
                attributions=[],
                model_version=f"{MODEL_VERSION}-{self.abstain_reason or ABSTAIN_SMALL_POPULATION}",
            )

        row = _log_scale(vector.array().reshape(1, -1))[0]
        raw = self._raw(row)

        attributions = []
        for index, name in enumerate(FEATURES):
            ablated = row.copy()
            ablated[index] = self.medians[index]
            delta = raw - self._raw(ablated)
            attributions.append({"feature": name, "value": vector.values[name], "contribution": round(delta, 5)})
        attributions.sort(key=lambda a: -a["contribution"])

        return AnomalyResult(
            customer_id=vector.customer_id,
            score=self._normalise(raw),
            features=vector.values,
            attributions=[a for a in attributions if abs(a["contribution"]) > 1e-6][:6],
        )

    def _normalise(self, raw: float) -> float:
        """Map the raw forest score to 0..1 against the fitted population.

        A percentile rank is used rather than a fixed cut so the number means
        "more unusual than N% of this population", which is what an investigator
        can actually reason about.
        """
        if not self.population:
            return 0.0
        matrix = _log_scale(np.vstack([v.array() for v in self.population]))
        raws = -self.model.score_samples(matrix)
        rank = float((raws < raw).sum()) / len(raws)
        return max(0.0, min(1.0, rank))


def run(session: Session, *, as_of: datetime | None = None, persist: bool = True) -> dict[int, AnomalyResult]:
    """Fit on the whole customer population and score everyone.

    Refitting each run is intentional: the population *is* the reference
    distribution, and a frozen model would drift silently as the book changes.
    Every score records the model version it came from.
    """
    as_of = as_of or utcnow()
    customer_ids = list(session.execute(select(Customer.id)).scalars().all())
    vectors = [extract_features(session, cid, as_of=as_of) for cid in customer_ids]
    detector = AnomalyDetector().fit(vectors)

    results: dict[int, AnomalyResult] = {}
    for vector in vectors:
        result = detector.score(vector)
        results[vector.customer_id] = result
        if persist:
            session.add(
                AnomalyScore(
                    customer_id=vector.customer_id,
                    model_name=result.model_name,
                    model_version=result.model_version,
                    score=round(result.score, 5),
                    features=result.features,
                    attributions=result.attributions,
                    computed_at=as_of,
                )
            )
    if persist:
        session.flush()
    return results
