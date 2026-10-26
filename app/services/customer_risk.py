"""Explainable customer risk rating.

This is the inherent-plus-behavioural rating an investigator sees on a
customer, separate from the alert composite in ``risk.assess``. The composite
answers "how loud are the open indicators?". This rating answers "how much
attention does this relationship deserve before any one transaction is looked
at, and how does recent behaviour change that?".

Every point is a named factor. There is no opaque score.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import HIGH_RISK_JURISDICTIONS, settings
from ..models import Alert, AlertStatus, Customer, Direction, Transaction
from ..util import cad, utcnow
from .instruments import is_cash
from .risk import assess


# Phrases matched against the declared occupation or nature of business.
# Order does not matter; the highest matching weight is kept, not stacked,
# so "virtual currency exchange" is one product-risk factor rather than three.
_PRODUCT_RISK: tuple[tuple[str, int, str], ...] = (
    ("money service", 18, "Declared activity is a money-services business"),
    ("remittance", 16, "Declared activity includes remittance"),
    ("virtual currency", 14, "Declared activity includes virtual currency"),
    ("crypto", 14, "Declared activity includes virtual currency"),
    ("gambling", 14, "Declared activity includes gambling"),
    ("pawn", 12, "Declared activity is cash-intensive (pawn)"),
    ("import", 8, "Declared activity is cross-border trade"),
    ("arms", 18, "Declared activity includes arms or defence goods"),
    ("cannabis", 10, "Declared activity includes cannabis"),
)


@dataclass
class RiskFactor:
    code: str
    label: str
    points: int
    detail: str
    pillar: str  # inherent | behavioural

    def as_dict(self) -> dict:
        return {
            "code": self.code,
            "label": self.label,
            "points": self.points,
            "detail": self.detail,
            "pillar": self.pillar,
        }


@dataclass
class CustomerRisk:
    customer_id: int
    inherent: int
    behavioural: int
    residual: int
    tier: str
    factors: list[RiskFactor] = field(default_factory=list)
    open_alerts: int = 0
    alert_score: int = 0

    def as_dict(self) -> dict:
        return {
            "customer_id": self.customer_id,
            "inherent": self.inherent,
            "behavioural": self.behavioural,
            "residual": self.residual,
            "tier": self.tier,
            "open_alerts": self.open_alerts,
            "alert_score": self.alert_score,
            "factors": [factor.as_dict() for factor in self.factors],
        }


def _clamp(value: int, limit: int = 100) -> int:
    return max(0, min(limit, value))


def assess_customer(
    session: Session,
    customer: Customer,
    *,
    as_of: datetime | None = None,
) -> CustomerRisk:
    as_of = as_of or utcnow()
    factors: list[RiskFactor] = []

    kyc = (customer.kyc_risk or "LOW").upper()
    kyc_points = {"HIGH": 25, "MEDIUM": 12, "LOW": 4}.get(kyc, 4)
    factors.append(
        RiskFactor(
            "kyc_rating",
            "Onboarding KYC rating",
            kyc_points,
            f"Relationship was onboarded at {kyc} KYC risk.",
            "inherent",
        )
    )

    country = (customer.country or "CA").upper()
    if country in HIGH_RISK_JURISDICTIONS:
        factors.append(
            RiskFactor(
                "customer_jurisdiction",
                "Customer jurisdiction",
                20,
                f"Customer country {country} is on the illustrative higher-risk list.",
                "inherent",
            )
        )

    business = (customer.occupation_or_business or "").lower()
    matched = [(points, detail) for needle, points, detail in _PRODUCT_RISK if needle in business]
    if matched:
        points, detail = max(matched, key=lambda item: item[0])
        factors.append(RiskFactor("product_risk", "Product and activity risk", points, detail + ".", "inherent"))

    if customer.customer_type.value == "ENTITY":
        factors.append(
            RiskFactor(
                "entity",
                "Legal entity",
                4,
                "Legal persons have a wider range of controllers and beneficiaries to understand.",
                "inherent",
            )
        )

    age_days = (as_of - customer.onboarded_at).total_seconds() / 86400 if customer.onboarded_at else 999
    if age_days < 90:
        factors.append(
            RiskFactor(
                "new_relationship",
                "New relationship",
                8,
                f"Onboarded {age_days:.0f} days ago; the behavioural baseline is still thin.",
                "inherent",
            )
        )

    expected = cad(customer.expected_monthly_volume_cad or 0)
    if expected >= cad(100_000):
        factors.append(
            RiskFactor(
                "declared_volume",
                "High declared volume",
                6,
                f"Declared expected monthly activity is CAD {float(expected):,.0f}.",
                "inherent",
            )
        )

    start = as_of - timedelta(days=30)
    recent = list(
        session.execute(
            select(Transaction).where(
                Transaction.customer_id == customer.id,
                Transaction.occurred_at >= start,
                Transaction.occurred_at <= as_of,
            )
        )
        .scalars()
        .all()
    )
    incoming = [txn for txn in recent if txn.direction is Direction.INCOMING]
    incoming_total = cad(sum((Decimal(str(txn.cad_value)) for txn in incoming), Decimal("0")))
    cash_total = cad(sum((Decimal(str(txn.cad_value)) for txn in incoming if is_cash(txn)), Decimal("0")))
    if incoming_total >= cad(5000) and cash_total / incoming_total >= Decimal("0.5"):
        factors.append(
            RiskFactor(
                "cash_intensity",
                "Cash-intensive recent activity",
                12,
                (
                    f"CAD {float(cash_total):,.2f} of CAD {float(incoming_total):,.2f} received in the "
                    "last 30 days arrived in cash."
                ),
                "inherent",
            )
        )

    inherent = _clamp(sum(factor.points for factor in factors if factor.pillar == "inherent"))

    live = list(
        session.execute(
            select(Alert).where(
                Alert.customer_id == customer.id,
                Alert.status != AlertStatus.DISMISSED,
            )
        )
        .scalars()
        .all()
    )
    assessment = assess(live) if live else None
    alert_score = assessment.score if assessment else 0
    behavioural = _clamp(alert_score)
    if assessment and assessment.drivers:
        top = assessment.drivers[:3]
        summary = "; ".join(f"{driver.label} (+{driver.points})" for driver in top)
        factors.append(
            RiskFactor(
                "open_indicators",
                "Open monitoring indicators",
                behavioural,
                f"Composite alert score {alert_score} ({assessment.confidence} confidence). {summary}.",
                "behavioural",
            )
        )
    elif not live:
        factors.append(
            RiskFactor(
                "open_indicators",
                "Open monitoring indicators",
                0,
                "No undismissed alerts.",
                "behavioural",
            )
        )

    # Inherent weight stays visible even when the alert book is quiet, and
    # behavioural weight can still carry a relationship that was onboarded low.
    residual = _clamp(round(inherent * 0.6 + behavioural * 0.7))
    return CustomerRisk(
        customer_id=customer.id,
        inherent=inherent,
        behavioural=behavioural,
        residual=residual,
        tier=settings.risk_tier(residual),
        factors=factors,
        open_alerts=len(live),
        alert_score=alert_score,
    )


def assess_all(session: Session, *, as_of: datetime | None = None) -> list[CustomerRisk]:
    customers = list(session.execute(select(Customer).order_by(Customer.id)).scalars().all())
    return [assess_customer(session, customer, as_of=as_of) for customer in customers]
