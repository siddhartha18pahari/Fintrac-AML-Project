/**
 * Agent-based synthetic Canadian bank.
 * Planted labels are indicators for detection practice. They are not a method for moving value.
 * The draw order is shared with app/services/bank_engine.py.
 */

import {
  ANCHOR_ISO,
  BASE_RATES,
  BENIGN,
  CITY,
  CORRESPONDENTS,
  EXCHANGES,
  HOLIDAYS,
  MERCHANTS,
  MIX,
  PERSONAS,
  VC_ASSETS,
  VC_WEIGHTS,
  type Persona,
} from "./catalog";
import { makeRng, quantize, type Rng } from "./rng";
import type { Evaluation, Preset, SimBook, SimControls, SimCustomer, SimHit, SimTxn } from "./types";

export const DISCLAIMER =
  "Synthetic book for a Canadian bank. Planted labels are indicators so a rule can be scored against a known script. They do not find that anyone laundered money, and they are not a way to move value.";

export const SIM_DEFAULTS: SimControls = {
  seed: 7,
  days: 21,
  customers: 12,
  mu: 6.2,
  sigma: 0.85,
  seasonality: 0.35,
  nightShare: 0.12,
  fxVol: 0.02,
  intensity: 0.55,
  camouflage: 0,
  focusCity: "",
  structuring: true,
  layering: true,
  mules: true,
  trade: true,
  offramp: true,
  roundTrip: true,
  funnel: false,
  rapid: false,
  professional: false,
  payroll: true,
  rent: true,
  preset: "",
};

export const PRESETS: Preset[] = [
  {
    id: "toronto-fentanyl",
    name: "Toronto fentanyl network",
    blurb: "Synthetic cash placement across the GTA, smurfs into one MSB, a mule fan-out and a virtual-currency off-ramp.",
    controls: {
      seed: 19, days: 28, customers: 18, intensity: 0.85, camouflage: 0.4, nightShare: 0.28, focusCity: "Toronto",
      structuring: true, mules: true, professional: true, funnel: true, rapid: true, offramp: true,
      layering: false, trade: false, roundTrip: false, payroll: true, rent: true, preset: "toronto-fentanyl",
    },
  },
  {
    id: "tbml",
    name: "TBML via import/export",
    blurb: "Synthetic invoice wires through Hong Kong and the Gulf, layered across correspondents, with ordinary importer activity beside them.",
    controls: {
      seed: 23, days: 30, customers: 16, intensity: 0.7, camouflage: 0.55, fxVol: 0.04, focusCity: "Vancouver",
      trade: true, layering: true, structuring: false, mules: false, offramp: false, roundTrip: false,
      funnel: false, rapid: false, professional: false, payroll: true, rent: true, preset: "tbml",
    },
  },
  {
    id: "romance",
    name: "Romance-scam mules",
    blurb: "Synthetic mule accounts that start receiving Interac e-Transfers partway through the window, then wire and off-ramp.",
    controls: {
      seed: 31, days: 24, customers: 16, intensity: 0.75, camouflage: 0.3, nightShare: 0.22, focusCity: "Calgary",
      mules: true, offramp: true, rapid: true, funnel: true, structuring: false, layering: false, trade: false,
      roundTrip: false, professional: false, payroll: true, rent: true, preset: "romance",
    },
  },
  {
    id: "quiet",
    name: "Quiet retail book",
    blurb: "Paydays, rent, bills, card spend and e-Transfer. Camouflage stays light so most activity is ordinary.",
    controls: {
      seed: 5, days: 21, customers: 14, intensity: 0, camouflage: 0.15, focusCity: "",
      structuring: false, layering: false, mules: false, trade: false, offramp: false, roundTrip: false,
      funnel: false, rapid: false, professional: false, payroll: true, rent: true, preset: "quiet",
    },
  },
  {
    id: "full",
    name: "Full synthetic book",
    blurb: "Every planted indicator, plus camouflage so some ordinary activity resembles a rule.",
    controls: {
      seed: 7, days: 21, customers: 18, intensity: 0.6, camouflage: 0.45, focusCity: "",
      structuring: true, layering: true, mules: true, trade: true, offramp: true, roundTrip: true,
      funnel: true, rapid: true, professional: true, payroll: true, rent: true, preset: "full",
    },
  },
];

const AMOUNT: Record<string, [number, number, number]> = {
  CARD: [8, 0.08, 650],
  ATM: [20, 0.05, 400],
  CASH: [40, 0.12, 900],
  E_TRANSFER: [20, 0.35, 3000],
  EFT: [50, 0.9, 7500],
  WIRE: [200, 1.1, 9000],
  VIRTUAL_CURRENCY: [30, 0.7, 6000],
};

const METHOD: Record<string, string> = {
  CARD: "Card",
  ATM: "ATM",
  CASH: "In person",
  E_TRANSFER: "Online",
  EFT: "Online",
  WIRE: "Wire",
  VIRTUAL_CURRENCY: "Online",
};

type Loose = Partial<SimControls> & Record<string, unknown>;

function num(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function flag(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  return fallback;
}

export function clampControls(raw: Loose = {}): SimControls {
  const base: SimControls = { ...SIM_DEFAULTS };
  const presetId = String(raw.preset ?? "");
  const preset = PRESETS.find((item) => item.id === presetId);
  if (preset) Object.assign(base, preset.controls);
  const next: SimControls = {
    ...base,
    seed: Math.round(num(raw.seed, base.seed)),
    days: Math.round(num(raw.days, base.days)),
    customers: Math.round(num(raw.customers, base.customers)),
    mu: num(raw.mu, base.mu),
    sigma: num(raw.sigma, base.sigma),
    seasonality: num(raw.seasonality, base.seasonality),
    nightShare: num(raw.nightShare ?? raw.night_share, base.nightShare),
    fxVol: num(raw.fxVol ?? raw.fx_vol, base.fxVol),
    intensity: num(raw.intensity, base.intensity),
    camouflage: num(raw.camouflage, base.camouflage),
    focusCity: raw.focusCity !== undefined || raw.focus_city !== undefined ? String(raw.focusCity ?? raw.focus_city ?? "") : base.focusCity,
    structuring: flag(raw.structuring, base.structuring),
    layering: flag(raw.layering, base.layering),
    mules: flag(raw.mules, base.mules),
    trade: flag(raw.trade, base.trade),
    offramp: flag(raw.offramp, base.offramp),
    roundTrip: flag(raw.roundTrip ?? raw.round_trip, base.roundTrip),
    funnel: flag(raw.funnel, base.funnel),
    rapid: flag(raw.rapid, base.rapid),
    professional: flag(raw.professional, base.professional),
    payroll: flag(raw.payroll, base.payroll),
    rent: flag(raw.rent, base.rent),
    preset: raw.preset !== undefined ? String(raw.preset ?? "") : base.preset,
  };
  next.days = Math.max(7, Math.min(60, next.days));
  next.customers = Math.max(6, Math.min(48, next.customers));
  next.seed = Math.max(1, Math.min(999999, next.seed));
  next.mu = Math.max(4, Math.min(9, next.mu));
  next.sigma = Math.max(0.2, Math.min(1.6, next.sigma));
  next.seasonality = Math.max(0, Math.min(1, next.seasonality));
  next.nightShare = Math.max(0, Math.min(0.6, next.nightShare));
  next.fxVol = Math.max(0, Math.min(0.15, next.fxVol));
  next.intensity = Math.max(0, Math.min(1, next.intensity));
  next.camouflage = Math.max(0, Math.min(1, next.camouflage));
  return next;
}

function rh(value: number, places: number) {
  const factor = 10 ** places;
  return Math.floor(value * factor + 0.5) / factor;
}

function anchorDate() {
  return new Date(`${ANCHOR_ISO}T00:00:00Z`);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86400000);
}

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

function stamp(date: Date) {
  return date.toISOString().slice(0, 19);
}

function atClock(day: Date, hour: number, minute: number) {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute, 0));
}

function parseAt(value: string) {
  return Date.parse(`${value}Z`);
}

function seasonOf(date: Date, seasonality: number) {
  const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6 ? 0.58 : 1;
  const holiday = HOLIDAYS.has(iso(date)) ? 0.32 : 1;
  const monthEnd = date.getUTCDate() >= 28 ? quantize(1 + seasonality) : 1;
  const wave = quantize(1 + seasonality * 0.22 * Math.sin((2 * Math.PI * (date.getUTCDate() % 30)) / 30));
  return quantize(weekend * holiday * monthEnd * wave);
}

function poisson(rand: () => number, lam: number) {
  if (lam <= 0) return 0;
  const limit = quantize(Math.exp(-lam));
  let count = 0;
  let product = 1;
  while (product > limit && count < 12) {
    count += 1;
    product = quantize(product * rand());
  }
  return Math.max(0, count - 1);
}

function hourOf(rand: () => number, nightShare: number, suspicious: boolean) {
  const weights: number[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    let weight = hour >= 9 && hour <= 16 ? 5 : hour >= 7 && hour <= 19 ? 2 : 0.35;
    if (suspicious && hour < 6) weight += 6 * nightShare;
    if (!suspicious && hour < 6) weight *= Math.max(0.15, 1 - Math.min(0.85, nightShare));
    weights.push(quantize(weight));
  }
  const total = quantize(weights.reduce((sum, value) => sum + value, 0));
  let cursor = quantize(rand() * total);
  for (let hour = 0; hour < 24; hour += 1) {
    cursor = quantize(cursor - weights[hour]);
    if (cursor <= 0) return hour;
  }
  return 12;
}

function dayRates(rng: Rng, fxVol: number) {
  const rates: Record<string, number> = { CAD: 1 };
  for (const asset of VC_ASSETS) {
    const shock = quantize(fxVol * (asset === "USDT" ? 0.15 : 1));
    const draw = rng.gauss(0, shock);
    rates[asset] = quantize(Math.max(0.01, quantize(BASE_RATES[asset] * (1 + draw))));
  }
  return rates;
}

function pickAsset(rng: Rng) {
  let roll = rng.rand() * 100;
  for (let index = 0; index < VC_ASSETS.length; index += 1) {
    roll -= VC_WEIGHTS[index];
    if (roll <= 0) return VC_ASSETS[index];
  }
  return "BTC";
}

function pickChannel(rng: Rng, persona: string) {
  const mix = MIX[persona] ?? MIX.salaried;
  let roll = rng.rand() * 100;
  for (const [channel, weight] of mix) {
    roll -= weight;
    if (roll <= 0) return channel;
  }
  return mix[mix.length - 1][0];
}

function amountFor(rng: Rng, channel: string, mu: number, sigma: number) {
  const raw = quantize(Math.exp(rng.gauss(mu, sigma)));
  const [floor, scale, cap] = AMOUNT[channel] ?? AMOUNT.EFT;
  return rh(Math.min(cap, Math.max(floor, raw * scale)), 2);
}

function inward(persona: string, channel: string) {
  if (channel === "CARD" || channel === "ATM") return 0.08;
  if (channel === "CASH") return 0.72;
  if (channel === "EFT" && (persona === "salaried" || persona === "student" || persona === "retiree")) return 0.62;
  if (channel === "WIRE" && persona === "importer") return 0.25;
  if (channel === "VIRTUAL_CURRENCY") return 0.55;
  return 0.48;
}

type Party = { name: string; country: string; mcc: string; bank: string; city: string };

function party(rng: Rng, channel: string, person: Persona, people: Persona[]): Party {
  const roll = rng.rand();
  const slot = rng.int(997);
  if (channel === "CARD") {
    const merchant = MERCHANTS[slot % MERCHANTS.length];
    return { name: merchant.name, country: "CA", mcc: merchant.mcc, bank: "", city: merchant.city };
  }
  if (channel === "E_TRANSFER") {
    const other = people[slot % people.length];
    return { name: other.name, country: "CA", mcc: "", bank: "Interac", city: other.city };
  }
  if (channel === "ATM" || channel === "CASH") {
    return { name: `${person.city} branch`, country: "CA", mcc: "", bank: "Sentinel Bank", city: person.city };
  }
  if (channel === "VIRTUAL_CURRENCY") {
    const exchange = EXCHANGES[roll < 0.72 ? 0 : roll < 0.9 ? 1 : 2];
    return { name: exchange.name, country: exchange.country, mcc: "6051", bank: exchange.name, city: exchange.city };
  }
  if (channel === "WIRE") {
    if (roll < 0.62) {
      const bank = CORRESPONDENTS[slot % CORRESPONDENTS.length];
      return { name: bank.name, country: bank.country, mcc: "", bank: bank.name, city: bank.city };
    }
    return { name: "Sentinel Wire Desk", country: "CA", mcc: "", bank: "Sentinel Bank", city: "Toronto" };
  }
  if (roll < 0.1) {
    const bank = CORRESPONDENTS[slot % CORRESPONDENTS.length];
    return { name: bank.name, country: bank.country, mcc: "", bank: bank.name, city: bank.city };
  }
  return { name: "Bill payee", country: "CA", mcc: "4814", bank: "Sentinel Bank", city: person.city };
}

function purposeFor(channel: string, direction: "IN" | "OUT") {
  if (channel === "CARD") return "Card purchase";
  if (channel === "ATM") return "ATM withdrawal";
  if (channel === "CASH") return direction === "IN" ? "Cash deposit" : "Cash withdrawal";
  if (channel === "E_TRANSFER") return "Interac e-Transfer";
  if (channel === "WIRE") return "Wire transfer";
  if (channel === "VIRTUAL_CURRENCY") return "Virtual currency exchange";
  return "Electronic transfer";
}

function dispositionFor(channel: string, direction: "IN" | "OUT") {
  if (channel === "CARD") return "purchase";
  if (channel === "ATM") return "withdrawal";
  if (channel === "VIRTUAL_CURRENCY") return "exchange";
  if (direction === "IN") return "deposit";
  return "transfer";
}

function findPersona(people: Persona[], persona: string, nth = 0) {
  const matches = people.filter((item) => item.persona === persona);
  if (!matches.length) return people[nth % people.length];
  return matches[nth % matches.length];
}

function preferCity(people: Persona[], persona: string, city: string, nth = 0) {
  if (city) {
    const local = people.filter((item) => item.persona === persona && item.city === city);
    if (local.length) return local[nth % local.length];
    const any = people.filter((item) => item.city === city);
    if (any.length) return any[nth % any.length];
  }
  return findPersona(people, persona, nth);
}

function toCustomer(person: Persona, index: number, seed: number): SimCustomer {
  const place = CITY[person.city] ?? { lat: 56.1, lon: -106.3, postal: "K1A" };
  return {
    name: person.name,
    persona: person.persona,
    city: person.city,
    province: person.province,
    activity: person.activity,
    cash: person.cash,
    occupation: person.occupation,
    employer: person.employer,
    incomeBand: person.incomeBand,
    accountType: person.accountType,
    accountNumber: `700${String(index + 1).padStart(5, "0")}-${String(seed % 1000).padStart(3, "0")}`,
    dob: person.dob,
    postal: place.postal,
    lat: place.lat,
    lon: place.lon,
  };
}

type Draft = {
  at: Date;
  person: Persona;
  direction: "IN" | "OUT";
  channel: string;
  cad: number;
  typology: string;
  purpose: string;
  beneficiary: string;
  flowId: string;
  asset?: string;
  counterparty?: string;
  counterpartyCountry?: string;
  counterpartyBank?: string;
  counterpartyCity?: string;
  mcc?: string;
  camouflage?: boolean;
};

function buildRows(controls: SimControls, extra: Draft[] = []) {
  const rng = makeRng(controls.seed);
  const people = PERSONAS.slice(0, controls.customers);
  const byName = new Map(people.map((person, index) => [person.name, toCustomer(person, index, controls.seed)]));
  const rows: SimTxn[] = [];
  let serial = 0;
  const anchor = anchorDate();
  const ratesByDay = new Map<string, Record<string, number>>();

  function push(draft: Draft) {
    serial += 1;
    const profile = byName.get(draft.person.name) ?? toCustomer(draft.person, 0, controls.seed);
    const cad = rh(draft.cad, 2);
    const dayKey = iso(draft.at);
    const rates = ratesByDay.get(dayKey) ?? dayRates(makeRng(1), 0);
    let asset = "CAD";
    let fxRate = 1;
    let amountAsset = cad;
    if (draft.channel === "VIRTUAL_CURRENCY") {
      asset = draft.asset || "BTC";
      fxRate = rates[asset] || BASE_RATES[asset] || 1;
      amountAsset = rh(cad / fxRate, 8);
      fxRate = rh(fxRate, 4);
    }
    const suspicious = !BENIGN.has(draft.typology);
    rows.push({
      id: `sim-${controls.seed}-${String(serial).padStart(4, "0")}`,
      at: stamp(draft.at),
      customer: draft.person.name,
      persona: draft.person.persona,
      occupation: profile.occupation,
      incomeBand: profile.incomeBand,
      accountType: draft.channel === "CARD" ? "credit_card" : draft.channel === "VIRTUAL_CURRENCY" ? "vc_wallet" : profile.accountType,
      accountNumber: profile.accountNumber,
      city: draft.person.city,
      province: draft.person.province,
      country: "CA",
      postal: profile.postal,
      direction: draft.direction,
      channel: draft.channel,
      method: METHOD[draft.channel] ?? "Online",
      disposition: dispositionFor(draft.channel, draft.direction),
      asset,
      amountAsset,
      fxRate,
      cad,
      mcc: draft.mcc ?? "",
      counterparty: draft.counterparty ?? "",
      counterpartyCountry: draft.counterpartyCountry ?? "CA",
      counterpartyBank: draft.counterpartyBank ?? "",
      counterpartyCity: draft.counterpartyCity ?? "",
      purpose: draft.purpose,
      conductor: draft.person.name,
      beneficiary: draft.beneficiary,
      thresholdIndicator: cad >= 10000,
      typology: draft.typology,
      groundTruth: suspicious ? "suspicious" : "benign",
      camouflage: Boolean(draft.camouflage),
      flowId: draft.flowId,
    });
  }

  for (let offset = 0; offset < controls.days; offset += 1) {
    const day = addDays(anchor, offset);
    ratesByDay.set(iso(day), dayRates(rng, controls.fxVol));
    const scale = seasonOf(day, controls.seasonality);
    for (const individual of people) {
      const count = poisson(rng.rand, quantize(individual.activity * scale * 0.85));
      for (let index = 0; index < count; index += 1) {
        const hour = hourOf(rng.rand, controls.nightShare, false);
        const minute = Math.floor(rng.rand() * 60);
        const channel = pickChannel(rng, individual.persona);
        const cad = amountFor(rng, channel, controls.mu, controls.sigma);
        const direction: "IN" | "OUT" = rng.rand() < inward(individual.persona, channel) ? "IN" : "OUT";
        const who = party(rng, channel, individual, people);
        const asset = channel === "VIRTUAL_CURRENCY" ? pickAsset(rng) : undefined;
        push({
          at: atClock(day, hour, minute),
          person: individual,
          direction,
          channel,
          cad,
          typology: "retail",
          purpose: purposeFor(channel, direction),
          beneficiary: who.name,
          flowId: "",
          asset,
          counterparty: who.name,
          counterpartyCountry: who.country,
          counterpartyBank: who.bank,
          counterpartyCity: who.city,
          mcc: who.mcc,
        });
      }
      if (controls.payroll && day.getUTCDay() === 4 && Math.floor(offset / 7) % 2 === 0 && (individual.persona === "salaried" || individual.persona === "student")) {
        const center = individual.persona === "salaried" ? 3600 : 980;
        const cad = rh(Math.min(6200, Math.max(720, rng.gauss(center, 180))), 2);
        push({
          at: atClock(day, 9, 10),
          person: individual,
          direction: "IN",
          channel: "EFT",
          cad,
          typology: "payroll",
          purpose: "Payroll deposit",
          beneficiary: individual.employer,
          flowId: "",
          counterparty: individual.employer,
          counterpartyCountry: "CA",
          counterpartyBank: "Sentinel Bank",
          counterpartyCity: individual.city,
        });
      }
      if (controls.rent && (day.getUTCDate() === 1 || day.getUTCDate() === 2) && individual.persona !== "msb_agent" && individual.persona !== "mule") {
        const cad = rh(Math.max(900, rng.gauss(1850, 220)), 2);
        push({
          at: atClock(day, 8, 15),
          person: individual,
          direction: "OUT",
          channel: "EFT",
          cad,
          typology: "rent",
          purpose: "Rent",
          beneficiary: "Landlord",
          flowId: "",
          counterparty: "Landlord",
          counterpartyCountry: "CA",
          counterpartyBank: "Sentinel Bank",
          counterpartyCity: individual.city,
        });
      }
      if (day.getUTCDate() === 15 && individual.persona !== "msb_agent" && individual.persona !== "mule") {
        const cad = rh(Math.min(480, Math.max(60, rng.gauss(140, 30))), 2);
        push({
          at: atClock(day, 7, 40),
          person: individual,
          direction: "OUT",
          channel: "EFT",
          cad,
          typology: "bill",
          purpose: "Bill payment",
          beneficiary: "Utilities",
          flowId: "",
          counterparty: "Utilities",
          counterpartyCountry: "CA",
          counterpartyBank: "Sentinel Bank",
          counterpartyCity: individual.city,
          mcc: "4900",
        });
      }
    }
  }

  const planted = plantIndicators(controls, people, anchor);
  for (const draft of [...planted, ...extra]) push(draft);
  rows.sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id));
  return { rows, people, byName };
}

function plantIndicators(controls: SimControls, people: Persona[], anchor: Date): Draft[] {
  const drafts: Draft[] = [];
  const nudge = (amount: number, cap = 9900) => rh(Math.min(cap, amount + controls.intensity * 400), 2);
  const onDay = (preferred: number) => addDays(anchor, Math.min(preferred, controls.days - 1));
  const structuringSubject = preferCity(people, "msb_agent", controls.focusCity, 0);

  if (controls.structuring) {
    const start = atClock(onDay(4), 9, 12);
    [8200, 7600, 9100, 6400].forEach((amount, index) => {
      const when = new Date(start.getTime() + index * 10 * 3600000);
      drafts.push({
        at: when,
        person: structuringSubject,
        direction: "IN",
        channel: "CASH",
        cad: nudge(amount),
        typology: "structuring",
        purpose: "Cash purchase under the large-cash line",
        beneficiary: "Harbour Counter",
        flowId: "struct-1",
        counterparty: "Harbour Counter",
        counterpartyCountry: "CA",
        counterpartyBank: "Sentinel Bank",
        counterpartyCity: structuringSubject.city,
      });
    });
    const ring = onDay(5);
    ["small_business", "student", "retiree"].forEach((persona, index) => {
      const individual = preferCity(people, persona, controls.focusCity, 0);
      const amount = [4200, 3800, 4600][index];
      drafts.push({
        at: atClock(ring, 11 + index, 15),
        person: individual,
        direction: "IN",
        channel: "CASH",
        cad: amount,
        typology: "structuring",
        purpose: "Cash under the large-cash line",
        beneficiary: "North Wharf MSB",
        flowId: "struct-smurf",
        counterparty: "North Wharf MSB",
        counterpartyCountry: "CA",
        counterpartyBank: "Sentinel Bank",
        counterpartyCity: individual.city,
      });
    });
  }

  if (controls.layering) {
    const subject = preferCity(people, "crypto_native", controls.focusCity, 0);
    const start = onDay(8);
    const hops = [
      { cad: 18400, country: "US", bank: "First Hudson NY", city: "New York" },
      { cad: 17120, country: "GB", bank: "Thames Correspondent", city: "London" },
      { cad: 16340, country: "AE", bank: "Gulf Clearing", city: "Dubai" },
      { cad: 15110, country: "HK", bank: "Harbour Trading Bank", city: "Hong Kong" },
    ];
    hops.forEach((hop, index) => {
      drafts.push({
        at: atClock(start, 1, 20 + index * 15),
        person: subject,
        direction: "OUT",
        channel: "VIRTUAL_CURRENCY",
        cad: hop.cad,
        typology: "layering",
        purpose: "Successive correspondent hop",
        beneficiary: hop.bank,
        flowId: "layer-1",
        asset: "BTC",
        counterparty: hop.bank,
        counterpartyCountry: hop.country,
        counterpartyBank: hop.bank,
        counterpartyCity: hop.city,
      });
    });
  }

  if (controls.mules) {
    const mule = preferCity(people, "mule", controls.focusCity, 0);
    const recruit = preferCity(people, "mule", controls.focusCity, 1);
    const start = onDay(6);
    [2100, 1800, 2400, 1950].forEach((amount, index) => {
      const sender = people[index % people.length];
      drafts.push({
        at: atClock(start, 22, 5 + index * 18),
        person: mule,
        direction: "IN",
        channel: "E_TRANSFER",
        cad: amount,
        typology: "mule",
        purpose: "Interac receipt from a separate customer",
        beneficiary: sender.name,
        flowId: "mule-1",
        counterparty: sender.name,
        counterpartyCountry: "CA",
        counterpartyBank: "Interac",
        counterpartyCity: sender.city,
      });
    });
    const next = addDays(start, 1);
    [2600, 2400, 2200].forEach((amount, index) => {
      drafts.push({
        at: atClock(next, 1, 10 + index * 15),
        person: mule,
        direction: "OUT",
        channel: "VIRTUAL_CURRENCY",
        cad: amount,
        typology: "mule",
        purpose: "Fan-out after the e-Transfer cluster",
        beneficiary: "North Sea Digital",
        flowId: "mule-1",
        asset: "USDT",
        counterparty: "North Sea Digital",
        counterpartyCountry: "LT",
        counterpartyBank: "North Sea Digital",
        counterpartyCity: "Vilnius",
        mcc: "6051",
      });
    });
    const opened = onDay(Math.min(12, controls.days - 1));
    [900, 1100, 1300, 1000].forEach((amount, index) => {
      const sender = people[(index + 3) % people.length];
      drafts.push({
        at: atClock(addDays(opened, index === 3 ? 1 : 0), 20, 8 + index * 12),
        person: recruit.name === mule.name ? findPersona(people, "student", 0) : recruit,
        direction: "IN",
        channel: "E_TRANSFER",
        cad: amount,
        typology: "mule",
        purpose: "Account starts receiving e-Transfers",
        beneficiary: sender.name,
        flowId: "mule-recruit",
        counterparty: sender.name,
        counterpartyCountry: "CA",
        counterpartyBank: "Interac",
        counterpartyCity: sender.city,
      });
    });
    const host = recruit.name === mule.name ? findPersona(people, "student", 0) : recruit;
    drafts.push({
      at: atClock(addDays(opened, 1), 23, 40),
      person: host,
      direction: "OUT",
      channel: "WIRE",
      cad: 3600,
      typology: "mule",
      purpose: "Wire leaves after the new receipts",
      beneficiary: "First Hudson NY",
      flowId: "mule-recruit",
      counterparty: "First Hudson NY",
      counterpartyCountry: "US",
      counterpartyBank: "First Hudson NY",
      counterpartyCity: "New York",
    });
    drafts.push({
      at: atClock(addDays(opened, 1), 23, 55),
      person: host,
      direction: "OUT",
      channel: "VIRTUAL_CURRENCY",
      cad: 2800,
      typology: "mule",
      purpose: "Second leg leaves the new account",
      beneficiary: "Maple Exchange",
      flowId: "mule-recruit",
      asset: "USDT",
      counterparty: "Maple Exchange",
      counterpartyCountry: "CA",
      counterpartyBank: "Maple Exchange",
      counterpartyCity: "Toronto",
      mcc: "6051",
    });
  }

  if (controls.trade) {
    const importer = preferCity(people, "importer", controls.focusCity, 0);
    const start = onDay(10);
    [
      { cad: 48000, day: 0, purpose: "Commercial invoice — over stated value" },
      { cad: 125000, day: 1, purpose: "Commercial invoice — electronics" },
    ].forEach((item) => {
      drafts.push({
        at: atClock(addDays(start, item.day), 14, 0),
        person: importer,
        direction: "OUT",
        channel: "EFT",
        cad: item.cad,
        typology: "trade",
        purpose: item.purpose,
        beneficiary: "Harbour Trading Ltd",
        flowId: "trade-1",
        counterparty: "Harbour Trading Ltd",
        counterpartyCountry: "HK",
        counterpartyBank: "Harbour Trading Bank",
        counterpartyCity: "Hong Kong",
      });
    });
    if (controls.intensity >= 0.5) {
      drafts.push({
        at: atClock(addDays(start, 3), 11, 30),
        person: importer,
        direction: "OUT",
        channel: "WIRE",
        cad: 12000,
        typology: "trade",
        purpose: "Commercial invoice — under stated value",
        beneficiary: "Pearl River Clearing",
        flowId: "trade-under",
        counterparty: "Pearl River Clearing",
        counterpartyCountry: "CN",
        counterpartyBank: "Pearl River Clearing",
        counterpartyCity: "Shenzhen",
      });
    }
  }

  if (controls.offramp) {
    const subject = preferCity(people, "crypto_native", controls.focusCity, 1);
    const start = onDay(12);
    const first = atClock(start, 3, 40);
    const second = new Date(first.getTime() + 2 * 3600000);
    drafts.push({
      at: first,
      person: subject,
      direction: "IN",
      channel: "VIRTUAL_CURRENCY",
      cad: 22000,
      typology: "crypto_offramp",
      purpose: "Stablecoin receipt",
      beneficiary: "Maple Exchange",
      flowId: "offramp-1",
      asset: "USDT",
      counterparty: "Maple Exchange",
      counterpartyCountry: "CA",
      counterpartyBank: "Maple Exchange",
      counterpartyCity: "Toronto",
      mcc: "6051",
    });
    drafts.push({
      at: second,
      person: subject,
      direction: "OUT",
      channel: "EFT",
      cad: 20500,
      typology: "crypto_offramp",
      purpose: "Fiat leaves after the virtual-currency receipt",
      beneficiary: "Sentinel Wire Desk",
      flowId: "offramp-1",
      counterparty: "Sentinel Wire Desk",
      counterpartyCountry: "CA",
      counterpartyBank: "Sentinel Bank",
      counterpartyCity: subject.city,
    });
  }

  if (controls.roundTrip) {
    const trio = [0, 4, 7].map((index) => people[index % people.length]);
    const start = onDay(3);
    const hops: [Persona, Persona, number][] = [
      [trio[0], trio[1], 6400],
      [trio[1], trio[2], 6100],
      [trio[2], trio[0], 5950],
    ];
    hops.forEach(([sender, receiver, amount], index) => {
      const when = new Date(atClock(start, 16, 10).getTime() + index * 8 * 3600000);
      drafts.push({
        at: when,
        person: sender,
        direction: "OUT",
        channel: "VIRTUAL_CURRENCY",
        cad: amount,
        typology: "round_trip",
        purpose: `Transfer toward ${receiver.name}`,
        beneficiary: receiver.name,
        flowId: "round-1",
        asset: "ETH",
        counterparty: receiver.name,
        counterpartyCountry: "CA",
        counterpartyBank: "Maple Exchange",
        counterpartyCity: receiver.city,
      });
    });
  }

  if (controls.funnel) {
    const host = findPersona(people, "small_business", 1);
    const start = onDay(9);
    [800, 950, 1100, 700, 1250, 990].forEach((amount, index) => {
      const sender = people[index % people.length];
      drafts.push({
        at: atClock(addDays(start, index > 3 ? 1 : 0), 10 + (index % 4), 5 + index),
        person: host,
        direction: "IN",
        channel: "E_TRANSFER",
        cad: amount,
        typology: "funnel",
        purpose: "Small receipt into one account",
        beneficiary: sender.name,
        flowId: "funnel-1",
        counterparty: sender.name,
        counterpartyCountry: "CA",
        counterpartyBank: "Interac",
        counterpartyCity: sender.city,
      });
    });
    drafts.push({
      at: atClock(addDays(start, 1), 18, 20),
      person: host,
      direction: "OUT",
      channel: "WIRE",
      cad: 5000,
      typology: "funnel",
      purpose: "One wire leaves after the small receipts",
      beneficiary: "Gulf Clearing",
      flowId: "funnel-1",
      counterparty: "Gulf Clearing",
      counterpartyCountry: "AE",
      counterpartyBank: "Gulf Clearing",
      counterpartyCity: "Dubai",
    });
  }

  if (controls.rapid) {
    const subject = findPersona(people, "salaried", 2);
    const start = onDay(7);
    drafts.push({
      at: atClock(start, 10, 5),
      person: subject,
      direction: "IN",
      channel: "EFT",
      cad: 18000,
      typology: "rapid",
      purpose: "Incoming client settlement",
      beneficiary: "Client settlement",
      flowId: "rapid-1",
      counterparty: "Client settlement",
      counterpartyCountry: "CA",
      counterpartyBank: "Sentinel Bank",
      counterpartyCity: subject.city,
    });
    drafts.push({
      at: atClock(start, 11, 35),
      person: subject,
      direction: "OUT",
      channel: "WIRE",
      cad: 17000,
      typology: "rapid",
      purpose: "Wire leaves inside two hours",
      beneficiary: "Sentinel Wire Desk",
      flowId: "rapid-1",
      counterparty: "Sentinel Wire Desk",
      counterpartyCountry: "CA",
      counterpartyBank: "Sentinel Bank",
      counterpartyCity: "Toronto",
    });
  }

  if (controls.professional) {
    const blocked = new Set([structuringSubject.name, findPersona(people, "mule", 0).name]);
    const person = people.find((item) => item.persona === "salaried" && !blocked.has(item.name)) ?? people.find((item) => !blocked.has(item.name)) ?? people[0];
    const start = onDay(11);
    [8700, 9100, 8400].forEach((amount, index) => {
      drafts.push({
        at: atClock(start, 13 + index, 20),
        person,
        direction: "IN",
        channel: "CASH",
        cad: nudge(amount),
        typology: "professional",
        purpose: "Cash placed for a coordinated book",
        beneficiary: "Harbour Counter",
        flowId: "pro-1",
        counterparty: "Harbour Counter",
        counterpartyCountry: "CA",
        counterpartyBank: "Sentinel Bank",
        counterpartyCity: person.city,
      });
    });
    drafts.push({
      at: atClock(addDays(start, 2), 15, 10),
      person,
      direction: "OUT",
      channel: "WIRE",
      cad: 45000,
      typology: "professional",
      purpose: "Cross-border wire after the cash cluster",
      beneficiary: "Gulf Clearing",
      flowId: "pro-1",
      counterparty: "Gulf Clearing",
      counterpartyCountry: "AE",
      counterpartyBank: "Gulf Clearing",
      counterpartyCity: "Dubai",
    });
  }

  if (controls.camouflage >= 0.1) {
    const freelancer = findPersona(people, "student", 0);
    [180, 240, 310].forEach((amount, index) => {
      drafts.push({
        at: atClock(onDay(2), 15, 10 + index * 20),
        person: freelancer,
        direction: "IN",
        channel: "E_TRANSFER",
        cad: amount,
        typology: "lookalike",
        purpose: "Freelance payment",
        beneficiary: "Client",
        flowId: "look-freelance",
        camouflage: true,
        counterparty: "Client",
        counterpartyCountry: "CA",
        counterpartyBank: "Interac",
        counterpartyCity: freelancer.city,
      });
    });
  }
  if (controls.camouflage >= 0.25) {
    const cafe = findPersona(people, "small_business", 1);
    [4200, 3800, 3600].forEach((amount, index) => {
      drafts.push({
        at: atClock(onDay(16), 16, 5 + index * 25),
        person: cafe,
        direction: "IN",
        channel: "CASH",
        cad: amount,
        typology: "lookalike",
        purpose: "Weekend till deposit",
        beneficiary: "King West Provisions",
        flowId: "look-cafe",
        camouflage: true,
        counterparty: "King West Provisions",
        counterpartyCountry: "CA",
        counterpartyBank: "Sentinel Bank",
        counterpartyCity: cafe.city,
      });
    });
  }
  if (controls.camouflage >= 0.5) {
    const importer = findPersona(people, "importer", 0);
    drafts.push({
      at: atClock(onDay(18), 13, 45),
      person: importer,
      direction: "OUT",
      channel: "EFT",
      cad: 22000,
      typology: "lookalike",
      purpose: "Recurring supplier payment",
      beneficiary: "Harbour Trading Ltd",
      flowId: "look-supplier",
      camouflage: true,
      counterparty: "Harbour Trading Ltd",
      counterpartyCountry: "HK",
      counterpartyBank: "Harbour Trading Bank",
      counterpartyCity: "Hong Kong",
    });
  }
  if (controls.camouflage >= 0.8 && controls.structuring) {
    const subject = structuringSubject;
    [4500, 4700].forEach((amount, index) => {
      drafts.push({
        at: atClock(addDays(onDay(14), index * 3), 18, 10),
        person: subject,
        direction: "IN",
        channel: "CASH",
        cad: amount,
        typology: "structuring",
        purpose: "Two deposits spread across the week",
        beneficiary: "Harbour Counter",
        flowId: "struct-subtle",
        camouflage: true,
        counterparty: "Harbour Counter",
        counterpartyCountry: "CA",
        counterpartyBank: "Sentinel Bank",
        counterpartyCity: subject.city,
      });
    });
  }
  return drafts;
}

function groups(rows: SimTxn[], hours: number) {
  const ordered = [...rows].sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id));
  const found: SimTxn[][] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const start = parseAt(ordered[index].at);
    const group: SimTxn[] = [];
    for (const row of ordered.slice(index)) {
      if (parseAt(row.at) - start <= hours * 3600000) group.push(row);
      else break;
    }
    found.push(group);
  }
  return found;
}

function sumCad(rows: SimTxn[]) {
  return rh(rows.reduce((total, row) => total + row.cad, 0), 2);
}

function makeHit(ruleId: string, title: string, customer: string, detail: string, rows: SimTxn[], all: SimTxn[]): SimHit {
  const txnIds = rows.map((row) => row.id);
  const planted = [...new Set(rows.map((row) => row.typology))];
  const suspicious = rows.some((row) => row.groundTruth === "suspicious");
  const flows = new Set(rows.map((row) => row.flowId).filter(Boolean));
  const missedIds = all.filter((row) => row.flowId && flows.has(row.flowId) && !txnIds.includes(row.id)).map((row) => row.id);
  const truth = suspicious
    ? `Planted label: ${planted.filter((item) => !BENIGN.has(item)).join(", ") || planted.join(", ")}. This is a synthetic indicator, not a finding about a real person.`
    : "No planted suspicious label on these transactions. The rule matched activity that can also be ordinary.";
  return { ruleId, title, customer, detail, cad: sumCad(rows), txnIds, planted, truth, caught: detail, missedIds };
}

export function evaluateBook(transactions: SimTxn[]): SimHit[] {
  const hits: SimHit[] = [];
  const byCustomer = new Map<string, SimTxn[]>();
  for (const row of transactions) {
    const list = byCustomer.get(row.customer) ?? [];
    list.push(row);
    byCustomer.set(row.customer, list);
  }

  for (const [customer, rows] of byCustomer) {
    const cashIn = rows.filter((row) => row.channel === "CASH" && row.direction === "IN");
    const singles = cashIn.filter((row) => row.cad >= 10000);
    if (singles.length) hits.push(makeHit("AML-FI-001", "Large cash receipt", customer, "A cash receipt is at or above CAD 10,000.", singles.slice(0, 1), transactions));
    else {
      for (const group of groups(cashIn, 24)) {
        if (sumCad(group) >= 10000) {
          hits.push(makeHit("AML-FI-001", "Large cash receipts in 24 hours", customer, "Cash receipts aggregate to CAD 10,000 in 24 hours.", group, transactions));
          break;
        }
      }
    }
    const structured = cashIn.filter((row) => row.cad >= 2000 && row.cad < 10000);
    for (const group of groups(structured, 48)) {
      const total = sumCad(group);
      if (group.length >= 3 && total >= 10000) {
        hits.push(makeHit("AML-FI-003", "Cash structured under CAD 10,000", customer, `${group.length} cash receipts sit under CAD 10,000 and total CAD ${total.toFixed(2)} within 48 hours.`, group, transactions));
        break;
      }
    }
    const international = rows.filter((row) => (row.channel === "EFT" || row.channel === "WIRE") && row.counterpartyCountry !== "CA");
    for (const direction of ["IN", "OUT"] as const) {
      const subset = international.filter((row) => row.direction === direction);
      const large = subset.filter((row) => row.cad >= 10000);
      if (large.length) {
        hits.push(makeHit("AML-FI-002", "International EFT at the reporting line", customer, "An international EFT or wire is at or above CAD 10,000.", large.slice(0, 1), transactions));
        continue;
      }
      for (const group of groups(subset, 24)) {
        if (sumCad(group) >= 10000) {
          hits.push(makeHit("AML-FI-002", "International EFTs in 24 hours", customer, "International EFTs in one direction aggregate to CAD 10,000.", group, transactions));
          break;
        }
      }
    }
    for (const inflow of [...rows].sort((left, right) => left.at.localeCompare(right.at))) {
      if (inflow.direction !== "IN" || inflow.cad < 5000) continue;
      const start = parseAt(inflow.at);
      const other = rows.filter((row) => row.direction === "OUT" && row.channel !== inflow.channel && parseAt(row.at) >= start && parseAt(row.at) - start <= 6 * 3600000);
      const moved = sumCad(other);
      if (other.length && moved >= quantize(0.7 * inflow.cad)) {
        hits.push(makeHit("AML-FI-004", "Value left on a different rail within 6 hours", customer, `CAD ${inflow.cad.toFixed(2)} came in on ${inflow.channel} and CAD ${moved.toFixed(2)} left on another rail.`, [inflow, ...other], transactions));
        break;
      }
    }

    const vcOut = rows.filter((row) => row.channel === "VIRTUAL_CURRENCY" && row.direction === "OUT");
    for (const group of groups(vcOut, 6)) {
      const decreasing = group.every((row, index) => index === 0 || row.cad <= group[index - 1].cad * 1.02);
      if (group.length >= 3 && sumCad(group) >= 10000 && decreasing) {
        hits.push(makeHit("TYPOLOGY-LAYERING", "Layering chain", customer, `${group.length} virtual-currency hops leave in a short window, amounts stepping down.`, group, transactions));
        break;
      }
    }

    for (const group of groups(rows, 18)) {
      const ins = group.filter((row) => row.direction === "IN" && row.channel === "E_TRANSFER");
      const outs = group.filter((row) => row.direction === "OUT" && (row.channel === "VIRTUAL_CURRENCY" || row.channel === "WIRE" || row.channel === "EFT"));
      const from = new Set(ins.map((row) => row.counterparty));
      if (ins.length >= 4 && from.size >= 3 && sumCad(ins) >= 5000 && outs.length >= 2 && sumCad(outs) >= quantize(0.6 * sumCad(ins))) {
        hits.push(makeHit("TYPOLOGY-MULE", "Mule fan-in then fan-out", customer, `${ins.length} e-Transfers arrive from ${from.size} counterparties, then ${outs.length} payments leave.`, [...ins, ...outs], transactions));
        break;
      }
    }

    const vcIn = rows.filter((row) => row.channel === "VIRTUAL_CURRENCY" && row.direction === "IN" && row.cad >= 8000);
    for (const inflow of vcIn) {
      const start = parseAt(inflow.at);
      const outs = rows.filter((row) => (row.channel === "EFT" || row.channel === "WIRE") && row.direction === "OUT" && parseAt(row.at) >= start && parseAt(row.at) - start <= 8 * 3600000);
      if (sumCad(outs) >= quantize(0.7 * inflow.cad)) {
        hits.push(makeHit("TYPOLOGY-OFFRAMP", "Virtual currency to fiat off-ramp", customer, "Stablecoin in, fiat out inside a few hours.", [inflow, ...outs], transactions));
        break;
      }
    }

    for (const inflow of rows.filter((row) => row.direction === "IN" && row.cad >= 8000 && row.channel !== "VIRTUAL_CURRENCY")) {
      const start = parseAt(inflow.at);
      const outs = rows.filter((row) => row.direction === "OUT" && row.channel !== inflow.channel && parseAt(row.at) >= start && parseAt(row.at) - start <= 3 * 3600000);
      if (sumCad(outs) >= quantize(0.85 * inflow.cad)) {
        hits.push(makeHit("TYPOLOGY-RAPID", "Rapid movement in and out", customer, "Most of a large receipt leaves on another rail inside three hours.", [inflow, ...outs], transactions));
        break;
      }
    }

    for (const group of groups(rows, 72)) {
      const ins = group.filter((row) => row.direction === "IN" && row.channel === "E_TRANSFER" && row.cad < 3000);
      const distinct = new Set(ins.map((row) => row.counterparty));
      if (ins.length < 5 || distinct.size < 5 || sumCad(ins) < 4000) continue;
      const last = ins[ins.length - 1];
      const end = parseAt(last.at);
      const wire = rows.find((row) => row.direction === "OUT" && (row.channel === "WIRE" || row.channel === "EFT") && parseAt(row.at) >= end && parseAt(row.at) - end <= 24 * 3600000 && row.cad >= quantize(0.8 * sumCad(ins)) && row.cad >= 4000);
      if (wire) {
        hits.push(makeHit("TYPOLOGY-FUNNEL", "Funnel account", customer, `${distinct.size} small receipts, then one larger payment leaves.`, [...ins, wire], transactions));
        break;
      }
    }

    const cluster = groups(structured, 48).find((group) => group.length >= 3 && sumCad(group) >= 10000);
    if (cluster) {
      const start = parseAt(cluster[0].at);
      const wire = rows.find((row) => (row.channel === "WIRE" || row.channel === "EFT") && row.counterpartyCountry !== "CA" && row.cad >= 20000 && Math.abs(parseAt(row.at) - start) <= 7 * 86400000);
      if (wire) hits.push(makeHit("TYPOLOGY-PROFESSIONAL", "Coordinated cash then cross-border wire", customer, "Sub-threshold cash and a large international wire land on the same customer inside a week.", [...cluster, wire], transactions));
    }
  }

  const byBeneficiary = new Map<string, SimTxn[]>();
  for (const row of transactions) {
    if (row.channel === "CASH" && row.direction === "IN" && row.cad < 10000 && row.beneficiary) {
      const list = byBeneficiary.get(row.beneficiary) ?? [];
      list.push(row);
      byBeneficiary.set(row.beneficiary, list);
    }
  }
  for (const [beneficiary, rows] of byBeneficiary) {
    for (const group of groups(rows, 24)) {
      const customers = new Set(group.map((row) => row.customer));
      const total = sumCad(group);
      if (customers.size >= 3 && total >= 10000) {
        hits.push(makeHit("AML-FI-005", "Several customers placed sub-threshold cash", beneficiary, `${customers.size} customers placed cash under CAD 10,000 with one beneficiary, totalling CAD ${total.toFixed(2)}.`, group, transactions));
        break;
      }
    }
  }

  const wires = transactions.filter((row) => (row.channel === "EFT" || row.channel === "WIRE") && row.direction === "OUT" && row.counterpartyCountry !== "CA" && row.cad >= 20000 && row.cad % 100 === 0);
  const byTrade = new Map<string, SimTxn[]>();
  for (const row of wires) {
    const key = `${row.customer}|${row.beneficiary}`;
    const list = byTrade.get(key) ?? [];
    list.push(row);
    byTrade.set(key, list);
  }
  for (const rows of byTrade.values()) {
    for (const group of groups(rows, 24 * 10)) {
      if (group.length >= 2) {
        hits.push(makeHit("TYPOLOGY-TBML", "Trade invoice pattern", group[0].customer, "Round commercial wires to the same trading counterparty.", group, transactions));
        break;
      }
    }
  }

  const outs = transactions.filter((row) => row.direction === "OUT" && row.beneficiary && row.cad >= 4000);
  const bySender = new Map<string, SimTxn[]>();
  for (const row of outs) {
    const list = bySender.get(row.customer) ?? [];
    list.push(row);
    bySender.set(row.customer, list);
  }
  let roundFound = false;
  for (const first of outs) {
    if (roundFound) break;
    const start = parseAt(first.at);
    const secondPool = (bySender.get(first.beneficiary) ?? []).filter((row) => parseAt(row.at) >= start && parseAt(row.at) - start <= 36 * 3600000);
    for (const second of secondPool) {
      const thirdPool = (bySender.get(second.beneficiary) ?? []).filter((row) => row.beneficiary === first.customer && parseAt(row.at) >= parseAt(second.at) && parseAt(row.at) - start <= 36 * 3600000);
      for (const third of thirdPool) {
        const amounts = [first.cad, second.cad, third.cad];
        const peak = Math.max(...amounts);
        if (amounts.every((amount) => amount >= peak * 0.85)) {
          hits.push(makeHit("TYPOLOGY-ROUNDTRIP", "Round-trip across customers", third.beneficiary || first.customer, "Value circles back at nearly the same amount.", [first, second, third], transactions));
          roundFound = true;
          break;
        }
      }
      if (roundFound) break;
    }
  }

  hits.sort((left, right) => left.ruleId.localeCompare(right.ruleId) || left.customer.localeCompare(right.customer) || left.txnIds[0].localeCompare(right.txnIds[0]));
  return hits;
}

function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const mid = Math.floor(ordered.length / 2);
  if (ordered.length % 2) return rh(ordered[mid], 2);
  return rh((ordered[mid - 1] + ordered[mid]) / 2, 2);
}

export function scoreBook(transactions: SimTxn[], hits: SimHit[]): Evaluation {
  const flagged = new Set(hits.flatMap((hit) => hit.txnIds));
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const row of transactions) {
    const suspicious = row.groundTruth === "suspicious";
    const hit = flagged.has(row.id);
    if (suspicious && hit) tp += 1;
    else if (suspicious && !hit) fn += 1;
    else if (!suspicious && hit) fp += 1;
    else tn += 1;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const alertTp = hits.filter((hit) => hit.txnIds.some((id) => transactions.find((row) => row.id === id)?.groundTruth === "suspicious")).length;
  const plants = new Map<string, SimTxn[]>();
  for (const row of transactions) {
    if (row.groundTruth !== "suspicious") continue;
    const key = row.flowId || `${row.typology}:${row.customer}`;
    const list = plants.get(key) ?? [];
    list.push(row);
    plants.set(key, list);
  }
  const byType = new Map<string, { plants: number; detected: number }>();
  const times: Evaluation["times"] = [];
  for (const [flowId, rows] of plants) {
    const typology = rows[0].typology;
    const bucket = byType.get(typology) ?? { plants: 0, detected: 0 };
    bucket.plants += 1;
    const detected = rows.some((row) => flagged.has(row.id));
    if (detected) bucket.detected += 1;
    byType.set(typology, bucket);
    const first = [...rows].sort((left, right) => left.at.localeCompare(right.at))[0];
    let hours: number | null = null;
    if (detected) {
      const covering = hits.filter((hit) => hit.txnIds.some((id) => rows.some((row) => row.id === id)));
      const detectAt = covering
        .map((hit) => hit.txnIds.map((id) => transactions.find((row) => row.id === id)?.at || "").sort().at(-1) || "")
        .filter(Boolean)
        .sort()[0];
      if (detectAt) hours = rh((parseAt(detectAt) - parseAt(first.at)) / 3600000, 2);
    }
    times.push({ flowId, typology, hours, detected });
  }
  const byTypology = [...byType.entries()]
    .map(([typology, bucket]) => ({ typology, plants: bucket.plants, detected: bucket.detected, rate: bucket.plants ? rh(bucket.detected / bucket.plants, 4) : 0 }))
    .sort((left, right) => left.typology.localeCompare(right.typology));
  return {
    tp, fp, tn, fn,
    precision: rh(precision, 4),
    recall: rh(recall, 4),
    f1: rh(f1, 4),
    alertPrecision: rh(hits.length ? alertTp / hits.length : 0, 4),
    alerts: hits.length,
    byTypology,
    medianHoursToDetect: median(times.map((item) => item.hours).filter((item): item is number => item !== null)),
    times,
  };
}

function summarize(controls: SimControls, rows: SimTxn[], hits: SimHit[], customers: SimCustomer[]): SimBook {
  const byHour = Array(24).fill(0);
  const byChannel: Record<string, number> = {};
  const byTypology: Record<string, number> = {};
  const byProvince: Record<string, number> = {};
  let cadTotal = 0;
  for (const row of rows) {
    byHour[Number(row.at.slice(11, 13))] += 1;
    byChannel[row.channel] = (byChannel[row.channel] ?? 0) + 1;
    byTypology[row.typology] = (byTypology[row.typology] ?? 0) + 1;
    byProvince[row.province] = (byProvince[row.province] ?? 0) + 1;
    cadTotal += row.cad;
  }
  const end = addDays(anchorDate(), controls.days - 1);
  return {
    disclaimer: DISCLAIMER,
    controls,
    summary: {
      transactions: rows.length,
      customers: customers.length,
      cadTotal: rh(cadTotal, 2),
      hitCount: hits.length,
      byChannel,
      byHour,
      byTypology,
      byProvince,
      windowStart: ANCHOR_ISO,
      windowEnd: iso(end),
    },
    customers,
    directory: {
      merchants: MERCHANTS.map((item) => ({ name: item.name, mcc: item.mcc, city: item.city, category: item.category })),
      correspondents: CORRESPONDENTS.map((item) => ({ name: item.name, country: item.country, city: item.city })),
      exchanges: EXCHANGES.map((item) => ({ name: item.name, country: item.country, city: item.city })),
    },
    hits,
    transactions: rows,
    evaluation: scoreBook(rows, hits),
  };
}

export function simulateBook(raw: Loose = {}): SimBook {
  const controls = clampControls(raw);
  const { rows, people } = buildRows(controls);
  const customers = people.map((person, index) => toCustomer(person, index, controls.seed));
  const hits = evaluateBook(rows);
  return summarize(controls, rows, hits, customers);
}

function materialize(controls: SimControls, drafts: Draft[], serialStart: number) {
  const people = PERSONAS.slice(0, controls.customers);
  const profiles = new Map(people.map((person, index) => [person.name, toCustomer(person, index, controls.seed)]));
  const rates = dayRates(makeRng((controls.seed + 10007) >>> 0), 0);
  return drafts.map((draft, index) => {
    const profile = profiles.get(draft.person.name) ?? toCustomer(draft.person, 0, controls.seed);
    const cad = rh(draft.cad, 2);
    let asset = "CAD";
    let fxRate = 1;
    let amountAsset = cad;
    if (draft.channel === "VIRTUAL_CURRENCY") {
      asset = draft.asset || "BTC";
      fxRate = rh(rates[asset] || BASE_RATES[asset] || 1, 4);
      amountAsset = rh(cad / (rates[asset] || BASE_RATES[asset] || 1), 8);
    }
    const row: SimTxn = {
      id: `sim-${controls.seed}-x${String(serialStart + index + 1).padStart(3, "0")}`,
      at: stamp(draft.at),
      customer: draft.person.name,
      persona: draft.person.persona,
      occupation: profile.occupation,
      incomeBand: profile.incomeBand,
      accountType: draft.channel === "VIRTUAL_CURRENCY" ? "vc_wallet" : profile.accountType,
      accountNumber: profile.accountNumber,
      city: draft.person.city,
      province: draft.person.province,
      country: "CA",
      postal: profile.postal,
      direction: draft.direction,
      channel: draft.channel,
      method: METHOD[draft.channel] ?? "Online",
      disposition: dispositionFor(draft.channel, draft.direction),
      asset,
      amountAsset,
      fxRate,
      cad,
      mcc: draft.mcc ?? "",
      counterparty: draft.counterparty ?? "",
      counterpartyCountry: draft.counterpartyCountry ?? "CA",
      counterpartyBank: draft.counterpartyBank ?? "",
      counterpartyCity: draft.counterpartyCity ?? "",
      purpose: draft.purpose,
      conductor: draft.person.name,
      beneficiary: draft.beneficiary,
      thresholdIndicator: cad >= 10000,
      typology: draft.typology,
      groundTruth: BENIGN.has(draft.typology) ? "benign" : "suspicious",
      camouflage: Boolean(draft.camouflage),
      flowId: draft.flowId,
    };
    return row;
  });
}

export function injectPlant(book: SimBook, typology: string, at: string): SimBook {
  const people = PERSONAS.slice(0, book.controls.customers);
  const when = new Date(`${at.slice(0, 19)}Z`);
  const host = people[Math.min(2, people.length - 1)];
  const prior = book.transactions.filter((row) => row.flowId.startsWith("inject-")).length;
  const flowId = `inject-${typology}-${prior + 1}`;
  const drafts: Draft[] = [];
  if (typology === "layering") {
    ["US", "HK", "AE"].forEach((country, index) => {
      const bank = CORRESPONDENTS.find((item) => item.country === country) ?? CORRESPONDENTS[0];
      drafts.push({
        at: new Date(when.getTime() + index * 45 * 60000),
        person: host,
        direction: "OUT",
        channel: "VIRTUAL_CURRENCY",
        cad: 14200 - index * 800,
        typology: "layering",
        purpose: "Injected correspondent hop",
        beneficiary: bank.name,
        flowId,
        asset: "BTC",
        counterparty: bank.name,
        counterpartyCountry: bank.country,
        counterpartyBank: bank.name,
        counterpartyCity: bank.city,
      });
    });
  } else if (typology === "trade") {
    const importer = findPersona(people, "importer", 0);
    [64000, 51000].forEach((cad, index) => {
      drafts.push({
        at: new Date(when.getTime() + index * 3600000),
        person: importer,
        direction: "OUT",
        channel: "EFT",
        cad,
        typology: "trade",
        purpose: "Injected commercial invoice",
        beneficiary: "Harbour Trading Ltd",
        flowId,
        counterparty: "Harbour Trading Ltd",
        counterpartyCountry: "HK",
        counterpartyBank: "Harbour Trading Bank",
        counterpartyCity: "Hong Kong",
      });
    });
  } else if (typology === "offramp" || typology === "crypto_offramp") {
    const subject = findPersona(people, "crypto_native", 0);
    drafts.push({
      at: when,
      person: subject,
      direction: "IN",
      channel: "VIRTUAL_CURRENCY",
      cad: 22000,
      typology: "crypto_offramp",
      purpose: "Injected stablecoin receipt",
      beneficiary: "Maple Exchange",
      flowId,
      asset: "USDT",
      counterparty: "Maple Exchange",
      counterpartyCountry: "CA",
      counterpartyBank: "Maple Exchange",
      counterpartyCity: "Toronto",
      mcc: "6051",
    });
    drafts.push({
      at: new Date(when.getTime() + 2 * 3600000),
      person: subject,
      direction: "OUT",
      channel: "EFT",
      cad: 20500,
      typology: "crypto_offramp",
      purpose: "Injected fiat exit",
      beneficiary: "Sentinel Wire Desk",
      flowId,
      counterparty: "Sentinel Wire Desk",
      counterpartyCountry: "CA",
      counterpartyBank: "Sentinel Bank",
      counterpartyCity: subject.city,
    });
  } else if (typology === "round_trip" || typology === "roundTrip") {
    const trio = [0, 1, 2].map((index) => people[index % people.length]);
    const hops: [Persona, Persona, number][] = [
      [trio[0], trio[1], 6400],
      [trio[1], trio[2], 6100],
      [trio[2], trio[0], 5950],
    ];
    hops.forEach(([sender, receiver, cad], index) => {
      drafts.push({
        at: new Date(when.getTime() + index * 3600000),
        person: sender,
        direction: "OUT",
        channel: "VIRTUAL_CURRENCY",
        cad,
        typology: "round_trip",
        purpose: `Injected transfer toward ${receiver.name}`,
        beneficiary: receiver.name,
        flowId,
        asset: "ETH",
        counterparty: receiver.name,
        counterpartyCountry: "CA",
        counterpartyBank: "Maple Exchange",
        counterpartyCity: receiver.city,
      });
    });
  } else if (typology === "funnel") {
    const funnelHost = findPersona(people, "small_business", 1);
    [800, 950, 1100, 700, 1250, 990].forEach((cad, index) => {
      const sender = people[index % people.length];
      drafts.push({
        at: new Date(when.getTime() + index * 20 * 60000),
        person: funnelHost,
        direction: "IN",
        channel: "E_TRANSFER",
        cad,
        typology: "funnel",
        purpose: "Injected small receipt",
        beneficiary: sender.name,
        flowId,
        counterparty: sender.name,
        counterpartyCountry: "CA",
        counterpartyBank: "Interac",
        counterpartyCity: sender.city,
      });
    });
    drafts.push({
      at: new Date(when.getTime() + 4 * 3600000),
      person: funnelHost,
      direction: "OUT",
      channel: "WIRE",
      cad: 5200,
      typology: "funnel",
      purpose: "Injected funnel exit",
      beneficiary: "Gulf Clearing",
      flowId,
      counterparty: "Gulf Clearing",
      counterpartyCountry: "AE",
      counterpartyBank: "Gulf Clearing",
      counterpartyCity: "Dubai",
    });
  } else if (typology === "rapid") {
    drafts.push({
      at: when,
      person: host,
      direction: "IN",
      channel: "EFT",
      cad: 18000,
      typology: "rapid",
      purpose: "Injected incoming settlement",
      beneficiary: "Client settlement",
      flowId,
      counterparty: "Client settlement",
      counterpartyCountry: "CA",
      counterpartyBank: "Sentinel Bank",
      counterpartyCity: host.city,
    });
    drafts.push({
      at: new Date(when.getTime() + 90 * 60000),
      person: host,
      direction: "OUT",
      channel: "WIRE",
      cad: 17000,
      typology: "rapid",
      purpose: "Injected rapid exit",
      beneficiary: "Sentinel Wire Desk",
      flowId,
      counterparty: "Sentinel Wire Desk",
      counterpartyCountry: "CA",
      counterpartyBank: "Sentinel Bank",
      counterpartyCity: "Toronto",
    });
  } else if (typology === "professional") {
    [8700, 9100, 8400].forEach((cad, index) => {
      drafts.push({
        at: new Date(when.getTime() + index * 3600000),
        person: host,
        direction: "IN",
        channel: "CASH",
        cad,
        typology: "professional",
        purpose: "Injected cash cluster",
        beneficiary: "Harbour Counter",
        flowId,
        counterparty: "Harbour Counter",
        counterpartyCountry: "CA",
        counterpartyBank: "Sentinel Bank",
        counterpartyCity: host.city,
      });
    });
    drafts.push({
      at: new Date(when.getTime() + 5 * 3600000),
      person: host,
      direction: "OUT",
      channel: "WIRE",
      cad: 45000,
      typology: "professional",
      purpose: "Injected cross-border wire",
      beneficiary: "Gulf Clearing",
      flowId,
      counterparty: "Gulf Clearing",
      counterpartyCountry: "AE",
      counterpartyBank: "Gulf Clearing",
      counterpartyCity: "Dubai",
    });
  } else if (typology === "mules" || typology === "mule") {
    const mule = findPersona(people, "mule", 0);
    [1600, 1800, 1500, 1700].forEach((cad, index) => {
      const sender = people[(index + 1) % people.length];
      drafts.push({
        at: new Date(when.getTime() + index * 20 * 60000),
        person: mule,
        direction: "IN",
        channel: "E_TRANSFER",
        cad,
        typology: "mule",
        purpose: "Injected e-Transfer cluster",
        beneficiary: sender.name,
        flowId,
        counterparty: sender.name,
        counterpartyCountry: "CA",
        counterpartyBank: "Interac",
        counterpartyCity: sender.city,
      });
    });
    drafts.push({
      at: new Date(when.getTime() + 3 * 3600000),
      person: mule,
      direction: "OUT",
      channel: "WIRE",
      cad: 5200,
      typology: "mule",
      purpose: "Injected fan-out",
      beneficiary: "First Hudson NY",
      flowId,
      counterparty: "First Hudson NY",
      counterpartyCountry: "US",
      counterpartyBank: "First Hudson NY",
      counterpartyCity: "New York",
    });
    drafts.push({
      at: new Date(when.getTime() + 3 * 3600000 + 15 * 60000),
      person: mule,
      direction: "OUT",
      channel: "VIRTUAL_CURRENCY",
      cad: 2400,
      typology: "mule",
      purpose: "Injected fan-out",
      beneficiary: "Maple Exchange",
      flowId,
      asset: "USDT",
      counterparty: "Maple Exchange",
      counterpartyCountry: "CA",
      counterpartyBank: "Maple Exchange",
      counterpartyCity: "Toronto",
    });
  } else {
    [8600, 7900, 9100, 6400].forEach((cad, index) => {
      drafts.push({
        at: new Date(when.getTime() + index * 2 * 3600000),
        person: host,
        direction: "IN",
        channel: "CASH",
        cad,
        typology: typology === "professional" ? "professional" : "structuring",
        purpose: "Injected cash under the large-cash line",
        beneficiary: "Harbour Counter",
        flowId,
        counterparty: "Harbour Counter",
        counterpartyCountry: "CA",
        counterpartyBank: "Sentinel Bank",
        counterpartyCity: host.city,
      });
    });
  }
  const fresh = materialize(book.controls, drafts, prior);
  const transactions = [...book.transactions, ...fresh].sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id));
  const customers = people.map((person, index) => toCustomer(person, index, book.controls.seed));
  return summarize(book.controls, transactions, evaluateBook(transactions), customers);
}

export function fingerprint(book: SimBook) {
  const cents = Math.round(book.transactions.reduce((sum, row) => sum + Math.round(row.cad * 100), 0));
  const rules = book.hits.map((hit) => `${hit.ruleId}:${hit.customer}`).join(",");
  const head = book.transactions.slice(0, 5).map((row) => `${row.id}:${row.cad}:${row.channel}:${row.typology}`).join("|");
  const tail = book.transactions.slice(-3).map((row) => `${row.id}:${row.cad}:${row.typology}`).join("|");
  return `${book.transactions.length}|${cents}|${rules}|${head}|${tail}`;
}
