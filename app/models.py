"""SQLAlchemy ORM model for FINTRAC Sentinel.

Design notes
------------
* All datetimes are stored **naive UTC**.  SQLite cannot round-trip timezone
  information, so the whole system standardises on naive-UTC and converts at the
  edges (``app.util.utcnow`` / ``app.util.iso``).  Mixing aware and naive values
  is the single easiest way to get a 24-hour window wrong, so it is banned.
* Monetary values use ``Numeric``.  Every *threshold* comparison is performed in
  Python on quantised ``Decimal`` values (see ``app.services.valuation``), never
  in SQL, so float affinity in SQLite cannot flip a reporting decision.
* Nothing is ever hard-deleted.  Cases, alerts and reports move through status
  values and every mutation writes an ``AuditEvent``.
"""

from __future__ import annotations

import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    TypeDecorator,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from .util import utcnow


class DecimalText(TypeDecorator):
    """Store an arbitrary-precision Decimal losslessly, as its exact digits.

    SQLite has no DECIMAL type, so SQLAlchemy's ``Numeric`` round-trips through
    a float: 0.83944829 BTC comes back as 0.839448289999999986.  That is
    invisible on a dashboard and unacceptable in a regulatory payload, where
    the amount is the thing being reported.

    These columns are never compared, ordered or summed in SQL - only
    ``cad_value`` is, and it keeps a real numeric type at 2 decimal places
    where float affinity is exact.
    """

    impl = String(64)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return format(Decimal(str(value)), "f")

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return Decimal(value)


CAD = Numeric(20, 2)
ASSET = DecimalText()
RATE = DecimalText()


class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------


class Role(str, enum.Enum):
    ANALYST = "ANALYST"
    SENIOR_ANALYST = "SENIOR_ANALYST"
    COMPLIANCE_OFFICER = "COMPLIANCE_OFFICER"
    APPROVER = "APPROVER"
    AUDITOR = "AUDITOR"
    ADMINISTRATOR = "ADMINISTRATOR"


class CustomerType(str, enum.Enum):
    PERSON = "PERSON"
    ENTITY = "ENTITY"


class Direction(str, enum.Enum):
    INCOMING = "INCOMING"
    OUTGOING = "OUTGOING"


class PartyKind(str, enum.Enum):
    BENEFICIARY = "BENEFICIARY"
    THIRD_PARTY = "THIRD_PARTY"


class AggregationType(str, enum.Enum):
    """Mirrors FINTRAC's twentyFourHourAggregationTypeCode."""

    BENEFICIARY = "BENEFICIARY"  # code 1
    CONDUCTOR = "CONDUCTOR"  # code 2
    ON_BEHALF_OF = "ON_BEHALF_OF"  # code 3 (third party)
    NOT_APPLICABLE = "NOT_APPLICABLE"  # code 4


class AlertStatus(str, enum.Enum):
    NEW = "NEW"
    ASSIGNED = "ASSIGNED"
    DISMISSED = "DISMISSED"
    ESCALATED = "ESCALATED"
    LINKED_TO_CASE = "LINKED_TO_CASE"


class CaseStatus(str, enum.Enum):
    NEW = "NEW"
    TRIAGE = "TRIAGE"
    UNDER_REVIEW = "UNDER_REVIEW"
    ESCALATED = "ESCALATED"
    DECISION = "DECISION"
    APPROVED = "APPROVED"
    SUBMISSION_READY = "SUBMISSION_READY"
    FILED = "FILED"
    CLOSED_NO_FILING = "CLOSED_NO_FILING"
    ARCHIVED = "ARCHIVED"


class Disposition(str, enum.Enum):
    NO_FILING = "NO_FILING"
    LVCTR = "LVCTR"
    STR = "STR"
    LVCTR_AND_STR = "LVCTR_AND_STR"


class ReportType(str, enum.Enum):
    LVCTR = "LVCTR"
    STR = "STR"


class ReportStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    VALIDATED = "VALIDATED"
    INVALID = "INVALID"
    APPROVED = "APPROVED"
    SUBMITTED = "SUBMITTED"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"


# ---------------------------------------------------------------------------
# Access control
# ---------------------------------------------------------------------------


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(160))
    role: Mapped[Role] = mapped_column(Enum(Role), default=Role.ANALYST)
    password_hash: Mapped[str] = mapped_column(String(256))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


# ---------------------------------------------------------------------------
# Subjects of monitoring
# ---------------------------------------------------------------------------


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(primary_key=True)
    external_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    customer_type: Mapped[CustomerType] = mapped_column(Enum(CustomerType), default=CustomerType.PERSON)
    kyc_risk: Mapped[str] = mapped_column(String(16), default="LOW")  # LOW/MEDIUM/HIGH
    country: Mapped[str] = mapped_column(String(2), default="CA")
    occupation_or_business: Mapped[str] = mapped_column(String(200), default="")
    expected_monthly_volume_cad: Mapped[Decimal] = mapped_column(CAD, default=Decimal("0"))
    onboarded_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    # KYC payload used by the LVCTR builder (names, DOB, address, identification).
    kyc: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    wallets: Mapped[list["Wallet"]] = relationship(back_populates="owner")
    transactions: Mapped[list["Transaction"]] = relationship(back_populates="customer")


class Wallet(Base):
    __tablename__ = "wallets"
    __table_args__ = (UniqueConstraint("address", "blockchain", name="uq_wallet_address_chain"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    address: Mapped[str] = mapped_column(String(128), index=True)
    blockchain: Mapped[str] = mapped_column(String(24), default="BTC")
    owner_customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"), nullable=True)
    # True when the wallet is hosted by the reporting entity (i.e. a customer's
    # deposit address) rather than an external counterparty address.
    is_internal: Mapped[bool] = mapped_column(Boolean, default=False)
    first_seen: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    # 0-100, sourced from a (mock) blockchain-analytics provider.
    external_risk_score: Mapped[int] = mapped_column(Integer, default=0)
    # e.g. ["mixer", "darknet_market", "sanctioned"]
    risk_tags: Mapped[list] = mapped_column(JSON, default=list)

    owner: Mapped[Customer | None] = relationship(back_populates="wallets")


class Party(Base):
    """A beneficiary or third party referenced by transactions.

    Kept separate from ``Customer`` because a beneficiary or an on-behalf-of
    party is frequently *not* a customer of the reporting entity, yet the
    24-hour rule requires grouping on them.
    """

    __tablename__ = "parties"

    id: Mapped[int] = mapped_column(primary_key=True)
    external_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    kind: Mapped[PartyKind] = mapped_column(Enum(PartyKind))
    name: Mapped[str] = mapped_column(String(200))
    party_type: Mapped[CustomerType] = mapped_column(Enum(CustomerType), default=CustomerType.PERSON)
    country: Mapped[str] = mapped_column(String(2), default="CA")
    kyc: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


# ---------------------------------------------------------------------------
# Transactions and valuation
# ---------------------------------------------------------------------------


class PriceQuote(Base):
    """An immutable record of the rate used to value one transaction.

    Reproducibility requirement: an auditor must be able to re-derive why a
    transaction landed above or below CAD 10,000, years later.
    """

    __tablename__ = "price_quotes"

    id: Mapped[int] = mapped_column(primary_key=True)
    asset: Mapped[str] = mapped_column(String(16), index=True)
    price_cad: Mapped[Decimal] = mapped_column(RATE)
    source: Mapped[str] = mapped_column(String(64))
    quoted_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    methodology_version: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    external_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)

    wallet_from: Mapped[str | None] = mapped_column(String(128), index=True, nullable=True)
    wallet_to: Mapped[str | None] = mapped_column(String(128), index=True, nullable=True)

    asset: Mapped[str] = mapped_column(String(16))
    asset_amount: Mapped[Decimal] = mapped_column(ASSET)
    cad_value: Mapped[Decimal] = mapped_column(CAD, index=True)
    exchange_rate: Mapped[Decimal] = mapped_column(RATE)
    price_quote_id: Mapped[int | None] = mapped_column(ForeignKey("price_quotes.id"), nullable=True)
    valuation_methodology: Mapped[str] = mapped_column(String(32), default="")

    occurred_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    direction: Mapped[Direction] = mapped_column(Enum(Direction), index=True)
    blockchain: Mapped[str] = mapped_column(String(24), default="BTC")
    tx_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)

    beneficiary_id: Mapped[int | None] = mapped_column(ForeignKey("parties.id"), nullable=True, index=True)
    third_party_id: Mapped[int | None] = mapped_column(ForeignKey("parties.id"), nullable=True, index=True)

    # Free-form ingestion context: device, ip, channel, transaction purpose.
    context: Mapped[dict] = mapped_column(JSON, default=dict)
    # Label carried by synthetic data only.  Never populated for real feeds.
    synthetic_scenario: Mapped[str | None] = mapped_column(String(64), nullable=True)

    ingested_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    customer: Mapped[Customer] = relationship(back_populates="transactions")
    beneficiary: Mapped[Party | None] = relationship(foreign_keys=[beneficiary_id])
    third_party: Mapped[Party | None] = relationship(foreign_keys=[third_party_id])
    price_quote: Mapped[PriceQuote | None] = relationship()

    __table_args__ = (
        Index("ix_txn_customer_time", "customer_id", "occurred_at"),
        Index("ix_txn_direction_time", "direction", "occurred_at"),
    )


# ---------------------------------------------------------------------------
# Reporting obligations
# ---------------------------------------------------------------------------


class AggregationEvent(Base):
    """One 24-hour rule grouping that reached the reporting threshold.

    ``group_type``/``group_key`` identify *why* the receipts are grouped
    (same conductor, same beneficiary, same third party).  ``covered_txn_ids``
    is the authoritative set of receipts the event reports on, and is what makes
    deduplication possible when the sliding window is re-evaluated.

    ``customer_id`` is the conductor whose receipt *opened* the event.  For a
    beneficiary or third-party grouping the covered receipts may have been
    conducted by several different customers - that is the point of the rule -
    so it is a provenance field, not a filter.
    """

    __tablename__ = "aggregation_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    group_type: Mapped[AggregationType] = mapped_column(Enum(AggregationType), index=True)
    group_key: Mapped[str] = mapped_column(String(64), index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)

    window_start: Mapped[datetime] = mapped_column(DateTime)
    window_end: Mapped[datetime] = mapped_column(DateTime)
    total_cad: Mapped[Decimal] = mapped_column(CAD)
    covered_txn_ids: Mapped[list] = mapped_column(JSON, default=list)

    threshold_met: Mapped[bool] = mapped_column(Boolean, default=False)
    # True for a single receipt of >= CAD 10,000 (not a 24-hour aggregation).
    single_transaction: Mapped[bool] = mapped_column(Boolean, default=False)
    threshold_cad: Mapped[Decimal] = mapped_column(CAD)

    # Reporting lifecycle.
    reported: Mapped[bool] = mapped_column(Boolean, default=False)
    report_id: Mapped[int | None] = mapped_column(ForeignKey("reports.id"), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    customer: Mapped[Customer] = relationship()


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------


class RuleVersion(Base):
    """Persisted snapshot of a rule definition.

    A historical case must remain reproducible using the rule version that was
    in force when it was assessed, so rule bodies are copied into the database
    rather than only living in YAML.
    """

    __tablename__ = "rule_versions"
    __table_args__ = (UniqueConstraint("rule_id", "version", name="uq_rule_version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    rule_id: Mapped[str] = mapped_column(String(32), index=True)
    version: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(48))
    severity: Mapped[str] = mapped_column(String(16))
    definition: Mapped[dict] = mapped_column(JSON)
    effective_from: Mapped[datetime] = mapped_column(DateTime)
    effective_to: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    rule_id: Mapped[str] = mapped_column(String(32), index=True)
    rule_version: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(String(200))
    severity: Mapped[str] = mapped_column(String(16))
    score_contribution: Mapped[int] = mapped_column(Integer, default=0)

    # The explainability object: observed vs threshold vs evidence.
    explanation: Mapped[dict] = mapped_column(JSON, default=dict)
    evidence_txn_ids: Mapped[list] = mapped_column(JSON, default=list)

    # Stable hash of (rule, customer, evidence) used to suppress duplicates.
    dedupe_key: Mapped[str] = mapped_column(String(80), index=True)

    status: Mapped[AlertStatus] = mapped_column(Enum(AlertStatus), default=AlertStatus.NEW, index=True)
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id"), nullable=True, index=True)
    assigned_to: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    occurred_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    customer: Mapped[Customer] = relationship()


class CustomerBaseline(Base):
    """Rolling behavioural profile used by deviation rules and the ML layer."""

    __tablename__ = "customer_baselines"

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), unique=True, index=True)
    lookback_days: Mapped[int] = mapped_column(Integer, default=90)
    txn_count: Mapped[int] = mapped_column(Integer, default=0)
    total_cad: Mapped[Decimal] = mapped_column(CAD, default=Decimal("0"))
    avg_daily_cad: Mapped[Decimal] = mapped_column(CAD, default=Decimal("0"))
    # Average over days the customer was *active*.  Comparing a busy day
    # against an all-days average (which includes every quiet day) makes an
    # ordinary deposit look like a 30x deviation for any low-frequency
    # customer, which is how a deviation rule ends up alerting on everyone.
    avg_active_day_cad: Mapped[Decimal] = mapped_column(CAD, default=Decimal("0"))
    active_days: Mapped[int] = mapped_column(Integer, default=0)
    max_day_cad: Mapped[Decimal] = mapped_column(CAD, default=Decimal("0"))
    avg_txn_cad: Mapped[Decimal] = mapped_column(CAD, default=Decimal("0"))
    stdev_txn_cad: Mapped[Decimal] = mapped_column(CAD, default=Decimal("0"))
    distinct_counterparties: Mapped[int] = mapped_column(Integer, default=0)
    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    computed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AnomalyScore(Base):
    __tablename__ = "anomaly_scores"

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    model_name: Mapped[str] = mapped_column(String(64))
    model_version: Mapped[str] = mapped_column(String(16))
    score: Mapped[float] = mapped_column(Numeric(8, 5))  # 0..1, higher = more anomalous
    features: Mapped[dict] = mapped_column(JSON, default=dict)
    attributions: Mapped[list] = mapped_column(JSON, default=list)
    computed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


# ---------------------------------------------------------------------------
# Investigation
# ---------------------------------------------------------------------------


class Case(Base):
    __tablename__ = "cases"

    id: Mapped[int] = mapped_column(primary_key=True)
    reference: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    status: Mapped[CaseStatus] = mapped_column(Enum(CaseStatus), default=CaseStatus.NEW, index=True)
    priority: Mapped[str] = mapped_column(String(16), default="MEDIUM")

    risk_score: Mapped[int] = mapped_column(Integer, default=0)
    risk_tier: Mapped[str] = mapped_column(String(16), default="LOW")
    risk_drivers: Mapped[list] = mapped_column(JSON, default=list)
    # Set when a human overrides the model/rule score.
    overridden_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    override_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    override_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    # Reporting obligations tracked explicitly and separately (LVCTR != STR).
    lvctr_required: Mapped[bool] = mapped_column(Boolean, default=False)
    str_candidate: Mapped[bool] = mapped_column(Boolean, default=False)
    disposition: Mapped[Disposition | None] = mapped_column(Enum(Disposition), nullable=True)
    disposition_rationale: Mapped[str | None] = mapped_column(Text, nullable=True)

    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    opened_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    aggregation_event_ids: Mapped[list] = mapped_column(JSON, default=list)

    customer: Mapped[Customer] = relationship()
    notes: Mapped[list["CaseNote"]] = relationship(back_populates="case", order_by="CaseNote.created_at")
    evidence: Mapped[list["CaseEvidence"]] = relationship(back_populates="case")
    reports: Mapped[list["Report"]] = relationship(back_populates="case")


class CaseNote(Base):
    __tablename__ = "case_notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"), index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    note_type: Mapped[str] = mapped_column(String(32), default="OBSERVATION")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    case: Mapped[Case] = relationship(back_populates="notes")


class CaseEvidence(Base):
    __tablename__ = "case_evidence"
    __table_args__ = (
        UniqueConstraint("case_id", "evidence_type", "evidence_id", name="uq_case_evidence"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"), index=True)
    evidence_type: Mapped[str] = mapped_column(String(32))  # TRANSACTION / ALERT / AGGREGATION / WALLET
    evidence_id: Mapped[str] = mapped_column(String(64))
    label: Mapped[str] = mapped_column(String(200), default="")
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    added_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    case: Mapped[Case] = relationship(back_populates="evidence")


# ---------------------------------------------------------------------------
# Regulatory reporting
# ---------------------------------------------------------------------------


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"), index=True)
    report_type: Mapped[ReportType] = mapped_column(Enum(ReportType), index=True)
    report_reference: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    schema_version: Mapped[str] = mapped_column(String(32))

    status: Mapped[ReportStatus] = mapped_column(Enum(ReportStatus), default=ReportStatus.DRAFT, index=True)
    # Canonical internal representation (never bound directly to FINTRAC's schema).
    canonical: Mapped[dict] = mapped_column(JSON, default=dict)
    # Rendered FINTRAC payload produced by the mapper.
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    validation: Mapped[dict] = mapped_column(JSON, default=dict)

    narrative: Mapped[str | None] = mapped_column(Text, nullable=True)
    narrative_citations: Mapped[list] = mapped_column(JSON, default=list)

    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    case: Mapped[Case] = relationship(back_populates="reports")
    submissions: Mapped[list["Submission"]] = relationship(back_populates="report")


class Submission(Base):
    __tablename__ = "submissions"

    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id"), index=True)
    endpoint: Mapped[str] = mapped_column(String(120))
    request_id: Mapped[str] = mapped_column(String(64), index=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    response_status: Mapped[str] = mapped_column(String(24))
    submission_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    response: Mapped[dict] = mapped_column(JSON, default=dict)
    submitted_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    report: Mapped[Report] = relationship(back_populates="submissions")


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------


class AuditEvent(Base):
    """Append-only record of every consequential action.

    Rows are never updated or deleted.  ``prev_hash``/``hash`` chain the log so
    that a silent edit to history is detectable.
    """

    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    actor_name: Mapped[str] = mapped_column(String(64), default="system")
    action: Mapped[str] = mapped_column(String(64), index=True)
    object_type: Mapped[str] = mapped_column(String(32), index=True)
    object_id: Mapped[str] = mapped_column(String(64), index=True)
    before: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    prev_hash: Mapped[str] = mapped_column(String(64), default="")
    hash: Mapped[str] = mapped_column(String(64), default="")
