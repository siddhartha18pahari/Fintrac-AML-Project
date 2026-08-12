"""Pydantic request/response models for the API surface.

Responses are assembled by ``app.serializers`` as plain dictionaries; the models
here exist where FastAPI needs to *validate input*, which is the half that
matters for correctness.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .models import CustomerType, Disposition, PartyKind, ReportType, Role


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: dict


class CustomerCreate(BaseModel):
    model_config = ConfigDict(use_enum_values=False)

    customer_id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    customer_type: CustomerType = CustomerType.PERSON
    kyc_risk: str = "LOW"
    country: str = Field(default="CA", min_length=2, max_length=2)
    occupation_or_business: str = ""
    expected_monthly_volume_cad: Decimal = Decimal("0")
    onboarded_at: datetime | None = None
    kyc: dict = Field(default_factory=dict)

    @field_validator("kyc_risk")
    @classmethod
    def _risk(cls, value: str) -> str:
        allowed = {"LOW", "MEDIUM", "HIGH"}
        upper = value.upper()
        if upper not in allowed:
            raise ValueError(f"kyc_risk must be one of {sorted(allowed)}")
        return upper

    @field_validator("country")
    @classmethod
    def _country(cls, value: str) -> str:
        return value.upper()


class PartyCreate(BaseModel):
    party_id: str
    kind: PartyKind
    name: str
    party_type: CustomerType = CustomerType.PERSON
    country: str = "CA"
    kyc: dict = Field(default_factory=dict)


class TransactionIn(BaseModel):
    """The canonical transaction record accepted by the ingestion API."""

    transaction_id: str = Field(min_length=1, max_length=64)
    customer_id: str
    asset: str
    asset_amount: Decimal = Field(gt=0)
    timestamp: datetime
    direction: str = "incoming"
    wallet_from: str | None = None
    wallet_to: str | None = None
    blockchain: str | None = None
    exchange_rate: Decimal | None = None
    rate_source: str | None = None
    cad_value: Decimal | None = None
    blockchain_tx_hash: str | None = None
    beneficiary_id: str | None = None
    beneficiary_name: str | None = None
    beneficiary_country: str | None = None
    third_party_id: str | None = None
    third_party_name: str | None = None
    third_party_country: str | None = None
    wallet_from_risk: int | None = None
    wallet_from_tags: list[str] | None = None
    wallet_from_first_seen: datetime | None = None
    wallet_to_risk: int | None = None
    wallet_to_tags: list[str] | None = None
    context: dict = Field(default_factory=dict)
    scenario: str | None = None

    @field_validator("direction")
    @classmethod
    def _direction(cls, value: str) -> str:
        upper = value.upper()
        if upper not in {"INCOMING", "OUTGOING"}:
            raise ValueError("direction must be 'incoming' or 'outgoing'")
        return upper

    @field_validator("asset")
    @classmethod
    def _asset(cls, value: str) -> str:
        return value.upper()


class BatchIngestRequest(BaseModel):
    transactions: list[TransactionIn]
    run_detection: bool = True


class AssignRequest(BaseModel):
    assignee_id: int


class ReasonRequest(BaseModel):
    reason: str = Field(min_length=1)


class NoteRequest(BaseModel):
    body: str = Field(min_length=1)
    note_type: str = "OBSERVATION"


class StatusRequest(BaseModel):
    status: str
    reason: str | None = None


class OverrideRequest(BaseModel):
    score: int = Field(ge=0, le=100)
    reason: str = Field(min_length=10)


class DecisionRequest(BaseModel):
    disposition: Disposition
    rationale: str = Field(min_length=20)


class BuildReportRequest(BaseModel):
    report_type: ReportType = ReportType.LVCTR
    include_narrative: bool = False


class UserCreate(BaseModel):
    username: str
    full_name: str
    password: str = Field(min_length=8)
    role: Role = Role.ANALYST


class SeedRequest(BaseModel):
    customers: int = Field(default=40, ge=1, le=500)
    days: int = Field(default=45, ge=1, le=365)
    seed: int = 20260811
    reset: bool = True
    include_demo_case: bool = True
