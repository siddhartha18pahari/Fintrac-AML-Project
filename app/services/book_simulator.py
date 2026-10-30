"""Synthetic transaction book for the investigator simulator.

Amounts, clocks and corridors are invented. Planted typologies are labelled
indicators so an analyst can see which rule would fire. They are not a method
for moving money.
"""

from __future__ import annotations

import math
import random
from collections import defaultdict
from datetime import datetime, timedelta

BASE_RATES = {
    "CAD": 1.0,
    "BTC": 118400.0,
    "ETH": 4280.0,
    "USDT": 1.37,
    "SOL": 186.0,
    "LTC": 112.0,
}
VC_ASSETS = ("BTC", "ETH", "USDT", "SOL", "LTC")
VC_WEIGHTS = (0.34, 0.22, 0.24, 0.12, 0.08)

PERSONAS = (
    {"name": "Maya Singh", "persona": "salaried", "city": "Toronto", "province": "ON", "activity": 1.15, "cash": 0.05},
    {"name": "Owen Blake", "persona": "salaried", "city": "Ottawa", "province": "ON", "activity": 0.8, "cash": 0.04},
    {"name": "Hana Park", "persona": "student", "city": "Montreal", "province": "QC", "activity": 0.45, "cash": 0.08},
    {"name": "Louis Bergeron", "persona": "retiree", "city": "Quebec City", "province": "QC", "activity": 0.35, "cash": 0.12},
    {"name": "Priya Nair", "persona": "small_business", "city": "Mississauga", "province": "ON", "activity": 1.55, "cash": 0.2},
    {"name": "Noah Campbell", "persona": "small_business", "city": "Calgary", "province": "AB", "activity": 1.25, "cash": 0.1},
    {"name": "Amira Haddad", "persona": "importer", "city": "Vancouver", "province": "BC", "activity": 0.7, "cash": 0.04},
    {"name": "Evan Cho", "persona": "crypto_native", "city": "Vancouver", "province": "BC", "activity": 1.7, "cash": 0.02},
    {"name": "Sofia Rossi", "persona": "crypto_native", "city": "Toronto", "province": "ON", "activity": 1.35, "cash": 0.03},
    {"name": "Jonah Adeyemi", "persona": "msb_agent", "city": "Winnipeg", "province": "MB", "activity": 1.4, "cash": 0.34},
    {"name": "Claire Beaulieu", "persona": "salaried", "city": "Halifax", "province": "NS", "activity": 0.9, "cash": 0.06},
    {"name": "Mateo Alvarez", "persona": "mule", "city": "Edmonton", "province": "AB", "activity": 0.4, "cash": 0.12},
    {"name": "Ravi Desai", "persona": "salaried", "city": "Brampton", "province": "ON", "activity": 1.0, "cash": 0.05},
    {"name": "Elise Moreau", "persona": "small_business", "city": "Laval", "province": "QC", "activity": 1.1, "cash": 0.16},
    {"name": "Hassan Karim", "persona": "importer", "city": "Toronto", "province": "ON", "activity": 0.6, "cash": 0.05},
    {"name": "Nina Volkova", "persona": "crypto_native", "city": "Calgary", "province": "AB", "activity": 1.2, "cash": 0.02},
    {"name": "Patrick Leung", "persona": "salaried", "city": "Richmond", "province": "BC", "activity": 0.95, "cash": 0.04},
    {"name": "Aisha Rahman", "persona": "student", "city": "Waterloo", "province": "ON", "activity": 0.4, "cash": 0.07},
    {"name": "Hugo Tremblay", "persona": "retiree", "city": "Sherbrooke", "province": "QC", "activity": 0.3, "cash": 0.1},
    {"name": "Imani Brooks", "persona": "msb_agent", "city": "Hamilton", "province": "ON", "activity": 1.3, "cash": 0.28},
    {"name": "Leo Martel", "persona": "mule", "city": "Surrey", "province": "BC", "activity": 0.35, "cash": 0.1},
    {"name": "Chloe Nguyen", "persona": "small_business", "city": "Ottawa", "province": "ON", "activity": 1.05, "cash": 0.14},
    {"name": "Samir Haddad", "persona": "salaried", "city": "London", "province": "ON", "activity": 0.85, "cash": 0.05},
    {"name": "Freya Olsen", "persona": "crypto_native", "city": "Victoria", "province": "BC", "activity": 1.1, "cash": 0.02},
)

DEFAULTS = {
    "seed": 7,
    "days": 21,
    "customers": 12,
    "mu": 6.2,
    "sigma": 0.85,
    "seasonality": 0.35,
    "night_share": 0.12,
    "fx_vol": 0.02,
    "structuring": True,
    "layering": True,
    "mules": True,
    "trade": True,
    "offramp": True,
    "round_trip": True,
    "payroll": True,
    "rent": True,
}


def _controls(raw: dict | None) -> dict:
    merged = dict(DEFAULTS)
    if raw:
        merged.update({key: raw[key] for key in raw if key in DEFAULTS})
    merged["seed"] = int(merged["seed"])
    merged["days"] = max(7, min(45, int(merged["days"])))
    merged["customers"] = max(6, min(24, int(merged["customers"])))
    merged["mu"] = float(merged["mu"])
    merged["sigma"] = float(merged["sigma"])
    merged["seasonality"] = float(merged["seasonality"])
    merged["night_share"] = float(merged["night_share"])
    merged["fx_vol"] = float(merged["fx_vol"])
    for flag in ("structuring", "layering", "mules", "trade", "offramp", "round_trip", "payroll", "rent"):
        merged[flag] = bool(merged[flag])
    return merged


def _poisson(rng: random.Random, lam: float) -> int:
    if lam <= 0:
        return 0
    limit = math.exp(-lam)
    count = 0
    product = 1.0
    while product > limit and count < 12:
        count += 1
        product *= rng.random()
    return max(0, count - 1)


def _hour(rng: random.Random, night_share: float, suspicious: bool) -> int:
    weights = []
    for hour in range(24):
        if 9 <= hour <= 16:
            weight = 5.0
        elif 7 <= hour <= 19:
            weight = 2.0
        else:
            weight = 0.35
        if suspicious and hour < 6:
            weight += 6.0 * night_share
        if not suspicious and hour < 6:
            weight *= max(0.15, 1 - min(0.85, night_share))
        weights.append(weight)
    total = sum(weights)
    roll = rng.random() * total
    cursor = 0.0
    for hour, weight in enumerate(weights):
        cursor += weight
        if roll <= cursor:
            return hour
    return 12


def _season(day: datetime, seasonality: float) -> float:
    weekend = 0.58 if day.weekday() >= 5 else 1.0
    month_end = 1.0 + seasonality if day.day >= 28 else 1.0
    wave = 1.0 + seasonality * 0.22 * math.sin(2 * math.pi * (day.toordinal() % 30) / 30)
    return weekend * month_end * wave


def _rates(rng: random.Random, fx_vol: float) -> dict[str, float]:
    rates = {}
    for asset, base in BASE_RATES.items():
        if asset == "CAD":
            rates[asset] = 1.0
            continue
        shock = fx_vol * (0.15 if asset == "USDT" else 1.0)
        rates[asset] = max(0.01, base * (1 + rng.gauss(0, shock)))
    return rates


def _pick_asset(rng: random.Random) -> str:
    roll = rng.random()
    cursor = 0.0
    for asset, weight in zip(VC_ASSETS, VC_WEIGHTS):
        cursor += weight
        if roll <= cursor:
            return asset
    return "BTC"


def _channel(rng: random.Random, person: dict) -> str:
    roll = rng.random()
    cash = float(person["cash"])
    if roll < cash:
        return "CASH"
    if roll < cash + 0.2:
        return "EFT"
    if roll < cash + 0.38:
        return "E_TRANSFER"
    return "VIRTUAL_CURRENCY"


class _Book:
    def __init__(self, controls: dict):
        self.controls = controls
        self.rng = random.Random(controls["seed"])
        self.people = list(PERSONAS[: controls["customers"]])
        self.rows: list[dict] = []
        self._serial = 0
        self.anchor = datetime(2026, 3, 2, 0, 0, 0)
        self._daily_rates: dict[str, dict[str, float]] = {}

    def rates(self, day: datetime) -> dict[str, float]:
        key = day.date().isoformat()
        if key not in self._daily_rates:
            self._daily_rates[key] = _rates(self.rng, self.controls["fx_vol"])
        return self._daily_rates[key]

    def add(self, **row) -> dict:
        self._serial += 1
        cad = round(float(row["cad"]), 2)
        channel = row["channel"]
        if channel == "VIRTUAL_CURRENCY":
            asset = row.get("asset") or _pick_asset(self.rng)
            rate = float(row.get("fx_rate") or self.rates(row["at"])[asset])
            amount_asset = cad / rate
        else:
            asset = "CAD"
            rate = 1.0
            amount_asset = cad
        record = {
            "id": f"sim-{self.controls['seed']}-{self._serial:04d}",
            "at": row["at"].strftime("%Y-%m-%dT%H:%M:%S"),
            "customer": row["customer"],
            "persona": row["persona"],
            "city": row["city"],
            "province": row["province"],
            "country": "CA",
            "counterparty_country": row.get("counterparty_country", "CA"),
            "direction": row["direction"],
            "channel": channel,
            "asset": asset,
            "amount_asset": round(amount_asset, 8),
            "fx_rate": round(rate, 4),
            "cad": cad,
            "typology": row.get("typology", "retail"),
            "purpose": row.get("purpose", "Retail activity"),
            "beneficiary": row.get("beneficiary", ""),
            "flow_id": row.get("flow_id", ""),
        }
        self.rows.append(record)
        return record

    def person(self, persona: str, fallback: int = 0) -> dict:
        for person in self.people:
            if person["persona"] == persona:
                return person
        return self.people[fallback % len(self.people)]

    def stamp(self, day: datetime, hour: int, minute: int) -> datetime:
        return day.replace(hour=hour, minute=minute, second=0)


def _retail(book: _Book) -> None:
    controls = book.controls
    for offset in range(controls["days"]):
        day = book.anchor + timedelta(days=offset)
        scale = _season(day, controls["seasonality"])
        for person in book.people:
            lam = person["activity"] * scale * 0.85
            for _ in range(_poisson(book.rng, lam)):
                suspicious = False
                hour = _hour(book.rng, controls["night_share"], suspicious)
                minute = book.rng.randrange(0, 60)
                cad = min(80000.0, math.exp(book.rng.gauss(controls["mu"], controls["sigma"])))
                channel = _channel(book.rng, person)
                direction = "IN" if book.rng.random() < 0.68 else "OUT"
                abroad = book.rng.random()
                country = "CA"
                if abroad < 0.08:
                    country = "US"
                elif abroad < 0.11:
                    country = "GB"
                book.add(
                    at=book.stamp(day, hour, minute),
                    customer=person["name"],
                    persona=person["persona"],
                    city=person["city"],
                    province=person["province"],
                    counterparty_country=country,
                    direction=direction,
                    channel=channel,
                    cad=cad,
                    typology="retail",
                    purpose="Everyday activity",
                )


def _payroll_and_rent(book: _Book) -> None:
    controls = book.controls
    for offset in range(controls["days"]):
        day = book.anchor + timedelta(days=offset)
        if controls["payroll"] and day.weekday() == 3 and (offset // 7) % 2 == 0:
            for person in book.people:
                if person["persona"] not in {"salaried", "student"}:
                    continue
                amount = round(book.rng.gauss(3600 if person["persona"] == "salaried" else 980, 180), 2)
                amount = min(6200, max(720, amount))
                book.add(
                    at=book.stamp(day, 9, 10 + book.rng.randrange(0, 20)),
                    customer=person["name"],
                    persona=person["persona"],
                    city=person["city"],
                    province=person["province"],
                    direction="IN",
                    channel="EFT",
                    cad=amount,
                    typology="payroll",
                    purpose="Payroll deposit",
                    beneficiary="Employer payroll",
                )
        if controls["rent"] and day.day in {1, 2}:
            for person in book.people:
                if person["persona"] in {"msb_agent", "mule"}:
                    continue
                amount = round(max(900, book.rng.gauss(1850, 220)), 2)
                book.add(
                    at=book.stamp(day, 8, 5 + book.rng.randrange(0, 25)),
                    customer=person["name"],
                    persona=person["persona"],
                    city=person["city"],
                    province=person["province"],
                    direction="OUT",
                    channel="EFT",
                    cad=amount,
                    typology="rent",
                    purpose="Rent",
                    beneficiary="Landlord",
                )


def _plant(book: _Book) -> None:
    controls = book.controls
    day = book.anchor + timedelta(days=min(4, controls["days"] - 1))
    if controls["structuring"]:
        subject = book.person("msb_agent")
        for index, amount in enumerate((8200, 7600, 9100, 6400)):
            stamp = day + timedelta(hours=10 * index)
            book.add(
                at=stamp,
                customer=subject["name"],
                persona=subject["persona"],
                city=subject["city"],
                province=subject["province"],
                direction="IN",
                channel="CASH",
                cad=amount,
                typology="structuring",
                purpose="Cash purchase of virtual currency",
                beneficiary="Harbour Counter",
            )
        ring_day = day + timedelta(days=1)
        beneficiaries = "North Wharf MSB"
        for index, persona in enumerate(("small_business", "student", "retiree")):
            person = book.person(persona, index)
            book.add(
                at=ring_day.replace(hour=11 + index, minute=15),
                customer=person["name"],
                persona=person["persona"],
                city=person["city"],
                province=person["province"],
                direction="IN",
                channel="CASH",
                cad=(4200, 3800, 4600)[index],
                typology="structuring",
                purpose="Cash under the large-cash line",
                beneficiary=beneficiaries,
            )
    if controls["layering"]:
        subject = book.person("crypto_native")
        start = (book.anchor + timedelta(days=min(8, controls["days"] - 1))).replace(hour=1, minute=20)
        for index, amount in enumerate((18400, 17120, 16340, 15110)):
            book.add(
                at=start + timedelta(minutes=40 * index),
                customer=subject["name"],
                persona=subject["persona"],
                city=subject["city"],
                province=subject["province"],
                direction="OUT",
                channel="VIRTUAL_CURRENCY",
                asset="BTC",
                cad=amount,
                typology="layering",
                purpose="Successive wallet hop",
                flow_id="layer-1",
                counterparty_country="CA",
            )
    if controls["mules"]:
        mule = book.person("mule")
        start = (book.anchor + timedelta(days=min(6, controls["days"] - 1))).replace(hour=22, minute=5)
        senders = [book.person("student", 1), book.person("retiree", 2), book.person("salaried", 3), book.person("small_business", 1)]
        for index, sender in enumerate(senders):
            amount = (2100, 1800, 2400, 1950)[index]
            book.add(
                at=start + timedelta(minutes=25 * index),
                customer=mule["name"],
                persona=mule["persona"],
                city=mule["city"],
                province=mule["province"],
                direction="IN",
                channel="E_TRANSFER",
                cad=amount,
                typology="mule",
                purpose=f"Incoming from {sender['name']}",
                flow_id="mule-1",
                beneficiary=sender["name"],
            )
        for index, amount in enumerate((2600, 2400, 2200)):
            book.add(
                at=start + timedelta(hours=3, minutes=15 * index),
                customer=mule["name"],
                persona=mule["persona"],
                city=mule["city"],
                province=mule["province"],
                direction="OUT",
                channel="VIRTUAL_CURRENCY",
                asset="USDT",
                cad=amount,
                typology="mule",
                purpose="Fan-out to external wallets",
                flow_id="mule-1",
            )
    if controls["trade"]:
        importer = book.person("importer")
        start = (book.anchor + timedelta(days=min(10, controls["days"] - 1))).replace(hour=14, minute=0)
        for index, amount in enumerate((48000, 125000)):
            book.add(
                at=start + timedelta(days=index),
                customer=importer["name"],
                persona=importer["persona"],
                city=importer["city"],
                province=importer["province"],
                direction="OUT",
                channel="EFT",
                cad=amount,
                typology="trade",
                purpose="Commercial invoice — electronics",
                counterparty_country="HK",
                beneficiary="Harbour Trading Ltd",
                flow_id="trade-1",
            )
    if controls["offramp"]:
        subject = book.person("crypto_native", 1)
        start = (book.anchor + timedelta(days=min(12, controls["days"] - 1))).replace(hour=3, minute=40)
        book.add(
            at=start,
            customer=subject["name"],
            persona=subject["persona"],
            city=subject["city"],
            province=subject["province"],
            direction="IN",
            channel="VIRTUAL_CURRENCY",
            asset="USDT",
            cad=22000,
            typology="crypto_offramp",
            purpose="Stablecoin receipt",
            flow_id="offramp-1",
        )
        book.add(
            at=start + timedelta(hours=2),
            customer=subject["name"],
            persona=subject["persona"],
            city=subject["city"],
            province=subject["province"],
            direction="OUT",
            channel="EFT",
            cad=20500,
            typology="crypto_offramp",
            purpose="Fiat withdrawal after virtual-currency receipt",
            flow_id="offramp-1",
        )
    if controls["round_trip"]:
        trio = [book.people[index % len(book.people)] for index in (0, 4, 7)]
        start = (book.anchor + timedelta(days=min(3, controls["days"] - 1))).replace(hour=16, minute=10)
        hops = ((trio[0], trio[1], 6400), (trio[1], trio[2], 6100), (trio[2], trio[0], 5950))
        for index, (sender, receiver, amount) in enumerate(hops):
            book.add(
                at=start + timedelta(hours=8 * index),
                customer=sender["name"],
                persona=sender["persona"],
                city=sender["city"],
                province=sender["province"],
                direction="OUT",
                channel="VIRTUAL_CURRENCY",
                asset="ETH",
                cad=amount,
                typology="round_trip",
                purpose=f"Transfer toward {receiver['name']}",
                beneficiary=receiver["name"],
                flow_id="round-1",
            )


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", ""))


def _groups(rows: list[dict], hours: int):
    ordered = sorted(rows, key=lambda row: row["at"])
    for index, start in enumerate(ordered):
        start_at = _parse(start["at"])
        window = []
        for row in ordered[index:]:
            if (_parse(row["at"]) - start_at).total_seconds() <= hours * 3600:
                window.append(row)
            else:
                break
        yield window


def _hit(rule_id: str, title: str, customer: str, detail: str, rows: list[dict]) -> dict:
    return {
        "rule_id": rule_id,
        "title": title,
        "customer": customer,
        "detail": detail,
        "cad": round(sum(row["cad"] for row in rows), 2),
        "txn_ids": [row["id"] for row in rows],
    }


def evaluate(transactions: list[dict]) -> list[dict]:
    hits: list[dict] = []
    by_customer: dict[str, list[dict]] = defaultdict(list)
    for row in transactions:
        by_customer[row["customer"]].append(row)

    for customer, rows in by_customer.items():
        cash_in = [row for row in rows if row["channel"] == "CASH" and row["direction"] == "IN"]
        singles = [row for row in cash_in if row["cad"] >= 10000]
        if singles:
            hits.append(_hit("AML-FI-001", "Large cash receipt", customer, "A cash receipt is at or above CAD 10,000.", singles[:1]))
        else:
            for window in _groups(cash_in, 24):
                total = sum(row["cad"] for row in window)
                if total >= 10000:
                    hits.append(_hit("AML-FI-001", "Large cash receipts in 24 hours", customer, "Cash receipts aggregate to CAD 10,000 in 24 hours.", window))
                    break
        for window in _groups([row for row in cash_in if 2000 <= row["cad"] < 10000], 48):
            total = sum(row["cad"] for row in window)
            if len(window) >= 3 and total >= 10000:
                hits.append(
                    _hit(
                        "AML-FI-003",
                        "Cash structured under CAD 10,000",
                        customer,
                        f"{len(window)} cash receipts sit in [CAD 2,000, 10,000) and total CAD {total:,.2f} within 48 hours.",
                        window,
                    )
                )
                break
        international = [row for row in rows if row["channel"] == "EFT" and row["counterparty_country"] not in {"", "CA"}]
        for direction in ("IN", "OUT"):
            subset = [row for row in international if row["direction"] == direction]
            if any(row["cad"] >= 10000 for row in subset):
                chosen = [row for row in subset if row["cad"] >= 10000][:1]
                hits.append(_hit("AML-FI-002", "International EFT at the reporting line", customer, "An international EFT is at or above CAD 10,000.", chosen))
                continue
            for window in _groups(subset, 24):
                total = sum(row["cad"] for row in window)
                if total >= 10000:
                    hits.append(_hit("AML-FI-002", "International EFTs in 24 hours", customer, "International EFTs in one direction aggregate to CAD 10,000.", window))
                    break
        for inflow in rows:
            if inflow["direction"] != "IN" or inflow["cad"] < 5000:
                continue
            start = _parse(inflow["at"])
            other = [
                row
                for row in rows
                if row["direction"] == "OUT"
                and row["channel"] != inflow["channel"]
                and 0 <= (_parse(row["at"]) - start).total_seconds() <= 6 * 3600
            ]
            moved = sum(row["cad"] for row in other)
            if moved >= 0.7 * inflow["cad"]:
                hits.append(
                    _hit(
                        "AML-FI-004",
                        "Value left on a different rail within 6 hours",
                        customer,
                        f"CAD {inflow['cad']:,.2f} came in on {inflow['channel']} and CAD {moved:,.2f} left on another rail.",
                        [inflow, *other],
                    )
                )
                break

    by_beneficiary: dict[str, list[dict]] = defaultdict(list)
    for row in transactions:
        if row["channel"] == "CASH" and row["direction"] == "IN" and row["cad"] < 10000 and row.get("beneficiary"):
            by_beneficiary[row["beneficiary"]].append(row)
    for beneficiary, rows in by_beneficiary.items():
        for window in _groups(rows, 24):
            customers = {row["customer"] for row in window}
            total = sum(row["cad"] for row in window)
            if len(customers) >= 3 and total >= 10000:
                hits.append(
                    _hit(
                        "AML-FI-005",
                        "Several customers placed sub-threshold cash",
                        beneficiary,
                        f"{len(customers)} customers placed cash under CAD 10,000 with one beneficiary, totalling CAD {total:,.2f}.",
                        window,
                    )
                )
                break

    flows: dict[str, list[dict]] = defaultdict(list)
    for row in transactions:
        if row.get("flow_id"):
            flows[row["flow_id"]].append(row)
    for flow_id, rows in flows.items():
        ordered = sorted(rows, key=lambda row: row["at"])
        kind = ordered[0]["typology"]
        customer = ordered[0]["customer"]
        if kind == "layering" and len(ordered) >= 3:
            hits.append(_hit("TYPOLOGY-LAYERING", "Layering chain", customer, f"{len(ordered)} virtual-currency hops in a short window.", ordered))
        elif kind == "mule":
            inbound = [row for row in ordered if row["direction"] == "IN"]
            outbound = [row for row in ordered if row["direction"] == "OUT"]
            if len(inbound) >= 3 and len(outbound) >= 2:
                hits.append(_hit("TYPOLOGY-MULE", "Mule fan-in then fan-out", customer, f"{len(inbound)} receipts then {len(outbound)} disbursements.", ordered))
        elif kind == "trade":
            hits.append(_hit("TYPOLOGY-TBML", "Trade invoice pattern", customer, "Round commercial-invoice wires to a trading counterparty.", ordered))
        elif kind == "crypto_offramp":
            hits.append(_hit("TYPOLOGY-OFFRAMP", "Virtual currency to fiat off-ramp", customer, "Stablecoin in, fiat out inside a few hours.", ordered))
        elif kind == "round_trip" and len({row["customer"] for row in ordered}) >= 3:
            hits.append(_hit("TYPOLOGY-ROUNDTRIP", "Round-trip across customers", ordered[-1]["beneficiary"] or customer, "Value circles back at nearly the same amount.", ordered))
        _ = flow_id
    hits.sort(key=lambda item: (item["rule_id"], item["customer"]))
    return hits


def simulate(raw: dict | None = None) -> dict:
    controls = _controls(raw)
    book = _Book(controls)
    _retail(book)
    _payroll_and_rent(book)
    _plant(book)
    book.rows.sort(key=lambda row: (row["at"], row["id"]))
    hits = evaluate(book.rows)
    by_channel: dict[str, int] = defaultdict(int)
    by_hour = [0] * 24
    by_typology: dict[str, int] = defaultdict(int)
    by_province: dict[str, int] = defaultdict(int)
    total = 0.0
    for row in book.rows:
        by_channel[row["channel"]] += 1
        by_hour[int(row["at"][11:13])] += 1
        by_typology[row["typology"]] += 1
        by_province[row["province"]] += 1
        total += row["cad"]
    return {
        "disclaimer": "Synthetic book. Rule hits are indicators for the demo. They do not find that anyone laundered money.",
        "controls": controls,
        "summary": {
            "transactions": len(book.rows),
            "customers": len(book.people),
            "cad_total": round(total, 2),
            "hit_count": len(hits),
            "by_channel": dict(by_channel),
            "by_hour": by_hour,
            "by_typology": dict(by_typology),
            "by_province": dict(by_province),
            "window_start": book.anchor.date().isoformat(),
        },
        "customers": book.people,
        "hits": hits,
        "transactions": book.rows,
    }
