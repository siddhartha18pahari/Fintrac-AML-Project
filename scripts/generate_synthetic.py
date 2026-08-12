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

    def _make_party(self, index: int, kind: str, *, entity: bool = False, country: str = "CA") -> dict:
        if entity:
            head, tail = self.rng.choice(BUSINESS_WORDS)
            name = f"{head} {tail} Inc."
        else:
            name = f"{self.rng.choice(GIVEN_NAMES)} {self.rng.choice(SURNAMES)}"
        party = {
            "party_id": f"{'ben' if kind == 'BENEFICIARY' else 'tp'}_{index:04d}",
            "kind": kind,
            "name": name,
            "party_type": "ENTITY" if entity else "PERSON",
            "country": country,
            "kyc": (
                {"legal_name": name, "client_number": f"CN{index:06d}"}
                if entity
                else {
                    "surname": name.split()[-1],
                    "given_name": name.split()[0],
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
