"""Deterministic synthetic AML dataset generator.

Good labelled AML data is not publicly available, and using real customer data
for a portfolio project would be indefensible.  So this module manufactures a
ledger with *known* structure: a background of ordinary retail activity, plus
named scenarios that each plant a specific, checkable pattern.

Labelling discipline
--------------------
Nothing is labelled ``laundering = true``.  A behavioural pattern is not a
crime, and training or evaluating against such a label teaches the system to
assert something it cannot know.  Each scenario instead carries:

    scenario_type            what was planted
    lvctr_expected           whether a reporting obligation should arise
    alert_expected           whether at least one indicator should fire
    indicators_expected      which rule ids should be implicated

which is exactly what the compliance regression tests assert against.

Determinism: given the same ``seed`` and ``end``, the output is byte-identical,
including prices (the valuation oracle is a pure function of asset and hour).
"""

from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal

from app.services.valuation import ANCHOR_PRICES_CAD, oracle
from app.util import utcnow

ASSETS = ["BTC", "ETH", "USDT", "LTC", "SOL", "XMR"]
STABLE = {"USDT", "USDC"}

GIVEN_NAMES = [
    "Amara", "Beatriz", "Chidi", "Daniela", "Elias", "Farida", "Grigor", "Hana",
    "Ines", "Jamal", "Kiran", "Lucia", "Mateo", "Noor", "Oskar", "Priya",
    "Quentin", "Rosa", "Samir", "Tomas", "Ulla", "Viktor", "Wei", "Xiomara",
    "Yusuf", "Zofia", "Aditi", "Bruno", "Camille", "Dmitri",
]
SURNAMES = [
    "Abbas", "Bianchi", "Chen", "Dubois", "Eriksen", "Ferreira", "Grabowski",
    "Haddad", "Ivanov", "Jensen", "Kowalski", "Lindqvist", "Moreau", "Nakamura",
    "Okafor", "Petrov", "Quintero", "Rahman", "Silva", "Tremblay", "Uddin",
    "Vasquez", "Wang", "Xu", "Yilmaz", "Zhang", "Belanger", "Costa", "Dumont", "Nguyen",
]
BUSINESS_WORDS = [
    ("Maple", "Digital"), ("Harbour", "Trading"), ("Northline", "Ventures"),
    ("Cedar", "Logistics"), ("Aurora", "Imports"), ("Riverstone", "Holdings"),
    ("Beacon", "Commerce"), ("Summit", "Exchange"), ("Trillium", "Consulting"),
    ("Boreal", "Systems"),
]
OCCUPATIONS = [
    "Software developer", "Registered nurse", "Retail manager", "Electrician",
    "Accountant", "Graphic designer", "Truck driver", "Teacher", "Chef",
    "Civil engineer", "Pharmacist", "Real estate agent",
]
BUSINESS_NATURES = [
    "Import and distribution of consumer electronics",
    "Freight forwarding and customs brokerage",
    "Online retail of household goods",
    "Management consulting services",
    "Wholesale food distribution",
]
PROVINCES = ["ON", "QC", "BC", "AB", "MB", "NS"]
CITIES = {"ON": "Toronto", "QC": "Montreal", "BC": "Vancouver", "AB": "Calgary", "MB": "Winnipeg", "NS": "Halifax"}

RISK_TAG_POOL = ["mixer", "darknet_market", "sanctioned", "ransomware", "high_risk_exchange", "gambling"]


@dataclass
class Expectation:
    scenario: str
    customer_id: str
    lvctr_expected: bool
    alert_expected: bool
    indicators_expected: list[str] = field(default_factory=list)
    note: str = ""

    def as_dict(self) -> dict:
        return {
            "scenario_type": self.scenario,
            "customer_id": self.customer_id,
            "lvctr_expected": self.lvctr_expected,
            "alert_expected": self.alert_expected,
            "indicators_expected": self.indicators_expected,
            "note": self.note,
        }


@dataclass
class Dataset:
    customers: list[dict]
    parties: list[dict]
    transactions: list[dict]
    expectations: list[Expectation]

    def summary(self) -> dict:
        by_scenario: dict[str, int] = {}
        for txn in self.transactions:
            by_scenario[txn.get("scenario", "unlabelled")] = by_scenario.get(txn.get("scenario", "unlabelled"), 0) + 1
        return {
            "customers": len(self.customers),
            "parties": len(self.parties),
            "transactions": len(self.transactions),
            "scenarios": by_scenario,
            "lvctr_expected": sum(1 for e in self.expectations if e.lvctr_expected),
            "alert_expected": sum(1 for e in self.expectations if e.alert_expected),
        }


class SyntheticGenerator:
    def __init__(
        self,
        *,
        seed: int = 20260811,
        customers: int = 40,
        days: int = 45,
        end: datetime | None = None,
    ) -> None:
        self.rng = random.Random(seed)
        self.seed = seed
        self.customer_count = max(customers, 12)
        self.days = days
        self.end = (end or utcnow()).replace(minute=0, second=0, microsecond=0)
        self.start = self.end - timedelta(days=days)
        self._txn_seq = 0
        self.customers: list[dict] = []
        self.parties: list[dict] = []
        self.transactions: list[dict] = []
        self.expectations: list[Expectation] = []
        self._wallet_seq = 0

    # -- helpers ---------------------------------------------------------

    def _address(self, chain: str, tag: str = "") -> str:
        self._wallet_seq += 1
        digest = hashlib.sha256(f"{self.seed}:{chain}:{tag}:{self._wallet_seq}".encode()).hexdigest()
        if chain in {"ETH", "USDT", "USDC", "SOL"}:
            return "0x" + digest[:40]
        return {"BTC": "bc1q", "LTC": "ltc1q", "XMR": "4"}.get(chain, "addr") + digest[:34]

    def _tx_hash(self, chain: str) -> str:
        self._txn_seq += 1
        digest = hashlib.sha256(f"{self.seed}:hash:{chain}:{self._txn_seq}".encode()).hexdigest()
        return ("0x" + digest) if chain in {"ETH", "USDT", "SOL"} else digest

    def _next_txn_id(self) -> str:
        return f"tx_{self._txn_seq:06d}"

    def _asset_amount(self, asset: str, target_cad: Decimal, at: datetime) -> Decimal:
        """Back out the token amount that values to ``target_cad`` at ``at``."""
        price = oracle.price(asset, at)
        places = Decimal("0.00000001") if asset not in STABLE else Decimal("0.01")
        return (Decimal(target_cad) / price).quantize(places)

    def _receipt(
        self,
        customer: dict,
        *,
        at: datetime,
        cad_value: Decimal | float | int,
        asset: str | None = None,
        sender: str | None = None,
        scenario: str = "normal_retail",
        beneficiary: dict | None = None,
        third_party: dict | None = None,
        sender_risk: int | None = None,
        sender_tags: list[str] | None = None,
        sender_first_seen: datetime | None = None,
    ) -> dict:
        asset = asset or self.rng.choice(ASSETS)
        chain = asset
        sender = sender or self._address(chain, "ext")
        payload = {
            "transaction_id": self._next_txn_id(),
            "customer_id": customer["customer_id"],
            "asset": asset,
            "asset_amount": str(self._asset_amount(asset, Decimal(str(cad_value)), at)),
            "timestamp": at.isoformat(),
            "direction": "incoming",
            "wallet_from": sender,
            "wallet_to": customer["deposit_wallets"][asset],
            "blockchain": chain,
            "blockchain_tx_hash": self._tx_hash(chain),
            "scenario": scenario,
            "context": {
                "ip_address": self._ip(customer),
                "ip_country": customer["country"],
                "device_type_code": self.rng.choice(["1", "2", "3"]),
                "device_id": f"dev-{abs(hash(customer['customer_id'])) % 10**8:08d}",
                "username": customer["username"],
                "method_code": "8",
                "purpose": "Deposit of virtual currency",
            },
        }
        if sender_risk is not None:
            payload["wallet_from_risk"] = sender_risk
        if sender_tags:
            payload["wallet_from_tags"] = sender_tags
        if sender_first_seen is not None:
            payload["wallet_from_first_seen"] = sender_first_seen.isoformat()
        if beneficiary:
            payload.update(
                {
                    "beneficiary_id": beneficiary["party_id"],
                    "beneficiary_name": beneficiary["name"],
                    "beneficiary_country": beneficiary["country"],
                }
            )
        if third_party:
            payload.update(
                {
                    "third_party_id": third_party["party_id"],
                    "third_party_name": third_party["name"],
                    "third_party_country": third_party["country"],
                }
            )
        self.transactions.append(payload)
        return payload

    def _disposition(
        self,
        customer: dict,
        *,
        at: datetime,
        cad_value: Decimal | float | int,
        asset: str,
        receiver: str | None = None,
        scenario: str = "normal_retail",
        receiver_risk: int | None = None,
        receiver_tags: list[str] | None = None,
    ) -> dict:
        payload = {
            "transaction_id": self._next_txn_id(),
            "customer_id": customer["customer_id"],
            "asset": asset,
            "asset_amount": str(self._asset_amount(asset, Decimal(str(cad_value)), at)),
            "timestamp": at.isoformat(),
            "direction": "outgoing",
            "wallet_from": customer["deposit_wallets"][asset],
            "wallet_to": receiver or self._address(asset, "out"),
            "blockchain": asset,
            "blockchain_tx_hash": self._tx_hash(asset),
            "scenario": scenario,
            "context": {"ip_address": self._ip(customer), "method_code": "8", "purpose": "Withdrawal"},
        }
        if receiver_risk is not None:
            payload["wallet_to_risk"] = receiver_risk
        if receiver_tags:
            payload["wallet_to_tags"] = receiver_tags
        self.transactions.append(payload)
        return payload

    def _fiat(
        self,
        customer: dict,
        *,
        at: datetime,
        cad_value: Decimal | float | int,
        instrument: str,
        direction: str = "incoming",
        scenario: str,
        beneficiary: dict | None = None,
        international: bool = False,
        counterparty_country: str = "CA",
        counterparty_institution: str | None = None,
        device_id: str | None = None,
        extra_context: dict | None = None,
    ) -> dict:
        """Cash or electronic-funds movement. CAD is the asset; the rate is par."""
        amount = Decimal(str(cad_value)).quantize(Decimal("0.01"))
        txn_id = self._next_txn_id()
        self._txn_seq += 1
        purpose = "Cash deposit" if instrument == "CASH" else "Electronic funds transfer"
        payload = {
            "transaction_id": txn_id,
            "customer_id": customer["customer_id"],
            "instrument": instrument,
            "asset": "CAD",
            "asset_amount": str(amount),
            "exchange_rate": "1",
            "cad_value": str(amount),
            "timestamp": at.isoformat(),
            "direction": direction,
            "blockchain": "FIAT",
            "scenario": scenario,
            "international": international,
            "counterparty_country": counterparty_country,
            "context": {
                "ip_address": self._ip(customer),
                "ip_country": counterparty_country if international else customer["country"],
                "device_type_code": "1",
                "device_id": device_id or f"dev-{customer['customer_id']}",
                "username": customer["username"],
                "method_code": "1" if instrument == "CASH" else "2",
                "purpose": purpose,
                "international": international,
                "counterparty_country": counterparty_country,
            },
        }
        if extra_context:
            payload["context"].update(extra_context)
        if counterparty_institution:
            payload["counterparty_institution"] = counterparty_institution
            payload["context"]["counterparty_institution"] = counterparty_institution
        if beneficiary:
            payload.update(
                {
                    "beneficiary_id": beneficiary["party_id"],
                    "beneficiary_name": beneficiary["name"],
                    "beneficiary_country": beneficiary["country"],
                }
            )
        self.transactions.append(payload)
        return payload

    def _ip(self, customer: dict) -> str:
        base = abs(hash(customer["customer_id"])) % 254 + 1
        return f"198.51.{base}.{self.rng.randint(2, 250)}"

    # -- reference data --------------------------------------------------

    def _make_customer(self, index: int, *, entity: bool = False, name: str | None = None) -> dict:
        province = self.rng.choice(PROVINCES)
        if entity:
            head, tail = self.rng.choice(BUSINESS_WORDS)
            display = name or f"{head} {tail} Ltd."
            kyc = {
                "legal_name": display,
                "business_nature": self.rng.choice(BUSINESS_NATURES),
                "telephone": f"416555{1000 + index:04d}",
                "registration_number": f"BN{700000000 + index}",
                "registration_country": "CA",
                "registration_province": province,
                "email": f"ops@{display.split()[0].lower()}.example",
                "address": {
                    "building": str(self.rng.randint(10, 999)),
                    "street": f"{self.rng.choice(['King','Queen','Bay','Yonge','Main'])} Street West",
                    "city": CITIES[province],
                    "province": province,
                    "postal_code": f"M{self.rng.randint(1,9)}A {self.rng.randint(1,9)}B{self.rng.randint(1,9)}",
                    "country": "CA",
                },
                "identifications": [
                    {
                        "type_code": "35",
                        "number": f"BN{700000000 + index}",
                        "country": "CA",
                        "province": province,
                    }
                ],
                "authorized_persons": [
                    {"surname": self.rng.choice(SURNAMES), "given_name": self.rng.choice(GIVEN_NAMES)}
                ],
            }
            occupation = kyc["business_nature"]
        else:
            given = self.rng.choice(GIVEN_NAMES)
            surname = self.rng.choice(SURNAMES)
            display = name or f"{given} {surname}"
            birth_year = self.rng.randint(1960, 2002)
            kyc = {
                "surname": display.split()[-1],
                "given_name": display.split()[0],
                "birth_date": f"{birth_year}-{self.rng.randint(1,12):02d}-{self.rng.randint(1,28):02d}",
                "occupation": self.rng.choice(OCCUPATIONS),
                "employer_name": f"{self.rng.choice(BUSINESS_WORDS)[0]} Corp",
                "telephone": f"647555{2000 + index:04d}",
                "email": f"{display.split()[0].lower()}.{display.split()[-1].lower()}@example.invalid",
                "residence_country": "CA",
                "address": {
                    "unit": str(self.rng.randint(1, 40)),
                    "building": str(self.rng.randint(10, 999)),
                    "street": f"{self.rng.choice(['Elm','Oak','Pine','Maple','Birch'])} Avenue",
                    "city": CITIES[province],
                    "province": province,
                    "postal_code": f"K{self.rng.randint(1,9)}C {self.rng.randint(1,9)}D{self.rng.randint(1,9)}",
                    "country": "CA",
                },
                "identifications": [
                    {
                        "type_code": "4",
                        "number": f"D{self.rng.randint(1000000, 9999999)}",
                        "country": "CA",
                        "province": province,
                    }
                ],
            }
            occupation = kyc["occupation"]

        customer = {
            "customer_id": f"cust_{index:04d}",
            "name": display,
            "customer_type": "ENTITY" if entity else "PERSON",
            "kyc_risk": self.rng.choices(["LOW", "MEDIUM", "HIGH"], weights=[70, 25, 5])[0],
            "country": "CA",
            "occupation_or_business": occupation,
            "expected_monthly_volume_cad": str(
                Decimal(self.rng.choice([5000, 10000, 15000, 20000, 30000, 50000]))
            ),
            "onboarded_at": (self.start - timedelta(days=self.rng.randint(60, 900))).isoformat(),
            "kyc": kyc,
            "username": f"user{index:04d}",
            "deposit_wallets": {asset: self._address(asset, f"int{index}") for asset in ASSETS},
            # Ordinary customers deposit from a small set of addresses they use
            # repeatedly (their own exchange account, an employer, a relative).
            # Minting a fresh counterparty for every retail deposit would make
            # "receipts from newly observed addresses" true of everyone, and the
            # rule that looks for it meaningless.
            "known_senders": {
                asset: [self._address(asset, f"known{index}-{n}") for n in range(3)] for asset in ASSETS
            },
        }
        self.customers.append(customer)
        return customer

    def _make_party(
        self,
        index: int,
        kind: str,
        *,
        entity: bool = False,
        country: str = "CA",
        name: str | None = None,
    ) -> dict:
        if name:
            display = name
        elif entity:
            head, tail = self.rng.choice(BUSINESS_WORDS)
            display = f"{head} {tail} Inc."
        else:
            display = f"{self.rng.choice(GIVEN_NAMES)} {self.rng.choice(SURNAMES)}"
        party = {
            "party_id": f"{'ben' if kind == 'BENEFICIARY' else 'tp'}_{index:04d}",
            "kind": kind,
            "name": display,
            "party_type": "ENTITY" if entity else "PERSON",
            "country": country,
            "kyc": (
                {"legal_name": display, "client_number": f"CN{index:06d}"}
                if entity or " " not in display
                else {
                    "surname": display.split()[-1],
                    "given_name": display.split()[0],
                    "client_number": f"CN{index:06d}",
                    "relationship_type_code": "5",
                }
            ),
        }
        self.parties.append(party)
        return party

    # -- background ------------------------------------------------------

    def _background(self, customer: dict) -> None:
        """Ordinary retail activity: small, irregular, mostly below threshold."""
        days_active = self.rng.randint(int(self.days * 0.3), self.days)
        for _ in range(days_active):
            if self.rng.random() > 0.45:
                continue
            offset = self.rng.randint(0, self.days - 1)
            at = self.start + timedelta(days=offset, hours=self.rng.randint(7, 22), minutes=self.rng.randint(0, 59))
            if at > self.end:
                continue
            amount = Decimal(self.rng.choice([120, 250, 400, 650, 900, 1400, 2200, 3100]))
            asset = self.rng.choices(ASSETS, weights=[35, 25, 20, 8, 8, 4])[0]
            self._receipt(
                customer,
                at=at,
                cad_value=amount,
                asset=asset,
                sender=self.rng.choice(customer["known_senders"][asset]),
                sender_first_seen=self.start - timedelta(days=self.rng.randint(30, 400)),
                scenario="normal_retail",
            )
            if self.rng.random() < 0.35:
                self._disposition(
                    customer,
                    at=at + timedelta(hours=self.rng.randint(6, 90)),
                    cad_value=amount * Decimal("0.6"),
                    asset=asset,
                    scenario="normal_retail",
                )

    # -- scenarios -------------------------------------------------------

    def _scenario_single_threshold(self, customer: dict, at: datetime) -> None:
        self._receipt(customer, at=at, cad_value=Decimal("14250.33"), asset="ETH", scenario="single_threshold")
        self.expectations.append(
            Expectation(
                "single_threshold",
                customer["customer_id"],
                lvctr_expected=True,
                alert_expected=True,
                indicators_expected=["AML-VC-012"],
                note="One receipt of CAD 14,250.33 - above the CAD 10,000 threshold on its own.",
            )
        )

    def _scenario_aggregation_24h(self, customer: dict, at: datetime) -> None:
        amounts = [Decimal("3200"), Decimal("2400"), Decimal("3100"), Decimal("2500"), Decimal("4600"), Decimal("5800")]
        clock = at.replace(hour=9, minute=5)
        for index, amount in enumerate(amounts):
            self._receipt(
                customer,
                at=clock + timedelta(minutes=39 * index + 35 * index * index // 4),
                cad_value=amount,
                asset=self.rng.choice(["BTC", "ETH", "USDT"]),
                scenario="aggregation_24h",
            )
        self.expectations.append(
            Expectation(
                "aggregation_24h",
                customer["customer_id"],
                lvctr_expected=True,
                alert_expected=True,
                indicators_expected=["AML-VC-012", "AML-VC-010"],
                note="Six receipts totalling CAD 21,600 from six wallets inside one 24-hour window.",
            )
        )

    def _scenario_aggregation_beneficiary(self, customers: list[dict], at: datetime, beneficiary: dict) -> None:
        clock = at.replace(hour=10, minute=0)
        for index, customer in enumerate(customers):
            self._receipt(
                customer,
                at=clock + timedelta(hours=2 * index),
                cad_value=Decimal("4200"),
                asset="USDT",
                beneficiary=beneficiary,
                scenario="aggregation_beneficiary",
            )
        self.expectations.append(
            Expectation(
                "aggregation_beneficiary",
                customers[0]["customer_id"],
                lvctr_expected=True,
                alert_expected=True,
                indicators_expected=["AML-VC-012", "AML-VC-008"],
                note="Three CAD 4,200 receipts by different conductors for the same beneficiary within 24 hours.",
            )
        )

    def _scenario_third_party(self, customer: dict, at: datetime, third_party: dict) -> None:
        clock = at.replace(hour=8, minute=30)
        for index, amount in enumerate([Decimal("3900"), Decimal("3700"), Decimal("3600")]):
            self._receipt(
                customer,
                at=clock + timedelta(hours=5 * index),
                cad_value=amount,
                asset="BTC",
                third_party=third_party,
                scenario="aggregation_third_party",
            )
        self.expectations.append(
            Expectation(
                "aggregation_third_party",
                customer["customer_id"],
                lvctr_expected=True,
                alert_expected=True,
                indicators_expected=["AML-VC-012"],
                note="Receipts conducted on behalf of the same third party aggregate past the threshold.",
            )
        )

    def _scenario_near_threshold(self, customer: dict, at: datetime) -> None:
        clock = at.replace(hour=11, minute=15)
        for index, amount in enumerate([Decimal("3300"), Decimal("3200"), Decimal("3350")]):
            self._receipt(
                customer,
                at=clock + timedelta(hours=3 * index),
                cad_value=amount,
                asset="USDT",
                scenario="near_threshold",
            )
        self.expectations.append(
            Expectation(
                "near_threshold",
                customer["customer_id"],
                lvctr_expected=False,
                alert_expected=True,
                indicators_expected=["AML-VC-002"],
                note="CAD 9,850 in 24 hours - 98.5% of the threshold, so no LVCTR obligation arises.",
            )
        )

    def _scenario_fan_in(self, customer: dict, at: datetime) -> None:
        clock = at.replace(hour=14, minute=0)
        for index in range(9):
            self._receipt(
                customer,
                at=clock + timedelta(minutes=5 * index),
                cad_value=Decimal(self.rng.choice([700, 850, 1100, 1300])),
                asset="ETH",
                scenario="fan_in",
            )
        self.expectations.append(
            Expectation(
                "fan_in",
                customer["customer_id"],
                lvctr_expected=False,
                alert_expected=True,
                indicators_expected=["AML-VC-001", "AML-VC-010"],
                note="Nine receipts from nine distinct wallets inside 45 minutes.",
            )
        )

    def _scenario_pass_through(self, customer: dict, at: datetime) -> None:
        clock = at.replace(hour=16, minute=0)
        received = Decimal("11800")
        self._receipt(customer, at=clock, cad_value=received, asset="BTC", scenario="rapid_pass_through")
        self._disposition(
            customer,
            at=clock + timedelta(minutes=22),
            cad_value=received * Decimal("0.96"),
            asset="BTC",
            scenario="rapid_pass_through",
        )
        self.expectations.append(
            Expectation(
                "rapid_pass_through",
                customer["customer_id"],
                lvctr_expected=True,
                alert_expected=True,
                indicators_expected=["AML-VC-003", "AML-VC-012"],
                note="CAD 11,800 received and 96% of it sent onward 22 minutes later.",
            )
        )

    def _scenario_circular(self, customer: dict, at: datetime) -> None:
        clock = at.replace(hour=9, minute=0)
        hop1 = self._address("ETH", "hop1")
        hop2 = self._address("ETH", "hop2")
        self._disposition(customer, at=clock, cad_value=Decimal("8200"), asset="ETH", receiver=hop1, scenario="circular_flow")
        # Intermediary movement, recorded against a shell customer so it exists in the ledger.
        shell = self.customers[-1]
        self.transactions.append(
            {
                "transaction_id": f"tx_hop_{self._txn_seq}",
                "customer_id": shell["customer_id"],
                "asset": "ETH",
                "asset_amount": str(self._asset_amount("ETH", Decimal("8100"), clock + timedelta(hours=3))),
                "timestamp": (clock + timedelta(hours=3)).isoformat(),
                "direction": "outgoing",
                "wallet_from": hop1,
                "wallet_to": hop2,
                "blockchain": "ETH",
                "blockchain_tx_hash": self._tx_hash("ETH"),
                "scenario": "circular_flow",
                "context": {"purpose": "Intermediary movement"},
            }
        )
        self._txn_seq += 1
        self._receipt(
            customer,
            at=clock + timedelta(hours=7),
            cad_value=Decimal("7950"),
            asset="ETH",
            sender=hop2,
            scenario="circular_flow",
        )
        self.expectations.append(
            Expectation(
                "circular_flow",
                customer["customer_id"],
                lvctr_expected=False,
                alert_expected=True,
                indicators_expected=["AML-VC-011"],
                note="Value left the customer, passed through two addresses and returned within seven hours.",
            )
        )

    def _scenario_high_risk_counterparty(self, customer: dict, at: datetime) -> None:
        tag = self.rng.choice(["mixer", "darknet_market", "sanctioned"])
        self._receipt(
            customer,
            at=at.replace(hour=13, minute=20),
            cad_value=Decimal("6400"),
            asset="XMR",
            scenario="high_risk_counterparty",
            sender_risk=self.rng.randint(82, 97),
            sender_tags=[tag],
        )
        self.expectations.append(
            Expectation(
                "high_risk_counterparty",
                customer["customer_id"],
                lvctr_expected=False,
                alert_expected=True,
                indicators_expected=["AML-VC-005"],
                note=f"Receipt from a counterparty tagged '{tag}' by the analytics source.",
            )
        )

    def _scenario_dormant_spike(self, customer: dict, at: datetime) -> None:
        # Old, isolated activity followed by a long silence.
        self._receipt(
            customer,
            at=self.start - timedelta(days=150),
            cad_value=Decimal("600"),
            asset="BTC",
            scenario="dormant_spike",
        )
        self._receipt(
            customer,
            at=at.replace(hour=10, minute=45),
            cad_value=Decimal("9200"),
            asset="BTC",
            scenario="dormant_spike",
        )
        self.expectations.append(
            Expectation(
                "dormant_spike",
                customer["customer_id"],
                lvctr_expected=False,
                alert_expected=True,
                indicators_expected=["AML-VC-006"],
                note="Dormant for over 150 days, then a CAD 9,200 receipt.",
            )
        )

    def _scenario_chain_hopping(self, customer: dict, at: datetime) -> None:
        clock = at.replace(hour=12, minute=0)
        for index, asset in enumerate(["BTC", "ETH", "USDT", "LTC"]):
            self._receipt(
                customer,
                at=clock + timedelta(minutes=50 * index),
                cad_value=Decimal("1600"),
                asset=asset,
                scenario="chain_hopping",
            )
        self.expectations.append(
            Expectation(
                "chain_hopping",
                customer["customer_id"],
                lvctr_expected=False,
                alert_expected=True,
                indicators_expected=["AML-VC-013"],
                note="Four different virtual currencies used within two and a half hours.",
            )
        )

    def _scenario_shared_wallet(self, customers: list[dict], at: datetime) -> None:
        shared = self._address("ETH", "shared")
        clock = at.replace(hour=15, minute=30)
        for index, customer in enumerate(customers):
            self._receipt(
                customer,
                at=clock + timedelta(hours=index),
                cad_value=Decimal("2600"),
                asset="ETH",
                sender=shared,
                scenario="shared_wallet",
            )
        self.expectations.append(
            Expectation(
                "shared_wallet",
                customers[0]["customer_id"],
                lvctr_expected=False,
                alert_expected=True,
                indicators_expected=["AML-VC-007"],
                note="One external address funds three unrelated customers.",
            )
        )

    def _scenario_new_addresses(self, customer: dict, at: datetime) -> None:
        clock = at.replace(hour=17, minute=0)
        for index in range(4):
            self._receipt(
                customer,
                at=clock + timedelta(minutes=25 * index),
                cad_value=Decimal("1500"),
                asset="SOL",
                scenario="new_address_concentration",
                sender_first_seen=clock - timedelta(days=1),
            )
        self.expectations.append(
            Expectation(
                "new_address_concentration",
                customer["customer_id"],
                lvctr_expected=False,
                alert_expected=True,
                indicators_expected=["AML-VC-014"],
                note="All value in the window arrives from addresses first observed a day earlier.",
            )
        )

    def _scenario_high_risk_jurisdiction(self, customer: dict, at: datetime, party: dict) -> None:
        self._receipt(
            customer,
            at=at.replace(hour=9, minute=40),
            cad_value=Decimal("5200"),
            asset="USDT",
            beneficiary=party,
            scenario="high_risk_jurisdiction",
        )
        self.expectations.append(
            Expectation(
                "high_risk_jurisdiction",
                customer["customer_id"],
                lvctr_expected=False,
                alert_expected=True,
                indicators_expected=["AML-VC-009"],
                note=f"Beneficiary resident in {party['country']}, a jurisdiction on the configured list.",
            )
        )

    # -- cash, wires, and cross-rail movement ----------------------------

    def _scenario_lctr_single(self, at: datetime) -> None:
        customer = self._make_customer(9101, name="Helene Bouchard")
        customer["expected_monthly_volume_cad"] = "8000"
        customer["occupation_or_business"] = "Retail manager"
        self._fiat(
            customer,
            at=at.replace(hour=11, minute=15),
            cad_value=Decimal("12500"),
            instrument="CASH",
            scenario="lctr_single",
        )
        self.expectations.append(
            Expectation(
                "lctr_single",
                customer["customer_id"],
                lvctr_expected=False,
                alert_expected=True,
                indicators_expected=["AML-FI-001"],
                note="One cash receipt of CAD 12,500. Large cash transaction report, not an LVCTR.",
            )
        )

    def _scenario_cash_structuring(self, at: datetime) -> None:
        customer = self._make_customer(9102, entity=True, name="Harbour Cash Services Ltd.")
        customer["kyc_risk"] = "HIGH"
        customer["occupation_or_business"] = "Money services and remittance"
        customer["expected_monthly_volume_cad"] = "20000"
        base = at.replace(hour=9, minute=5)
        for index, amount in enumerate((Decimal("9200"), Decimal("8800"), Decimal("9500"), Decimal("8700"))):
            self._fiat(
                customer,
                at=base + timedelta(hours=3 * index),
                cad_value=amount,
                instrument="CASH",
                scenario="cash_structuring",
            )
        self.expectations.append(
            Expectation(
                "cash_structuring",
                customer["customer_id"],
                lvctr_expected=False,
                alert_expected=True,
                indicators_expected=["AML-FI-001", "AML-FI-003"],
                note="Four cash receipts under CAD 10,000 that together clear the line inside one day.",
            )
        )

    def _scenario_eftr(self, at: datetime) -> None:
        customer = self._make_customer(9103, name="Owen Lindqvist")
        customer["expected_monthly_volume_cad"] = "6000"
        self._fiat(
            customer,
            at=at.replace(hour=14, minute=40),
            cad_value=Decimal("18500"),
            instrument="EFT",
            direction="outgoing",
            scenario="eftr_international",
            international=True,
            counterparty_country="DE",
            counterparty_institution="Nordhalle Bank AG",
            extra_context={
                "travel": self._travel_block(
                    originator="Owen Lindqvist",
                    beneficiary="Klaus Reinhardt",
                    institution="Nordhalle Bank AG",
                    address="Hauptstrasse 12, Hamburg, DE",
                )
            },
        )
        self.expectations.append(
            Expectation(
                "eftr_international",
                customer["customer_id"],
                lvctr_expected=False,
                alert_expected=True,
                indicators_expected=["AML-FI-002"],
                note="CAD 18,500 international wire to Germany. EFTR threshold, not a domestic transfer.",
            )
        )

    def _scenario_rapid_rails(self, at: datetime) -> None:
        customer = self._make_customer(9104, entity=True, name="Cedar Remit Co.")
        customer["occupation_or_business"] = "Money services and remittance"
        customer["kyc_risk"] = "HIGH"
        customer["expected_monthly_volume_cad"] = "15000"
        start = at.replace(hour=10, minute=5)
        self._fiat(
            customer,
            at=start,
            cad_value=Decimal("18000"),
            instrument="CASH",
            scenario="rapid_cross_rail",
        )
        self._disposition(
            customer,
            at=start + timedelta(hours=2),
            cad_value=Decimal("15500"),
            asset="USDT",
            scenario="rapid_cross_rail",
        )
        self.expectations.append(
            Expectation(
                "rapid_cross_rail",
                customer["customer_id"],
                lvctr_expected=False,
                alert_expected=True,
                indicators_expected=["AML-FI-001", "AML-FI-004"],
                note="CAD 18,000 in cash leaves as USDT within two hours.",
            )
        )

    def _scenario_smurf_ring(self, at: datetime) -> None:
        beneficiary = self._make_party(910, "BENEFICIARY", entity=True, country="CA")
        device = "dev-smurf-ring"
        names = ("Ibrahim Haddad", "Nora Silva", "Etienne Moreau")
        planted = []
        base = at.replace(hour=13, minute=10)
        for offset, name in enumerate(names):
            customer = self._make_customer(9110 + offset, name=name)
            customer["expected_monthly_volume_cad"] = "4000"
            self._fiat(
                customer,
                at=base + timedelta(minutes=35 * offset),
                cad_value=Decimal("4500"),
                instrument="CASH",
                scenario="smurf_ring",
                beneficiary=beneficiary,
                device_id=device,
            )
            planted.append(customer)
        self.expectations.append(
            Expectation(
                "smurf_ring",
                planted[-1]["customer_id"],
                lvctr_expected=False,
                alert_expected=True,
                indicators_expected=["AML-FI-005"],
                note=(
                    "Three customers each place CAD 4,500 cash with one beneficiary and share a device. "
                    "No single conductor reaches the large-cash line."
                ),
            )
        )

    def _travel_block(
        self,
        *,
        originator: str,
        beneficiary: str,
        institution: str,
        address: str = "Trade Centre, Dubai, AE",
        complete: bool = True,
    ) -> dict:
        return {
            "originator_name": originator,
            "originator_account": "CA77SENTINEL001928",
            "originator_address": "120 King Street West, Toronto, ON, CA",
            "beneficiary_name": beneficiary,
            "beneficiary_account": "AE070331234567890123456" if complete else "",
            "beneficiary_address": address if complete else "",
            "beneficiary_institution": institution if complete else "",
        }

    def _pin_place(self, customer: dict, province: str, city: str) -> None:
        address = customer["kyc"].setdefault("address", {})
        address["province"] = province
        address["city"] = city
        customer["expected_monthly_volume_cad"] = customer.get("expected_monthly_volume_cad") or "25000"

    # -- screening, travel rule, trade, MSB, casino ----------------------

    def _scenario_sanctions(self, at: datetime) -> None:
        customer = self._make_customer(9201, name="Soren Halburg")
        customer["expected_monthly_volume_cad"] = "25000"
        customer["occupation_or_business"] = "Civil engineer"
        self._pin_place(customer, "BC", "Vancouver")
        self._receipt(
            customer,
            at=at.replace(hour=10, minute=15),
            cad_value=Decimal("1800"),
            asset="BTC",
            sender_first_seen=at - timedelta(days=400),
            scenario="sanctions_fuzzy",
        )
        self.expectations.append(
            Expectation(
                "sanctions_fuzzy",
                customer["customer_id"],
                lvctr_expected=False,
                alert_expected=True,
                indicators_expected=["AML-SC-001"],
                note="Customer name Soren Halburg is one edit from sample sanctions entry Soren Halberg.",
            )
        )

        payer = self._make_customer(9208, name="Jonas Pell")
        payer["expected_monthly_volume_cad"] = "25000"
        self._pin_place(payer, "AB", "Calgary")
        listed = self._make_party(9301, "BENEFICIARY", entity=True, name="Orun Commodities DMCC", country="AE")
        self._receipt(
            payer,
            at=at.replace(hour=11, minute=5),
            cad_value=Decimal("1600"),
            asset="USDT",
            beneficiary=listed,
            sender_first_seen=at - timedelta(days=200),
            scenario="sanctions_counterparty",
        )
        self.expectations.append(
            Expectation(
                "sanctions_counterparty",
                payer["customer_id"],
                lvctr_expected=False,
                alert_expected=True,
                indicators_expected=["AML-SC-001"],
                note="Beneficiary is the fictional entity Orun Commodities DMCC on the sample sanctions list.",
            )
        )

    def _scenario_pep(self, at: datetime) -> None:
        customer = self._make_customer(9202, name="Marisol Quayle")
        customer["expected_monthly_volume_cad"] = "25000"
        customer["occupation_or_business"] = "Public office (sample PEP)"
        customer["kyc_risk"] = "HIGH"
        self._pin_place(customer, "ON", "Toronto")
        self._receipt(
            customer,
            at=at.replace(hour=9, minute=40),
            cad_value=Decimal("900"),
            asset="ETH",
            sender_first_seen=at - timedelta(days=120),
            scenario="pep_match",
        )
        self.expectations.append(
            Expectation(
                "pep_match",
                customer["customer_id"],
                lvctr_expected=False,
                alert_expected=True,
                indicators_expected=["AML-SC-002"],
                note="Exact match to the fictional PEP Marisol Quayle. Enhanced review, not a report.",
            )
        )

    def _scenario_terrorist_property(self, at: datetime) -> None:
        customer = self._make_customer(9203, name="Nabil Qureshi")
        customer["expected_monthly_volume_cad"] = "25000"
        self._pin_place(customer, "QC", "Montreal")
        self._receipt(
            customer,
            at=at.replace(hour=15, minute=20),
            cad_value=Decimal("6400"),
            asset="BTC",
            sender_first_seen=at - timedelta(days=400),
            scenario="terrorist_property",
        )
        self.expectations.append(
            Expectation(
                "terrorist_property",
                customer["customer_id"],
                lvctr_expected=False,
                alert_expected=True,
                indicators_expected=["AML-TF-001"],
                note="Exact match to the fictional terrorist-property sample. A TPR would be in question on a real list.",
            )
        )

    def _scenario_travel_gap(self, at: datetime) -> None:
        customer = self._make_customer(9204, name="Tamsin Crowe")
        customer["expected_monthly_volume_cad"] = "25000"
        self._pin_place(customer, "AB", "Calgary")
        self._fiat(
            customer,
            at=at.replace(hour=13, minute=25),
            cad_value=Decimal("4200"),
            instrument="EFT",
            direction="outgoing",
            scenario="travel_rule_gap",
            international=True,
            counterparty_country="AE",
            counterparty_institution="Wadi Settlement Bank",
            extra_context={
                "travel": self._travel_block(
                    originator="Tamsin Crowe",
                    beneficiary="Rashid Noor Trading",
                    institution="Wadi Settlement Bank",
                    complete=False,
                )
            },
        )
        self.expectations.append(
            Expectation(
                "travel_rule_gap",
                customer["customer_id"],
                lvctr_expected=False,
                alert_expected=True,
                indicators_expected=["AML-TR-001"],
                note="CAD 4,200 international wire with beneficiary account, address, and institution blank.",
            )
        )

    def _scenario_trade(self, at: datetime) -> None:
        customer = self._make_customer(9205, entity=True, name="Aurora Cross-Border Trading Ltd.")
        customer["occupation_or_business"] = "Wholesale import and export"
        customer["expected_monthly_volume_cad"] = "40000"
        self._pin_place(customer, "ON", "Toronto")
        self._fiat(
            customer,
            at=at.replace(hour=16, minute=10),
            cad_value=Decimal("48000"),
            instrument="EFT",
            direction="outgoing",
            scenario="trade_based",
            international=True,
            counterparty_country="AE",
            counterparty_institution="Gulf Settlement Bank",
            extra_context={
                "travel": self._travel_block(
                    originator="Aurora Cross-Border Trading Ltd.",
                    beneficiary="Harbour Goods General Trading",
                    institution="Gulf Settlement Bank",
                ),
                "trade": {
                    "invoice_cad": 48000,
                    "declared_goods_cad": 12000,
                    "goods_description": "plastic household articles",
                    "hs_code": "3924.10",
                    "shipment_reference": "SHP-4419",
                },
            },
        )
        self.expectations.append(
            Expectation(
                "trade_based",
                customer["customer_id"],
                lvctr_expected=False,
                alert_expected=True,
                indicators_expected=["AML-TB-001", "AML-FI-002"],
                note="Invoice CAD 48,000 against declared goods of CAD 12,000, paid by international wire.",
            )
        )

        quiet = self._make_customer(9209, entity=True, name="Keel and Spar Wholesale Ltd.")
        quiet["occupation_or_business"] = "Wholesale food distribution"
        quiet["expected_monthly_volume_cad"] = "30000"
        self._pin_place(quiet, "NS", "Halifax")
        self._fiat(
            quiet,
            at=at.replace(hour=12, minute=5),
            cad_value=Decimal("8000"),
            instrument="EFT",
            direction="outgoing",
            scenario="trade_within_tolerance",
            international=True,
            counterparty_country="US",
            counterparty_institution="Seaboard Clearing Bank",
            extra_context={
                "travel": self._travel_block(
                    originator="Keel and Spar Wholesale Ltd.",
                    beneficiary="North Wharf Foods Inc.",
                    institution="Seaboard Clearing Bank",
                    address="18 Harbor Street, Boston, US",
                ),
                "trade": {
                    "invoice_cad": 8000,
                    "declared_goods_cad": 7200,
                    "goods_description": "canned vegetables",
                    "hs_code": "2005.99",
                    "shipment_reference": "SHP-2281",
                },
            },
        )
        self.expectations.append(
            Expectation(
                "trade_within_tolerance",
                quiet["customer_id"],
                lvctr_expected=False,
                alert_expected=False,
                indicators_expected=[],
                note="Invoice is about 11 percent above the declared goods value, under the 25 percent line, and under the EFTR line.",
            )
        )

    def _scenario_msb(self, at: datetime) -> None:
        customer = self._make_customer(9206, entity=True, name="Prairie Transfer MSB Ltd.")
        customer["occupation_or_business"] = "Money services business"
        customer["kyc_risk"] = "HIGH"
        customer["expected_monthly_volume_cad"] = "30000"
        self._pin_place(customer, "MB", "Winnipeg")
        base = at.replace(hour=9, minute=0)
        for index, amount in enumerate((Decimal("1600"), Decimal("1700"), Decimal("1500"), Decimal("1600"))):
            self._fiat(
                customer,
                at=base + timedelta(minutes=40 * index),
                cad_value=amount,
                instrument="CASH",
                scenario="msb_payouts",
            )
        for index, name in enumerate(("Payee North", "Payee East", "Payee West", "Payee South")):
            beneficiary = self._make_party(9310 + index, "BENEFICIARY", name=name)
            self._fiat(
                customer,
                at=base + timedelta(hours=10, minutes=20 * index),
                cad_value=Decimal("1400"),
                instrument="EFT",
                direction="outgoing",
                scenario="msb_payouts",
                international=False,
                counterparty_country="CA",
                beneficiary=beneficiary,
            )
        self.expectations.append(
            Expectation(
                "msb_payouts",
                customer["customer_id"],
                lvctr_expected=False,
                alert_expected=True,
                indicators_expected=["AML-TB-002"],
                note="MSB takes CAD 6,400 in cash and pays four beneficiaries by domestic EFT later the same day.",
            )
        )

    def _scenario_casino(self, at: datetime) -> None:
        customer = self._make_customer(9207, entity=True, name="Laurentian Palace Casino")
        customer["occupation_or_business"] = "Casino and gaming"
        customer["expected_monthly_volume_cad"] = "80000"
        customer["kyc_risk"] = "HIGH"
        self._pin_place(customer, "QC", "Montreal")
        self._fiat(
            customer,
            at=at.replace(hour=20, minute=10),
            cad_value=Decimal("9000"),
            instrument="CASH",
            scenario="casino_minimal_play",
            extra_context={
                "casino": {
                    "chips_purchased_cad": 9000,
                    "gaming_activity_cad": 450,
                    "redemption_cad": 8500,
                    "redemption_instrument": "EFT",
                    "redemption_to_third_party": True,
                    "third_party_name": "Payee North",
                }
            },
        )
        self.expectations.append(
            Expectation(
                "casino_minimal_play",
                customer["customer_id"],
                lvctr_expected=False,
                alert_expected=True,
                indicators_expected=["AML-TB-003"],
                note="CAD 9,000 in chips, CAD 450 of play, redeemed to a third party. Under the large-cash line.",
            )
        )

        healthy = self._make_customer(9210, entity=True, name="Fairway Gaming Hall")
        healthy["occupation_or_business"] = "Casino and gaming"
        healthy["expected_monthly_volume_cad"] = "60000"
        self._pin_place(healthy, "BC", "Vancouver")
        self._fiat(
            healthy,
            at=at.replace(hour=19, minute=5),
            cad_value=Decimal("5000"),
            instrument="CASH",
            scenario="casino_ordinary_play",
            extra_context={
                "casino": {
                    "chips_purchased_cad": 5000,
                    "gaming_activity_cad": 3500,
                    "redemption_cad": 1400,
                    "redemption_instrument": "CASH",
                    "redemption_to_third_party": False,
                }
            },
        )
        self.expectations.append(
            Expectation(
                "casino_ordinary_play",
                healthy["customer_id"],
                lvctr_expected=False,
                alert_expected=False,
                indicators_expected=[],
                note="CAD 5,000 buy-in with CAD 3,500 of play. Above the minimal-play line.",
            )
        )

    # -- flagship demo ---------------------------------------------------

    def _demo_case(self, at: datetime) -> dict:
        """Maple Digital Imports Ltd. - the walkthrough scenario.

        Declared CAD 20,000 monthly; receives CAD 21,600 in one day from six
        wallets, moves most of it straight out, and shares a beneficiary with
        another customer.  Every layer of the platform has something to say
        about it, which is what makes it a good demo.
        """
        customer = self._make_customer(9001, entity=True, name="Maple Digital Imports Ltd.")
        customer["expected_monthly_volume_cad"] = "20000"
        customer["kyc_risk"] = "MEDIUM"
        customer["occupation_or_business"] = "Import and distribution of consumer electronics"
        customer["kyc"]["business_nature"] = customer["occupation_or_business"]

        beneficiary = self._make_party(9001, "BENEFICIARY", entity=True)
        day = at.replace(hour=9, minute=5, second=0, microsecond=0)

        # Establish a modest baseline so the deviation rule has something to
        # compare against - without it, "11.7x baseline" would be meaningless.
        for week in range(1, 7):
            for index in range(3):
                asset = self.rng.choice(["BTC", "ETH", "USDT"])
                self._receipt(
                    customer,
                    at=day - timedelta(days=7 * week, hours=3 * index),
                    cad_value=Decimal(self.rng.choice([1200, 1800, 2400])),
                    asset=asset,
                    sender=self.rng.choice(customer["known_senders"][asset]),
                    sender_first_seen=day - timedelta(days=300),
                    scenario="demo_baseline",
                )

        schedule = [
            (0, 0, Decimal("3200"), "BTC"),
            (0, 39, Decimal("2400"), "BTC"),
            (1, 14, Decimal("3100"), "ETH"),
            (2, 2, Decimal("2500"), "ETH"),
            (4, 27, Decimal("4600"), "USDT"),
            (6, 9, Decimal("5800"), "USDT"),
        ]
        for hours, minutes, amount, asset in schedule:
            self._receipt(
                customer,
                at=day + timedelta(hours=hours, minutes=minutes),
                cad_value=amount,
                asset=asset,
                beneficiary=beneficiary,
                scenario="demo_maple",
                sender_first_seen=day - timedelta(days=2),
            )

        # Rapid onward movement to a newly observed external wallet.
        self._disposition(
            customer,
            at=day + timedelta(hours=6, minutes=41),
            cad_value=Decimal("10100"),
            asset="USDT",
            scenario="demo_maple",
            receiver_risk=88,
            receiver_tags=["high_risk_exchange"],
        )

        # A second, unrelated customer paying the same beneficiary.
        other = self._make_customer(9002, entity=False)
        self._receipt(
            other,
            at=day + timedelta(hours=5),
            cad_value=Decimal("3400"),
            asset="USDT",
            beneficiary=beneficiary,
            scenario="demo_maple",
        )

        self.expectations.append(
            Expectation(
                "demo_maple",
                customer["customer_id"],
                lvctr_expected=True,
                alert_expected=True,
                indicators_expected=[
                    "AML-VC-012",
                    "AML-VC-004",
                    "AML-VC-015",
                    "AML-VC-003",
                    "AML-VC-010",
                    "AML-VC-008",
                ],
                note=(
                    "CAD 21,600 received in one day from six wallets against a declared CAD 20,000 monthly "
                    "expectation, with rapid onward movement and a beneficiary shared with another customer."
                ),
            )
        )
        return customer

    # -- driver ----------------------------------------------------------

    def generate(self) -> Dataset:
        for index in range(1, self.customer_count + 1):
            self._make_customer(index, entity=(index % 7 == 0))

        for customer in self.customers:
            self._background(customer)

        pool = [c for c in self.customers if c["customer_id"] != "cust_9001"]
        picks = self.rng.sample(pool, k=min(len(pool), 16))

        def day_within(offset_from_end: int) -> datetime:
            return (self.end - timedelta(days=offset_from_end)).replace(minute=0, second=0, microsecond=0)

        beneficiary = self._make_party(1, "BENEFICIARY", entity=True)
        third_party = self._make_party(2, "THIRD_PARTY")
        sanctioned_party = self._make_party(3, "BENEFICIARY", country=self.rng.choice(["IR", "KP", "SY"]))

        self._scenario_single_threshold(picks[0], day_within(3))
        self._scenario_aggregation_24h(picks[1], day_within(4))
        self._scenario_aggregation_beneficiary(picks[2:5], day_within(5), beneficiary)
        self._scenario_third_party(picks[5], day_within(6), third_party)
        self._scenario_near_threshold(picks[6], day_within(7))
        self._scenario_fan_in(picks[7], day_within(8))
        self._scenario_pass_through(picks[8], day_within(9))
        self._scenario_circular(picks[9], day_within(10))
        self._scenario_high_risk_counterparty(picks[10], day_within(11))
        self._scenario_dormant_spike(picks[11], day_within(2))
        self._scenario_chain_hopping(picks[12], day_within(12))
        self._scenario_shared_wallet(picks[13:16], day_within(13))
        self._scenario_new_addresses(picks[0], day_within(14))
        self._scenario_high_risk_jurisdiction(picks[1], day_within(15), sanctioned_party)

        self._demo_case(day_within(1))
        self._scenario_lctr_single(day_within(2))
        self._scenario_cash_structuring(day_within(3))
        self._scenario_eftr(day_within(4))
        self._scenario_rapid_rails(day_within(2))
        self._scenario_smurf_ring(day_within(3))
        self._scenario_sanctions(day_within(6))
        self._scenario_pep(day_within(7))
        self._scenario_terrorist_property(day_within(5))
        self._scenario_travel_gap(day_within(4))
        self._scenario_trade(day_within(8))
        self._scenario_msb(day_within(3))
        self._scenario_casino(day_within(2))

        self.transactions.sort(key=lambda t: t["timestamp"])
        return Dataset(
            customers=self.customers,
            parties=self.parties,
            transactions=self.transactions,
            expectations=self.expectations,
        )


def generate(**kwargs) -> Dataset:
    return SyntheticGenerator(**kwargs).generate()


if __name__ == "__main__":  # pragma: no cover - manual inspection
    import json

    dataset = generate()
    print(json.dumps(dataset.summary(), indent=2))
    print(f"reference prices configured for: {', '.join(sorted(ANCHOR_PRICES_CAD))}")
