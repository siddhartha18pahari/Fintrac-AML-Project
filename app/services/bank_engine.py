"""Agent-based synthetic Canadian bank.

Planted labels are indicators for detection practice. They are not a method
for moving value. Draw order matches web/src/lib/bank-sim/engine.ts.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .rng_parity import Rng, quantize

CATALOG_PATH = Path(__file__).resolve().parents[2] / "web" / "src" / "lib" / "bank-sim" / "catalog.json"
CATALOG = json.loads(CATALOG_PATH.read_text())
HOLIDAYS = set(CATALOG["holidays"])
CITY = CATALOG["city"]
PERSONAS = CATALOG["personas"]
MERCHANTS = CATALOG["merchants"]
CORRESPONDENTS = CATALOG["correspondents"]
EXCHANGES = CATALOG["exchanges"]
BASE_RATES = CATALOG["baseRates"]
VC_ASSETS = CATALOG["vcAssets"]
VC_WEIGHTS = CATALOG["vcWeights"]
MIX = CATALOG["mix"]
BENIGN = {"retail", "payroll", "rent", "bill", "lookalike"}
ANCHOR = datetime(2026, 2, 2, tzinfo=timezone.utc)
ANCHOR_ISO = "2026-02-02"

DISCLAIMER = (
    "Synthetic book for a Canadian bank. Planted labels are indicators so a rule can be scored "
    "against a known script. They do not find that anyone laundered money, and they are not a way to move value."
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
    "intensity": 0.55,
    "camouflage": 0.0,
    "focus_city": "",
    "structuring": True,
    "layering": True,
    "mules": True,
    "trade": True,
    "offramp": True,
    "round_trip": True,
    "funnel": False,
    "rapid": False,
    "professional": False,
    "payroll": True,
    "rent": True,
    "preset": "",
}

AMOUNT = {
    "CARD": (8, 0.08, 650),
    "ATM": (20, 0.05, 400),
    "CASH": (40, 0.12, 900),
    "E_TRANSFER": (20, 0.35, 3000),
    "EFT": (50, 0.9, 7500),
    "WIRE": (200, 1.1, 9000),
    "VIRTUAL_CURRENCY": (30, 0.7, 6000),
}
METHOD = {
    "CARD": "Card",
    "ATM": "ATM",
    "CASH": "In person",
    "E_TRANSFER": "Online",
    "EFT": "Online",
    "WIRE": "Wire",
    "VIRTUAL_CURRENCY": "Online",
}

PRESETS = {
    "toronto-fentanyl": {
        "seed": 19, "days": 28, "customers": 18, "intensity": 0.85, "camouflage": 0.4, "night_share": 0.28,
        "focus_city": "Toronto", "structuring": True, "mules": True, "professional": True, "funnel": True,
        "rapid": True, "offramp": True, "layering": False, "trade": False, "round_trip": False, "payroll": True, "rent": True,
    },
    "tbml": {
        "seed": 23, "days": 30, "customers": 16, "intensity": 0.7, "camouflage": 0.55, "fx_vol": 0.04,
        "focus_city": "Vancouver", "trade": True, "layering": True, "structuring": False, "mules": False,
        "offramp": False, "round_trip": False, "funnel": False, "rapid": False, "professional": False, "payroll": True, "rent": True,
    },
    "romance": {
        "seed": 31, "days": 24, "customers": 16, "intensity": 0.75, "camouflage": 0.3, "night_share": 0.22,
        "focus_city": "Calgary", "mules": True, "offramp": True, "rapid": True, "funnel": True, "structuring": False,
        "layering": False, "trade": False, "round_trip": False, "professional": False, "payroll": True, "rent": True,
    },
    "quiet": {
        "seed": 5, "days": 21, "customers": 14, "intensity": 0, "camouflage": 0.15, "focus_city": "",
        "structuring": False, "layering": False, "mules": False, "trade": False, "offramp": False, "round_trip": False,
        "funnel": False, "rapid": False, "professional": False, "payroll": True, "rent": True,
    },
    "full": {
        "seed": 7, "days": 21, "customers": 18, "intensity": 0.6, "camouflage": 0.45, "focus_city": "",
        "structuring": True, "layering": True, "mules": True, "trade": True, "offramp": True, "round_trip": True,
        "funnel": True, "rapid": True, "professional": True, "payroll": True, "rent": True,
    },
}


def rh(value: float, places: int) -> float:
    factor = 10 ** places
    return math.floor(value * factor + 0.5) / factor


def _num(value, fallback: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    if math.isnan(parsed) or math.isinf(parsed):
        return fallback
    return parsed


def _flag(value, fallback: bool) -> bool:
    if isinstance(value, bool):
        return value
    return fallback


def controls_from(raw: dict | None) -> dict:
    merged = dict(DEFAULTS)
    raw = raw or {}
    preset = str(raw.get("preset") or "")
    if preset in PRESETS:
        merged.update(PRESETS[preset])
        merged["preset"] = preset
    alias = {
        "night_share": raw.get("nightShare", raw.get("night_share")),
        "fx_vol": raw.get("fxVol", raw.get("fx_vol")),
        "round_trip": raw.get("roundTrip", raw.get("round_trip")),
        "focus_city": raw.get("focusCity", raw.get("focus_city")),
    }
    for key in DEFAULTS:
        if key in ("night_share", "fx_vol", "round_trip", "focus_city"):
            continue
        if key in raw and raw[key] is not None:
            merged[key] = raw[key]
    for key, value in alias.items():
        if value is not None:
            merged[key] = value
    if "preset" in raw and raw.get("preset") is not None:
        merged["preset"] = str(raw.get("preset") or "")
    merged["seed"] = max(1, min(999999, int(_num(merged["seed"], 7))))
    merged["days"] = max(7, min(60, int(_num(merged["days"], 21))))
    merged["customers"] = max(6, min(48, int(_num(merged["customers"], 12))))
    merged["mu"] = max(4.0, min(9.0, _num(merged["mu"], 6.2)))
    merged["sigma"] = max(0.2, min(1.6, _num(merged["sigma"], 0.85)))
    merged["seasonality"] = max(0.0, min(1.0, _num(merged["seasonality"], 0.35)))
    merged["night_share"] = max(0.0, min(0.6, _num(merged["night_share"], 0.12)))
    merged["fx_vol"] = max(0.0, min(0.15, _num(merged["fx_vol"], 0.02)))
    merged["intensity"] = max(0.0, min(1.0, _num(merged["intensity"], 0.55)))
    merged["camouflage"] = max(0.0, min(1.0, _num(merged["camouflage"], 0)))
    merged["focus_city"] = str(merged.get("focus_city") or "")
    for key in ("structuring", "layering", "mules", "trade", "offramp", "round_trip", "funnel", "rapid", "professional", "payroll", "rent"):
        merged[key] = _flag(merged[key], bool(DEFAULTS[key]))
    return merged


def _iso(day: datetime) -> str:
    return day.strftime("%Y-%m-%d")


def _stamp(day: datetime) -> str:
    return day.strftime("%Y-%m-%dT%H:%M:%S")


def _parse(value: str) -> datetime:
    return datetime.strptime(value[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)


def _clock(day: datetime, hour: int, minute: int) -> datetime:
    base = day.replace(hour=0, minute=0, second=0, microsecond=0)
    return base + timedelta(hours=hour, minutes=minute)


def _season(day: datetime, seasonality: float) -> float:
    weekend = 0.58 if day.weekday() >= 5 else 1
    holiday = 0.32 if _iso(day) in HOLIDAYS else 1
    month_end = quantize(1 + seasonality) if day.day >= 28 else 1
    wave = quantize(1 + seasonality * 0.22 * math.sin((2 * math.pi * (day.day % 30)) / 30))
    return quantize(weekend * holiday * month_end * wave)


def _poisson(rand, lam: float) -> int:
    if lam <= 0:
        return 0
    limit = quantize(math.exp(-lam))
    count = 0
    product = 1.0
    while product > limit and count < 12:
        count += 1
        product = quantize(product * rand())
    return max(0, count - 1)


def _hour(rand, night_share: float, suspicious: bool) -> int:
    weights = []
    for hour in range(24):
        if 9 <= hour <= 16:
            weight = 5
        elif 7 <= hour <= 19:
            weight = 2
        else:
            weight = 0.35
        if suspicious and hour < 6:
            weight += 6 * night_share
        if not suspicious and hour < 6:
            weight *= max(0.15, 1 - min(0.85, night_share))
        weights.append(quantize(weight))
    total = quantize(sum(weights))
    cursor = quantize(rand() * total)
    for hour, weight in enumerate(weights):
        cursor = quantize(cursor - weight)
        if cursor <= 0:
            return hour
    return 12


def _rates(rng: Rng, fx_vol: float) -> dict[str, float]:
    rates = {"CAD": 1.0}
    for asset in VC_ASSETS:
        shock = quantize(fx_vol * (0.15 if asset == "USDT" else 1))
        draw = rng.gauss(0, shock)
        rates[asset] = quantize(max(0.01, quantize(BASE_RATES[asset] * (1 + draw))))
    return rates


def _asset(rng: Rng) -> str:
    roll = rng.random() * 100
    for asset, weight in zip(VC_ASSETS, VC_WEIGHTS):
        roll -= weight
        if roll <= 0:
            return asset
    return "BTC"


def _channel(rng: Rng, persona: str) -> str:
    mix = MIX.get(persona) or MIX["salaried"]
    roll = rng.random() * 100
    for channel, weight in mix:
        roll -= weight
        if roll <= 0:
            return channel
    return mix[-1][0]


def _amount(rng: Rng, channel: str, mu: float, sigma: float) -> float:
    raw = quantize(math.exp(rng.gauss(mu, sigma)))
    floor, scale, cap = AMOUNT.get(channel, AMOUNT["EFT"])
    return rh(min(cap, max(floor, raw * scale)), 2)


def _inward(persona: str, channel: str) -> float:
    if channel in ("CARD", "ATM"):
        return 0.08
    if channel == "CASH":
        return 0.72
    if channel == "EFT" and persona in ("salaried", "student", "retiree"):
        return 0.62
    if channel == "WIRE" and persona == "importer":
        return 0.25
    if channel == "VIRTUAL_CURRENCY":
        return 0.55
    return 0.48


def _party(rng: Rng, channel: str, person: dict, people: list[dict]) -> dict:
    roll = rng.random()
    slot = rng.integer(997)
    if channel == "CARD":
        merchant = MERCHANTS[slot % len(MERCHANTS)]
        return {"name": merchant["name"], "country": "CA", "mcc": merchant["mcc"], "bank": "", "city": merchant["city"]}
    if channel == "E_TRANSFER":
        other = people[slot % len(people)]
        return {"name": other["name"], "country": "CA", "mcc": "", "bank": "Interac", "city": other["city"]}
    if channel in ("ATM", "CASH"):
        return {"name": f"{person['city']} branch", "country": "CA", "mcc": "", "bank": "Sentinel Bank", "city": person["city"]}
    if channel == "VIRTUAL_CURRENCY":
        exchange = EXCHANGES[0 if roll < 0.72 else 1 if roll < 0.9 else 2]
        return {"name": exchange["name"], "country": exchange["country"], "mcc": "6051", "bank": exchange["name"], "city": exchange["city"]}
    if channel == "WIRE":
        if roll < 0.62:
            bank = CORRESPONDENTS[slot % len(CORRESPONDENTS)]
            return {"name": bank["name"], "country": bank["country"], "mcc": "", "bank": bank["name"], "city": bank["city"]}
        return {"name": "Sentinel Wire Desk", "country": "CA", "mcc": "", "bank": "Sentinel Bank", "city": "Toronto"}
    if roll < 0.1:
        bank = CORRESPONDENTS[slot % len(CORRESPONDENTS)]
        return {"name": bank["name"], "country": bank["country"], "mcc": "", "bank": bank["name"], "city": bank["city"]}
    return {"name": "Bill payee", "country": "CA", "mcc": "4814", "bank": "Sentinel Bank", "city": person["city"]}


def _purpose(channel: str, direction: str) -> str:
    if channel == "CARD":
        return "Card purchase"
    if channel == "ATM":
        return "ATM withdrawal"
    if channel == "CASH":
        return "Cash deposit" if direction == "IN" else "Cash withdrawal"
    if channel == "E_TRANSFER":
        return "Interac e-Transfer"
    if channel == "WIRE":
        return "Wire transfer"
    if channel == "VIRTUAL_CURRENCY":
        return "Virtual currency exchange"
    return "Electronic transfer"


def _disposition(channel: str, direction: str) -> str:
    if channel == "CARD":
        return "purchase"
    if channel == "ATM":
        return "withdrawal"
    if channel == "VIRTUAL_CURRENCY":
        return "exchange"
    if direction == "IN":
        return "deposit"
    return "transfer"


def _find(people: list[dict], persona: str, nth: int = 0) -> dict:
    matches = [item for item in people if item["persona"] == persona]
    if not matches:
        return people[nth % len(people)]
    return matches[nth % len(matches)]


def _prefer(people: list[dict], persona: str, city: str, nth: int = 0) -> dict:
    if city:
        local = [item for item in people if item["persona"] == persona and item["city"] == city]
        if local:
            return local[nth % len(local)]
        any_local = [item for item in people if item["city"] == city]
        if any_local:
            return any_local[nth % len(any_local)]
    return _find(people, persona, nth)


def _profile(person: dict, index: int, seed: int) -> dict:
    place = CITY.get(person["city"]) or {"lat": 56.1, "lon": -106.3, "postal": "K1A"}
    return {
        "name": person["name"],
        "persona": person["persona"],
        "city": person["city"],
        "province": person["province"],
        "activity": person["activity"],
        "cash": person["cash"],
        "occupation": person["occupation"],
        "employer": person["employer"],
        "income_band": person["incomeBand"],
        "account_type": person["accountType"],
        "account_number": f"700{index + 1:05d}-{seed % 1000:03d}",
        "dob": person["dob"],
        "postal": place["postal"],
        "lat": place["lat"],
        "lon": place["lon"],
    }


def _plants(controls: dict, people: list[dict]) -> list[dict]:
    drafts: list[dict] = []
    intensity = controls["intensity"]

    def nudge(amount: float, cap: float = 9900) -> float:
        return rh(min(cap, amount + intensity * 400), 2)

    def on_day(preferred: int) -> datetime:
        return ANCHOR + timedelta(days=min(preferred, controls["days"] - 1))

    subject = _prefer(people, "msb_agent", controls["focus_city"], 0)
    if controls["structuring"]:
        start = _clock(on_day(4), 9, 12)
        for index, amount in enumerate((8200, 7600, 9100, 6400)):
            drafts.append(_draft(subject, start + timedelta(hours=10 * index), "IN", "CASH", nudge(amount), "structuring", "Cash purchase under the large-cash line", "Harbour Counter", "struct-1", counterparty="Harbour Counter", bank="Sentinel Bank", city=subject["city"]))
        ring = on_day(5)
        for index, persona in enumerate(("small_business", "student", "retiree")):
            individual = _prefer(people, persona, controls["focus_city"], 0)
            amount = (4200, 3800, 4600)[index]
            drafts.append(_draft(individual, _clock(ring, 11 + index, 15), "IN", "CASH", amount, "structuring", "Cash under the large-cash line", "North Wharf MSB", "struct-smurf", counterparty="North Wharf MSB", bank="Sentinel Bank", city=individual["city"]))
    if controls["layering"]:
        who = _prefer(people, "crypto_native", controls["focus_city"], 0)
        start = on_day(8)
        hops = (
            (18400, "US", "First Hudson NY", "New York"),
            (17120, "GB", "Thames Correspondent", "London"),
            (16340, "AE", "Gulf Clearing", "Dubai"),
            (15110, "HK", "Harbour Trading Bank", "Hong Kong"),
        )
        for index, hop in enumerate(hops):
            drafts.append(_draft(who, _clock(start, 1, 20 + index * 15), "OUT", "VIRTUAL_CURRENCY", hop[0], "layering", "Successive correspondent hop", hop[2], "layer-1", asset="BTC", counterparty=hop[2], country=hop[1], bank=hop[2], city=hop[3]))
    if controls["mules"]:
        mule = _prefer(people, "mule", controls["focus_city"], 0)
        recruit = _prefer(people, "mule", controls["focus_city"], 1)
        start = on_day(6)
        for index, amount in enumerate((2100, 1800, 2400, 1950)):
            sender = people[index % len(people)]
            drafts.append(_draft(mule, _clock(start, 22, 5 + index * 18), "IN", "E_TRANSFER", amount, "mule", "Interac receipt from a separate customer", sender["name"], "mule-1", counterparty=sender["name"], bank="Interac", city=sender["city"]))
        nxt = start + timedelta(days=1)
        for index, amount in enumerate((2600, 2400, 2200)):
            drafts.append(_draft(mule, _clock(nxt, 1, 10 + index * 15), "OUT", "VIRTUAL_CURRENCY", amount, "mule", "Fan-out after the e-Transfer cluster", "North Sea Digital", "mule-1", asset="USDT", counterparty="North Sea Digital", country="LT", bank="North Sea Digital", city="Vilnius", mcc="6051"))
        opened = on_day(min(12, controls["days"] - 1))
        host = _find(people, "student", 0) if recruit["name"] == mule["name"] else recruit
        for index, amount in enumerate((900, 1100, 1300, 1000)):
            sender = people[(index + 3) % len(people)]
            drafts.append(_draft(host, _clock(opened + timedelta(days=1 if index == 3 else 0), 20, 8 + index * 12), "IN", "E_TRANSFER", amount, "mule", "Account starts receiving e-Transfers", sender["name"], "mule-recruit", counterparty=sender["name"], bank="Interac", city=sender["city"]))
        drafts.append(_draft(host, _clock(opened + timedelta(days=1), 23, 40), "OUT", "WIRE", 3600, "mule", "Wire leaves after the new receipts", "First Hudson NY", "mule-recruit", counterparty="First Hudson NY", country="US", bank="First Hudson NY", city="New York"))
        drafts.append(_draft(host, _clock(opened + timedelta(days=1), 23, 55), "OUT", "VIRTUAL_CURRENCY", 2800, "mule", "Second leg leaves the new account", "Maple Exchange", "mule-recruit", asset="USDT", counterparty="Maple Exchange", bank="Maple Exchange", city="Toronto", mcc="6051"))
    if controls["trade"]:
        importer = _prefer(people, "importer", controls["focus_city"], 0)
        start = on_day(10)
        for offset, amount, purpose in ((0, 48000, "Commercial invoice — over stated value"), (1, 125000, "Commercial invoice — electronics")):
            drafts.append(_draft(importer, _clock(start + timedelta(days=offset), 14, 0), "OUT", "EFT", amount, "trade", purpose, "Harbour Trading Ltd", "trade-1", counterparty="Harbour Trading Ltd", country="HK", bank="Harbour Trading Bank", city="Hong Kong"))
        if intensity >= 0.5:
            drafts.append(_draft(importer, _clock(start + timedelta(days=3), 11, 30), "OUT", "WIRE", 12000, "trade", "Commercial invoice — under stated value", "Pearl River Clearing", "trade-under", counterparty="Pearl River Clearing", country="CN", bank="Pearl River Clearing", city="Shenzhen"))
    if controls["offramp"]:
        who = _prefer(people, "crypto_native", controls["focus_city"], 1)
        first = _clock(on_day(12), 3, 40)
        drafts.append(_draft(who, first, "IN", "VIRTUAL_CURRENCY", 22000, "crypto_offramp", "Stablecoin receipt", "Maple Exchange", "offramp-1", asset="USDT", counterparty="Maple Exchange", bank="Maple Exchange", city="Toronto", mcc="6051"))
        drafts.append(_draft(who, first + timedelta(hours=2), "OUT", "EFT", 20500, "crypto_offramp", "Fiat leaves after the virtual-currency receipt", "Sentinel Wire Desk", "offramp-1", counterparty="Sentinel Wire Desk", bank="Sentinel Bank", city=who["city"]))
    if controls["round_trip"]:
        trio = [people[index % len(people)] for index in (0, 4, 7)]
        start = _clock(on_day(3), 16, 10)
        hops = ((trio[0], trio[1], 6400), (trio[1], trio[2], 6100), (trio[2], trio[0], 5950))
        for index, (sender, receiver, amount) in enumerate(hops):
            drafts.append(_draft(sender, start + timedelta(hours=8 * index), "OUT", "VIRTUAL_CURRENCY", amount, "round_trip", f"Transfer toward {receiver['name']}", receiver["name"], "round-1", asset="ETH", counterparty=receiver["name"], bank="Maple Exchange", city=receiver["city"]))
    if controls["funnel"]:
        host = _find(people, "small_business", 1)
        start = on_day(9)
        for index, amount in enumerate((800, 950, 1100, 700, 1250, 990)):
            sender = people[index % len(people)]
            when = _clock(start + timedelta(days=1 if index > 3 else 0), 10 + (index % 4), 5 + index)
            drafts.append(_draft(host, when, "IN", "E_TRANSFER", amount, "funnel", "Small receipt into one account", sender["name"], "funnel-1", counterparty=sender["name"], bank="Interac", city=sender["city"]))
        drafts.append(_draft(host, _clock(start + timedelta(days=1), 18, 20), "OUT", "WIRE", 5000, "funnel", "One wire leaves after the small receipts", "Gulf Clearing", "funnel-1", counterparty="Gulf Clearing", country="AE", bank="Gulf Clearing", city="Dubai"))
    if controls["rapid"]:
        who = _find(people, "salaried", 2)
        start = on_day(7)
        drafts.append(_draft(who, _clock(start, 10, 5), "IN", "EFT", 18000, "rapid", "Incoming client settlement", "Client settlement", "rapid-1", counterparty="Client settlement", bank="Sentinel Bank", city=who["city"]))
        drafts.append(_draft(who, _clock(start, 11, 35), "OUT", "WIRE", 17000, "rapid", "Wire leaves inside two hours", "Sentinel Wire Desk", "rapid-1", counterparty="Sentinel Wire Desk", bank="Sentinel Bank", city="Toronto"))
    if controls["professional"]:
        blocked = {subject["name"], _find(people, "mule", 0)["name"]}
        person = next((item for item in people if item["persona"] == "salaried" and item["name"] not in blocked), None)
        if person is None:
            person = next((item for item in people if item["name"] not in blocked), people[0])
        start = on_day(11)
        for index, amount in enumerate((8700, 9100, 8400)):
            drafts.append(_draft(person, _clock(start, 13 + index, 20), "IN", "CASH", nudge(amount), "professional", "Cash placed for a coordinated book", "Harbour Counter", "pro-1", counterparty="Harbour Counter", bank="Sentinel Bank", city=person["city"]))
        drafts.append(_draft(person, _clock(start + timedelta(days=2), 15, 10), "OUT", "WIRE", 45000, "professional", "Cross-border wire after the cash cluster", "Gulf Clearing", "pro-1", counterparty="Gulf Clearing", country="AE", bank="Gulf Clearing", city="Dubai"))
    if controls["camouflage"] >= 0.1:
        freelancer = _find(people, "student", 0)
        for index, amount in enumerate((180, 240, 310)):
            drafts.append(_draft(freelancer, _clock(on_day(2), 15, 10 + index * 20), "IN", "E_TRANSFER", amount, "lookalike", "Freelance payment", "Client", "look-freelance", counterparty="Client", bank="Interac", city=freelancer["city"], camouflage=True))
    if controls["camouflage"] >= 0.25:
        cafe = _find(people, "small_business", 1)
        for index, amount in enumerate((4200, 3800, 3600)):
            drafts.append(_draft(cafe, _clock(on_day(16), 16, 5 + index * 25), "IN", "CASH", amount, "lookalike", "Weekend till deposit", "King West Provisions", "look-cafe", counterparty="King West Provisions", bank="Sentinel Bank", city=cafe["city"], camouflage=True))
    if controls["camouflage"] >= 0.5:
        importer = _find(people, "importer", 0)
        drafts.append(_draft(importer, _clock(on_day(18), 13, 45), "OUT", "EFT", 22000, "lookalike", "Recurring supplier payment", "Harbour Trading Ltd", "look-supplier", counterparty="Harbour Trading Ltd", country="HK", bank="Harbour Trading Bank", city="Hong Kong", camouflage=True))
    if controls["camouflage"] >= 0.8 and controls["structuring"]:
        for index, amount in enumerate((4500, 4700)):
            drafts.append(_draft(subject, _clock(on_day(14) + timedelta(days=index * 3), 18, 10), "IN", "CASH", amount, "structuring", "Two deposits spread across the week", "Harbour Counter", "struct-subtle", counterparty="Harbour Counter", bank="Sentinel Bank", city=subject["city"], camouflage=True))
    return drafts


def _draft(person, at, direction, channel, cad, typology, purpose, beneficiary, flow_id, asset="", counterparty="", country="CA", bank="", city="", mcc="", camouflage=False):
    return {
        "at": at,
        "person": person,
        "direction": direction,
        "channel": channel,
        "cad": cad,
        "typology": typology,
        "purpose": purpose,
        "beneficiary": beneficiary,
        "flow_id": flow_id,
        "asset": asset,
        "counterparty": counterparty,
        "country": country,
        "bank": bank,
        "city": city,
        "mcc": mcc,
        "camouflage": camouflage,
    }


def _push(rows: list[dict], controls: dict, rates_by_day: dict, serial: int, draft: dict) -> int:
    serial += 1
    person = draft["person"]
    index = next(i for i, item in enumerate(PERSONAS) if item["name"] == person["name"])
    profile = _profile(person, index, controls["seed"])
    cad = rh(float(draft["cad"]), 2)
    rates = rates_by_day.get(_iso(draft["at"])) or _rates(Rng(1), 0)
    asset = "CAD"
    fx_rate = 1.0
    amount_asset = cad
    if draft["channel"] == "VIRTUAL_CURRENCY":
        asset = draft.get("asset") or "BTC"
        raw_rate = rates.get(asset) or BASE_RATES.get(asset) or 1
        amount_asset = rh(cad / raw_rate, 8)
        fx_rate = rh(raw_rate, 4)
    typology = draft["typology"]
    rows.append({
        "id": f"sim-{controls['seed']}-{serial:04d}",
        "at": _stamp(draft["at"]),
        "customer": person["name"],
        "persona": person["persona"],
        "occupation": profile["occupation"],
        "income_band": profile["income_band"],
        "account_type": "credit_card" if draft["channel"] == "CARD" else "vc_wallet" if draft["channel"] == "VIRTUAL_CURRENCY" else profile["account_type"],
        "account_number": profile["account_number"],
        "city": person["city"],
        "province": person["province"],
        "country": "CA",
        "postal": profile["postal"],
        "direction": draft["direction"],
        "channel": draft["channel"],
        "method": METHOD.get(draft["channel"], "Online"),
        "disposition": _disposition(draft["channel"], draft["direction"]),
        "asset": asset,
        "amount_asset": amount_asset,
        "fx_rate": fx_rate,
        "cad": cad,
        "mcc": draft.get("mcc") or "",
        "counterparty": draft.get("counterparty") or "",
        "counterparty_country": draft.get("country") or "CA",
        "counterparty_bank": draft.get("bank") or "",
        "counterparty_city": draft.get("city") or "",
        "purpose": draft["purpose"],
        "conductor": person["name"],
        "beneficiary": draft["beneficiary"],
        "threshold_indicator": cad >= 10000,
        "typology": typology,
        "ground_truth": "benign" if typology in BENIGN else "suspicious",
        "camouflage": bool(draft.get("camouflage")),
        "flow_id": draft.get("flow_id") or "",
    })
    return serial


def _generate(controls: dict) -> tuple[list[dict], list[dict]]:
    rng = Rng(controls["seed"])
    people = PERSONAS[: controls["customers"]]
    rows: list[dict] = []
    serial = 0
    rates_by_day: dict[str, dict] = {}
    for offset in range(controls["days"]):
        day = ANCHOR + timedelta(days=offset)
        rates_by_day[_iso(day)] = _rates(rng, controls["fx_vol"])
        scale = _season(day, controls["seasonality"])
        for individual in people:
            count = _poisson(rng.random, quantize(individual["activity"] * scale * 0.85))
            for _ in range(count):
                hour = _hour(rng.random, controls["night_share"], False)
                minute = math.floor(rng.random() * 60)
                channel = _channel(rng, individual["persona"])
                cad = _amount(rng, channel, controls["mu"], controls["sigma"])
                direction = "IN" if rng.random() < _inward(individual["persona"], channel) else "OUT"
                who = _party(rng, channel, individual, people)
                asset = _asset(rng) if channel == "VIRTUAL_CURRENCY" else ""
                serial = _push(rows, controls, rates_by_day, serial, {
                    "at": _clock(day, hour, minute),
                    "person": individual,
                    "direction": direction,
                    "channel": channel,
                    "cad": cad,
                    "typology": "retail",
                    "purpose": _purpose(channel, direction),
                    "beneficiary": who["name"],
                    "flow_id": "",
                    "asset": asset,
                    "counterparty": who["name"],
                    "country": who["country"],
                    "bank": who["bank"],
                    "city": who["city"],
                    "mcc": who["mcc"],
                })
            if controls["payroll"] and day.weekday() == 3 and (offset // 7) % 2 == 0 and individual["persona"] in ("salaried", "student"):
                center = 3600 if individual["persona"] == "salaried" else 980
                cad = rh(min(6200, max(720, rng.gauss(center, 180))), 2)
                serial = _push(rows, controls, rates_by_day, serial, _draft(individual, _clock(day, 9, 10), "IN", "EFT", cad, "payroll", "Payroll deposit", individual["employer"], "", counterparty=individual["employer"], bank="Sentinel Bank", city=individual["city"]))
            if controls["rent"] and day.day in (1, 2) and individual["persona"] not in ("msb_agent", "mule"):
                cad = rh(max(900, rng.gauss(1850, 220)), 2)
                serial = _push(rows, controls, rates_by_day, serial, _draft(individual, _clock(day, 8, 15), "OUT", "EFT", cad, "rent", "Rent", "Landlord", "", counterparty="Landlord", bank="Sentinel Bank", city=individual["city"]))
            if day.day == 15 and individual["persona"] not in ("msb_agent", "mule"):
                cad = rh(min(480, max(60, rng.gauss(140, 30))), 2)
                serial = _push(rows, controls, rates_by_day, serial, _draft(individual, _clock(day, 7, 40), "OUT", "EFT", cad, "bill", "Bill payment", "Utilities", "", counterparty="Utilities", bank="Sentinel Bank", city=individual["city"], mcc="4900"))
    for draft in _plants(controls, people):
        serial = _push(rows, controls, rates_by_day, serial, draft)
    rows.sort(key=lambda row: (row["at"], row["id"]))
    return rows, people


def _norm(row: dict) -> dict:
    typology = row.get("typology") or "retail"
    country = row.get("counterparty_country") or row.get("counterpartyCountry") or "CA"
    flow_id = row.get("flow_id") if row.get("flow_id") is not None else row.get("flowId") or ""
    ground = row.get("ground_truth") or row.get("groundTruth") or ("benign" if typology in BENIGN else "suspicious")
    return {
        "id": row.get("id") or "",
        "at": row.get("at") or "",
        "customer": row.get("customer") or "",
        "channel": row.get("channel") or "",
        "direction": row.get("direction") or "",
        "counterparty_country": country,
        "counterparty": row.get("counterparty") or "",
        "cad": float(row.get("cad") or 0),
        "typology": typology,
        "beneficiary": row.get("beneficiary") or "",
        "flow_id": flow_id or "",
        "ground_truth": ground,
    }


def _groups(rows: list[dict], hours: float) -> list[list[dict]]:
    ordered = sorted(rows, key=lambda row: (row["at"], row["id"]))
    found = []
    for index, _start in enumerate(ordered):
        start = _parse(ordered[index]["at"])
        group = []
        for row in ordered[index:]:
            if (_parse(row["at"]) - start).total_seconds() <= hours * 3600:
                group.append(row)
            else:
                break
        found.append(group)
    return found


def _sum(rows: list[dict]) -> float:
    return rh(sum(row["cad"] for row in rows), 2)


def _hit(rule_id: str, title: str, customer: str, detail: str, rows: list[dict], all_rows: list[dict]) -> dict:
    txn_ids = [row["id"] for row in rows]
    planted = list(dict.fromkeys(row["typology"] for row in rows))
    suspicious = any(row["ground_truth"] == "suspicious" for row in rows)
    flows = {row["flow_id"] for row in rows if row["flow_id"]}
    missed = [row["id"] for row in all_rows if row["flow_id"] and row["flow_id"] in flows and row["id"] not in txn_ids]
    labels = [item for item in planted if item not in BENIGN] or planted
    truth = (
        f"Planted label: {', '.join(labels)}. This is a synthetic indicator, not a finding about a real person."
        if suspicious
        else "No planted suspicious label on these transactions. The rule matched activity that can also be ordinary."
    )
    return {
        "rule_id": rule_id,
        "title": title,
        "customer": customer,
        "detail": detail,
        "cad": _sum(rows),
        "txn_ids": txn_ids,
        "planted": planted,
        "truth": truth,
        "caught": detail,
        "missed_ids": missed,
    }


def evaluate(transactions: list[dict]) -> list[dict]:
    rows = [_norm(row) for row in transactions]
    hits: list[dict] = []
    by_customer: dict[str, list[dict]] = {}
    for row in rows:
        by_customer.setdefault(row["customer"], []).append(row)
    for customer, owned in by_customer.items():
        cash_in = [row for row in owned if row["channel"] == "CASH" and row["direction"] == "IN"]
        singles = [row for row in cash_in if row["cad"] >= 10000]
        if singles:
            hits.append(_hit("AML-FI-001", "Large cash receipt", customer, "A cash receipt is at or above CAD 10,000.", singles[:1], rows))
        else:
            for group in _groups(cash_in, 24):
                if _sum(group) >= 10000:
                    hits.append(_hit("AML-FI-001", "Large cash receipts in 24 hours", customer, "Cash receipts aggregate to CAD 10,000 in 24 hours.", group, rows))
                    break
        structured = [row for row in cash_in if 2000 <= row["cad"] < 10000]
        for group in _groups(structured, 48):
            total = _sum(group)
            if len(group) >= 3 and total >= 10000:
                hits.append(_hit("AML-FI-003", "Cash structured under CAD 10,000", customer, f"{len(group)} cash receipts sit under CAD 10,000 and total CAD {total:.2f} within 48 hours.", group, rows))
                break
        international = [row for row in owned if row["channel"] in ("EFT", "WIRE") and row["counterparty_country"] != "CA"]
        for direction in ("IN", "OUT"):
            subset = [row for row in international if row["direction"] == direction]
            large = [row for row in subset if row["cad"] >= 10000]
            if large:
                hits.append(_hit("AML-FI-002", "International EFT at the reporting line", customer, "An international EFT or wire is at or above CAD 10,000.", large[:1], rows))
                continue
            for group in _groups(subset, 24):
                if _sum(group) >= 10000:
                    hits.append(_hit("AML-FI-002", "International EFTs in 24 hours", customer, "International EFTs in one direction aggregate to CAD 10,000.", group, rows))
                    break
        for inflow in sorted(owned, key=lambda row: row["at"]):
            if inflow["direction"] != "IN" or inflow["cad"] < 5000:
                continue
            start = _parse(inflow["at"])
            other = [row for row in owned if row["direction"] == "OUT" and row["channel"] != inflow["channel"] and _parse(row["at"]) >= start and (_parse(row["at"]) - start).total_seconds() <= 6 * 3600]
            moved = _sum(other)
            if other and moved >= quantize(0.7 * inflow["cad"]):
                hits.append(_hit("AML-FI-004", "Value left on a different rail within 6 hours", customer, f"CAD {inflow['cad']:.2f} came in on {inflow['channel']} and CAD {moved:.2f} left on another rail.", [inflow, *other], rows))
                break
        vc_out = [row for row in owned if row["channel"] == "VIRTUAL_CURRENCY" and row["direction"] == "OUT"]
        for group in _groups(vc_out, 6):
            decreasing = all(index == 0 or row["cad"] <= group[index - 1]["cad"] * 1.02 for index, row in enumerate(group))
            if len(group) >= 3 and _sum(group) >= 10000 and decreasing:
                hits.append(_hit("TYPOLOGY-LAYERING", "Layering chain", customer, f"{len(group)} virtual-currency hops leave in a short window, amounts stepping down.", group, rows))
                break
        for group in _groups(owned, 18):
            ins = [row for row in group if row["direction"] == "IN" and row["channel"] == "E_TRANSFER"]
            outs = [row for row in group if row["direction"] == "OUT" and row["channel"] in ("VIRTUAL_CURRENCY", "WIRE", "EFT")]
            sources = {row["counterparty"] for row in ins}
            if len(ins) >= 4 and len(sources) >= 3 and _sum(ins) >= 5000 and len(outs) >= 2 and _sum(outs) >= quantize(0.6 * _sum(ins)):
                hits.append(_hit("TYPOLOGY-MULE", "Mule fan-in then fan-out", customer, f"{len(ins)} e-Transfers arrive from {len(sources)} counterparties, then {len(outs)} payments leave.", [*ins, *outs], rows))
                break
        for inflow in [row for row in owned if row["channel"] == "VIRTUAL_CURRENCY" and row["direction"] == "IN" and row["cad"] >= 8000]:
            start = _parse(inflow["at"])
            outs = [row for row in owned if row["channel"] in ("EFT", "WIRE") and row["direction"] == "OUT" and _parse(row["at"]) >= start and (_parse(row["at"]) - start).total_seconds() <= 8 * 3600]
            if _sum(outs) >= quantize(0.7 * inflow["cad"]):
                hits.append(_hit("TYPOLOGY-OFFRAMP", "Virtual currency to fiat off-ramp", customer, "Stablecoin in, fiat out inside a few hours.", [inflow, *outs], rows))
                break
        for inflow in [row for row in owned if row["direction"] == "IN" and row["cad"] >= 8000 and row["channel"] != "VIRTUAL_CURRENCY"]:
            start = _parse(inflow["at"])
            outs = [row for row in owned if row["direction"] == "OUT" and row["channel"] != inflow["channel"] and _parse(row["at"]) >= start and (_parse(row["at"]) - start).total_seconds() <= 3 * 3600]
            if _sum(outs) >= quantize(0.85 * inflow["cad"]):
                hits.append(_hit("TYPOLOGY-RAPID", "Rapid movement in and out", customer, "Most of a large receipt leaves on another rail inside three hours.", [inflow, *outs], rows))
                break
        for group in _groups(owned, 72):
            ins = [row for row in group if row["direction"] == "IN" and row["channel"] == "E_TRANSFER" and row["cad"] < 3000]
            distinct = {row["counterparty"] for row in ins}
            if len(ins) < 5 or len(distinct) < 5 or _sum(ins) < 4000:
                continue
            last = ins[-1]
            end = _parse(last["at"])
            wire = next((row for row in owned if row["direction"] == "OUT" and row["channel"] in ("WIRE", "EFT") and _parse(row["at"]) >= end and (_parse(row["at"]) - end).total_seconds() <= 24 * 3600 and row["cad"] >= quantize(0.8 * _sum(ins)) and row["cad"] >= 4000), None)
            if wire:
                hits.append(_hit("TYPOLOGY-FUNNEL", "Funnel account", customer, f"{len(distinct)} small receipts, then one larger payment leaves.", [*ins, wire], rows))
                break
        cluster = next((group for group in _groups(structured, 48) if len(group) >= 3 and _sum(group) >= 10000), None)
        if cluster:
            start = _parse(cluster[0]["at"])
            wire = next((row for row in owned if row["channel"] in ("WIRE", "EFT") and row["counterparty_country"] != "CA" and row["cad"] >= 20000 and abs((_parse(row["at"]) - start).total_seconds()) <= 7 * 86400), None)
            if wire:
                hits.append(_hit("TYPOLOGY-PROFESSIONAL", "Coordinated cash then cross-border wire", customer, "Sub-threshold cash and a large international wire land on the same customer inside a week.", [*cluster, wire], rows))
    by_beneficiary: dict[str, list[dict]] = {}
    for row in rows:
        if row["channel"] == "CASH" and row["direction"] == "IN" and row["cad"] < 10000 and row["beneficiary"]:
            by_beneficiary.setdefault(row["beneficiary"], []).append(row)
    for beneficiary, grouped in by_beneficiary.items():
        for group in _groups(grouped, 24):
            customers = {row["customer"] for row in group}
            total = _sum(group)
            if len(customers) >= 3 and total >= 10000:
                hits.append(_hit("AML-FI-005", "Several customers placed sub-threshold cash", beneficiary, f"{len(customers)} customers placed cash under CAD 10,000 with one beneficiary, totalling CAD {total:.2f}.", group, rows))
                break
    wires = [row for row in rows if row["channel"] in ("EFT", "WIRE") and row["direction"] == "OUT" and row["counterparty_country"] != "CA" and row["cad"] >= 20000 and row["cad"] % 100 == 0]
    by_trade: dict[str, list[dict]] = {}
    for row in wires:
        by_trade.setdefault(f"{row['customer']}|{row['beneficiary']}", []).append(row)
    for grouped in by_trade.values():
        for group in _groups(grouped, 24 * 10):
            if len(group) >= 2:
                hits.append(_hit("TYPOLOGY-TBML", "Trade invoice pattern", group[0]["customer"], "Round commercial wires to the same trading counterparty.", group, rows))
                break
    outs = [row for row in rows if row["direction"] == "OUT" and row["beneficiary"] and row["cad"] >= 4000]
    by_sender: dict[str, list[dict]] = {}
    for row in outs:
        by_sender.setdefault(row["customer"], []).append(row)
    found = False
    for first in outs:
        if found:
            break
        start = _parse(first["at"])
        for second in by_sender.get(first["beneficiary"], []):
            if _parse(second["at"]) < start or (_parse(second["at"]) - start).total_seconds() > 36 * 3600:
                continue
            for third in by_sender.get(second["beneficiary"], []):
                if third["beneficiary"] != first["customer"]:
                    continue
                if _parse(third["at"]) < _parse(second["at"]) or (_parse(third["at"]) - start).total_seconds() > 36 * 3600:
                    continue
                amounts = (first["cad"], second["cad"], third["cad"])
                peak = max(amounts)
                if all(amount >= peak * 0.85 for amount in amounts):
                    hits.append(_hit("TYPOLOGY-ROUNDTRIP", "Round-trip across customers", third["beneficiary"] or first["customer"], "Value circles back at nearly the same amount.", [first, second, third], rows))
                    found = True
                    break
            if found:
                break
    hits.sort(key=lambda item: (item["rule_id"], item["customer"], item["txn_ids"][0] if item["txn_ids"] else ""))
    return hits


def _median(values: list[float]):
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return rh(ordered[mid], 2)
    return rh((ordered[mid - 1] + ordered[mid]) / 2, 2)


def score(transactions: list[dict], hits: list[dict]) -> dict:
    rows = [_norm(row) if "ground_truth" not in row and "groundTruth" not in row else _norm(row) for row in transactions]
    flagged = {txn_id for hit in hits for txn_id in hit["txn_ids"]}
    tp = fp = tn = fn = 0
    for row in rows:
        suspicious = row["ground_truth"] == "suspicious"
        hit = row["id"] in flagged
        if suspicious and hit:
            tp += 1
        elif suspicious:
            fn += 1
        elif hit:
            fp += 1
        else:
            tn += 1
    precision = tp / (tp + fp) if tp + fp else 0
    recall = tp / (tp + fn) if tp + fn else 0
    f1 = (2 * precision * recall) / (precision + recall) if precision + recall else 0
    by_id = {row["id"]: row for row in rows}
    alert_tp = sum(1 for hit in hits if any(by_id.get(txn_id, {}).get("ground_truth") == "suspicious" for txn_id in hit["txn_ids"]))
    plants: dict[str, list[dict]] = {}
    for row in rows:
        if row["ground_truth"] != "suspicious":
            continue
        plants.setdefault(row["flow_id"] or f"{row['typology']}:{row['customer']}", []).append(row)
    by_type: dict[str, dict] = {}
    times = []
    for flow_id, grouped in plants.items():
        typology = grouped[0]["typology"]
        bucket = by_type.setdefault(typology, {"plants": 0, "detected": 0})
        bucket["plants"] += 1
        detected = any(row["id"] in flagged for row in grouped)
        if detected:
            bucket["detected"] += 1
        first = sorted(grouped, key=lambda row: row["at"])[0]
        hours = None
        if detected:
            covering = [hit for hit in hits if any(row["id"] in hit["txn_ids"] for row in grouped)]
            detect_at = sorted(max((by_id[txn_id]["at"] for txn_id in hit["txn_ids"] if txn_id in by_id), default="") for hit in covering)
            detect_at = [item for item in detect_at if item]
            if detect_at:
                hours = rh((_parse(detect_at[0]) - _parse(first["at"])).total_seconds() / 3600, 2)
        times.append({"flow_id": flow_id, "typology": typology, "hours": hours, "detected": detected})
    by_typology = [
        {"typology": typology, "plants": bucket["plants"], "detected": bucket["detected"], "rate": rh(bucket["detected"] / bucket["plants"], 4) if bucket["plants"] else 0}
        for typology, bucket in sorted(by_type.items())
    ]
    return {
        "tp": tp,
        "fp": fp,
        "tn": tn,
        "fn": fn,
        "precision": rh(precision, 4),
        "recall": rh(recall, 4),
        "f1": rh(f1, 4),
        "alert_precision": rh(alert_tp / len(hits), 4) if hits else 0,
        "alerts": len(hits),
        "by_typology": by_typology,
        "median_hours_to_detect": _median([item["hours"] for item in times if item["hours"] is not None]),
        "times": times,
    }


def _summarize(controls: dict, rows: list[dict], hits: list[dict], people: list[dict]) -> dict:
    by_hour = [0] * 24
    by_channel: dict[str, int] = {}
    by_typology: dict[str, int] = {}
    by_province: dict[str, int] = {}
    total = 0.0
    for row in rows:
        by_hour[int(row["at"][11:13])] += 1
        by_channel[row["channel"]] = by_channel.get(row["channel"], 0) + 1
        by_typology[row["typology"]] = by_typology.get(row["typology"], 0) + 1
        by_province[row["province"]] = by_province.get(row["province"], 0) + 1
        total += row["cad"]
    end = ANCHOR + timedelta(days=controls["days"] - 1)
    customers = [_profile(person, index, controls["seed"]) for index, person in enumerate(people)]
    return {
        "disclaimer": DISCLAIMER,
        "controls": controls,
        "summary": {
            "transactions": len(rows),
            "customers": len(customers),
            "cad_total": rh(total, 2),
            "hit_count": len(hits),
            "by_channel": by_channel,
            "by_hour": by_hour,
            "by_typology": by_typology,
            "by_province": by_province,
            "window_start": ANCHOR_ISO,
            "window_end": _iso(end),
        },
        "customers": customers,
        "directory": {
            "merchants": [{"name": item["name"], "mcc": item["mcc"], "city": item["city"], "category": item["category"]} for item in MERCHANTS],
            "correspondents": [{"name": item["name"], "country": item["country"], "city": item["city"]} for item in CORRESPONDENTS],
            "exchanges": [{"name": item["name"], "country": item["country"], "city": item["city"]} for item in EXCHANGES],
        },
        "hits": hits,
        "transactions": rows,
        "evaluation": score(rows, hits),
    }


def simulate(raw: dict | None = None) -> dict:
    controls = controls_from(raw)
    rows, people = _generate(controls)
    hits = evaluate(rows)
    return _summarize(controls, rows, hits, people)


def _js_num(value: float) -> str:
    rounded = rh(float(value), 2)
    if rounded == int(rounded):
        return str(int(rounded))
    return f"{rounded:.2f}".rstrip("0").rstrip(".")


def fingerprint(book: dict) -> str:
    cents = round(sum(round(row["cad"] * 100) for row in book["transactions"]))
    rules = ",".join(f"{hit['rule_id']}:{hit['customer']}" for hit in book["hits"])
    head = "|".join(f"{row['id']}:{_js_num(row['cad'])}:{row['channel']}:{row['typology']}" for row in book["transactions"][:5])
    tail = "|".join(f"{row['id']}:{_js_num(row['cad'])}:{row['typology']}" for row in book["transactions"][-3:])
    return f"{len(book['transactions'])}|{cents}|{rules}|{head}|{tail}"
