/**
 * Seeded synthetic book for the simulator page.
 * Planted typologies are labelled indicators. They are not a method for moving value.
 */

export type SimControls = {
  seed: number;
  days: number;
  customers: number;
  mu: number;
  sigma: number;
  seasonality: number;
  nightShare: number;
  fxVol: number;
  structuring: boolean;
  layering: boolean;
  mules: boolean;
  trade: boolean;
  offramp: boolean;
  roundTrip: boolean;
  payroll: boolean;
  rent: boolean;
};

export type SimTxn = {
  id: string;
  at: string;
  customer: string;
  persona: string;
  city: string;
  province: string;
  country: string;
  counterpartyCountry: string;
  direction: "IN" | "OUT";
  channel: "CASH" | "EFT" | "E_TRANSFER" | "VIRTUAL_CURRENCY";
  asset: string;
  amountAsset: number;
  fxRate: number;
  cad: number;
  typology: string;
  purpose: string;
  beneficiary: string;
  flowId: string;
};

export type SimHit = {
  ruleId: string;
  title: string;
  customer: string;
  detail: string;
  cad: number;
  txnIds: string[];
};

export const SIM_DEFAULTS: SimControls = {
  seed: 7,
  days: 21,
  customers: 12,
  mu: 6.2,
  sigma: 0.85,
  seasonality: 0.35,
  nightShare: 0.12,
  fxVol: 0.02,
  structuring: true,
  layering: true,
  mules: true,
  trade: true,
  offramp: true,
  roundTrip: true,
  payroll: true,
  rent: true,
};

const PERSONAS = [
  { name: "Maya Singh", persona: "salaried", city: "Toronto", province: "ON", activity: 1.15, cash: 0.05 },
  { name: "Owen Blake", persona: "salaried", city: "Ottawa", province: "ON", activity: 0.8, cash: 0.04 },
  { name: "Hana Park", persona: "student", city: "Montreal", province: "QC", activity: 0.45, cash: 0.08 },
  { name: "Louis Bergeron", persona: "retiree", city: "Quebec City", province: "QC", activity: 0.35, cash: 0.12 },
  { name: "Priya Nair", persona: "small_business", city: "Mississauga", province: "ON", activity: 1.55, cash: 0.2 },
  { name: "Noah Campbell", persona: "small_business", city: "Calgary", province: "AB", activity: 1.25, cash: 0.1 },
  { name: "Amira Haddad", persona: "importer", city: "Vancouver", province: "BC", activity: 0.7, cash: 0.04 },
  { name: "Evan Cho", persona: "crypto_native", city: "Vancouver", province: "BC", activity: 1.7, cash: 0.02 },
  { name: "Sofia Rossi", persona: "crypto_native", city: "Toronto", province: "ON", activity: 1.35, cash: 0.03 },
  { name: "Jonah Adeyemi", persona: "msb_agent", city: "Winnipeg", province: "MB", activity: 1.4, cash: 0.34 },
  { name: "Claire Beaulieu", persona: "salaried", city: "Halifax", province: "NS", activity: 0.9, cash: 0.06 },
  { name: "Mateo Alvarez", persona: "mule", city: "Edmonton", province: "AB", activity: 0.4, cash: 0.12 },
  { name: "Ravi Desai", persona: "salaried", city: "Brampton", province: "ON", activity: 1, cash: 0.05 },
  { name: "Elise Moreau", persona: "small_business", city: "Laval", province: "QC", activity: 1.1, cash: 0.16 },
  { name: "Hassan Karim", persona: "importer", city: "Toronto", province: "ON", activity: 0.6, cash: 0.05 },
  { name: "Nina Volkova", persona: "crypto_native", city: "Calgary", province: "AB", activity: 1.2, cash: 0.02 },
  { name: "Patrick Leung", persona: "salaried", city: "Richmond", province: "BC", activity: 0.95, cash: 0.04 },
  { name: "Aisha Rahman", persona: "student", city: "Waterloo", province: "ON", activity: 0.4, cash: 0.07 },
  { name: "Hugo Tremblay", persona: "retiree", city: "Sherbrooke", province: "QC", activity: 0.3, cash: 0.1 },
  { name: "Imani Brooks", persona: "msb_agent", city: "Hamilton", province: "ON", activity: 1.3, cash: 0.28 },
  { name: "Leo Martel", persona: "mule", city: "Surrey", province: "BC", activity: 0.35, cash: 0.1 },
  { name: "Chloe Nguyen", persona: "small_business", city: "Ottawa", province: "ON", activity: 1.05, cash: 0.14 },
  { name: "Samir Haddad", persona: "salaried", city: "London", province: "ON", activity: 0.85, cash: 0.05 },
  { name: "Freya Olsen", persona: "crypto_native", city: "Victoria", province: "BC", activity: 1.1, cash: 0.02 },
] as const;

type Person = (typeof PERSONAS)[number];

const RATES: Record<string, number> = { CAD: 1, BTC: 118400, ETH: 4280, USDT: 1.37, SOL: 186, LTC: 112 };
const ASSETS = ["BTC", "ETH", "USDT", "SOL", "LTC"];
const ASSET_WEIGHTS = [0.34, 0.22, 0.24, 0.12, 0.08];

function rng(seed: number) {
  let state = seed >>> 0;
  const rand = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = (center: number, sigma: number) => {
    const u = Math.max(1e-9, rand());
    const v = rand();
    return center + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { rand, gauss };
}

function poisson(rand: () => number, lam: number) {
  if (lam <= 0) return 0;
  const limit = Math.exp(-lam);
  let count = 0;
  let product = 1;
  while (product > limit && count < 12) {
    count += 1;
    product *= rand();
  }
  return Math.max(0, count - 1);
}

function hourOf(rand: () => number, nightShare: number, suspicious: boolean) {
  const weights = Array.from({ length: 24 }, (_, hour) => {
    let weight = hour >= 9 && hour <= 16 ? 5 : hour >= 7 && hour <= 19 ? 2 : 0.35;
    if (suspicious && hour < 6) weight += 6 * nightShare;
    if (!suspicious && hour < 6) weight *= Math.max(0.15, 1 - Math.min(0.85, nightShare));
    return weight;
  });
  const total = weights.reduce((sum, value) => sum + value, 0);
  let cursor = rand() * total;
  for (let hour = 0; hour < 24; hour += 1) {
    cursor -= weights[hour];
    if (cursor <= 0) return hour;
  }
  return 12;
}

function seasonOf(date: Date, seasonality: number) {
  const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6 ? 0.58 : 1;
  const monthEnd = date.getUTCDate() >= 28 ? 1 + seasonality : 1;
  const wave = 1 + seasonality * 0.22 * Math.sin((2 * Math.PI * (date.getUTCDate() % 30)) / 30);
  return weekend * monthEnd * wave;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function stamp(date: Date, hour: number, minute: number) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(hour)}:${pad(minute)}:00`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseAt(value: string) {
  return Date.parse(`${value}Z`);
}

export function evaluateBook(transactions: SimTxn[]): SimHit[] {
  const hits: SimHit[] = [];
  const byCustomer = new Map<string, SimTxn[]>();
  for (const row of transactions) {
    const list = byCustomer.get(row.customer) ?? [];
    list.push(row);
    byCustomer.set(row.customer, list);
  }

  function window(rows: SimTxn[], hours: number) {
    const ordered = [...rows].sort((left, right) => left.at.localeCompare(right.at));
    const groups: SimTxn[][] = [];
    ordered.forEach((start, index) => {
      const startAt = parseAt(start.at);
      const group: SimTxn[] = [];
      for (const row of ordered.slice(index)) {
        if (parseAt(row.at) - startAt <= hours * 3600_000) group.push(row);
        else break;
      }
      groups.push(group);
    });
    return groups;
  }

  function hit(ruleId: string, title: string, customer: string, detail: string, rows: SimTxn[]): SimHit {
    return {
      ruleId,
      title,
      customer,
      detail,
      cad: Math.round(rows.reduce((sum, row) => sum + row.cad, 0) * 100) / 100,
      txnIds: rows.map((row) => row.id),
    };
  }

  for (const [customer, rows] of byCustomer) {
    const cashIn = rows.filter((row) => row.channel === "CASH" && row.direction === "IN");
    const singles = cashIn.filter((row) => row.cad >= 10000);
    if (singles.length) hits.push(hit("AML-FI-001", "Large cash receipt", customer, "A cash receipt is at or above CAD 10,000.", singles.slice(0, 1)));
    else {
      for (const group of window(cashIn, 24)) {
        const total = group.reduce((sum, row) => sum + row.cad, 0);
        if (total >= 10000) {
          hits.push(hit("AML-FI-001", "Large cash receipts in 24 hours", customer, "Cash receipts aggregate to CAD 10,000 in 24 hours.", group));
          break;
        }
      }
    }
    const structured = cashIn.filter((row) => row.cad >= 2000 && row.cad < 10000);
    for (const group of window(structured, 48)) {
      const total = group.reduce((sum, row) => sum + row.cad, 0);
      if (group.length >= 3 && total >= 10000) {
        hits.push(hit("AML-FI-003", "Cash structured under CAD 10,000", customer, `${group.length} cash receipts sit under CAD 10,000 and total CAD ${total.toFixed(2)} within 48 hours.`, group));
        break;
      }
    }
    const international = rows.filter((row) => row.channel === "EFT" && row.counterpartyCountry !== "CA");
    for (const direction of ["IN", "OUT"] as const) {
      const subset = international.filter((row) => row.direction === direction);
      const large = subset.filter((row) => row.cad >= 10000);
      if (large.length) {
        hits.push(hit("AML-FI-002", "International EFT at the reporting line", customer, "An international EFT is at or above CAD 10,000.", large.slice(0, 1)));
        continue;
      }
      for (const group of window(subset, 24)) {
        const total = group.reduce((sum, row) => sum + row.cad, 0);
        if (total >= 10000) {
          hits.push(hit("AML-FI-002", "International EFTs in 24 hours", customer, "International EFTs in one direction aggregate to CAD 10,000.", group));
          break;
        }
      }
    }
    for (const inflow of rows) {
      if (inflow.direction !== "IN" || inflow.cad < 5000) continue;
      const start = parseAt(inflow.at);
      const other = rows.filter(
        (row) => row.direction === "OUT" && row.channel !== inflow.channel && parseAt(row.at) >= start && parseAt(row.at) - start <= 6 * 3600_000,
      );
      const moved = other.reduce((sum, row) => sum + row.cad, 0);
      if (moved >= 0.7 * inflow.cad) {
        hits.push(hit("AML-FI-004", "Value left on a different rail within 6 hours", customer, `CAD ${inflow.cad.toFixed(2)} came in on ${inflow.channel} and CAD ${moved.toFixed(2)} left on another rail.`, [inflow, ...other]));
        break;
      }
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
    const ordered = [...rows].sort((left, right) => left.at.localeCompare(right.at));
    for (let index = 0; index < ordered.length; index += 1) {
      const start = parseAt(ordered[index].at);
      const group = ordered.slice(index).filter((row) => parseAt(row.at) - start <= 24 * 3600_000);
      const customers = new Set(group.map((row) => row.customer));
      const total = group.reduce((sum, row) => sum + row.cad, 0);
      if (customers.size >= 3 && total >= 10000) {
        hits.push({
          ruleId: "AML-FI-005",
          title: "Several customers placed sub-threshold cash",
          customer: beneficiary,
          detail: `${customers.size} customers placed cash under CAD 10,000 with one beneficiary, totalling CAD ${total.toFixed(2)}.`,
          cad: Math.round(total * 100) / 100,
          txnIds: group.map((row) => row.id),
        });
        break;
      }
    }
  }

  const flows = new Map<string, SimTxn[]>();
  for (const row of transactions) {
    if (!row.flowId) continue;
    const list = flows.get(row.flowId) ?? [];
    list.push(row);
    flows.set(row.flowId, list);
  }
  for (const rows of flows.values()) {
    const ordered = [...rows].sort((left, right) => left.at.localeCompare(right.at));
    const kind = ordered[0].typology;
    const customer = ordered[0].customer;
    const total = ordered.reduce((sum, row) => sum + row.cad, 0);
    const base = { customer, cad: Math.round(total * 100) / 100, txnIds: ordered.map((row) => row.id) };
    if (kind === "layering" && ordered.length >= 3) hits.push({ ...base, ruleId: "TYPOLOGY-LAYERING", title: "Layering chain", detail: `${ordered.length} virtual-currency hops in a short window.` });
    if (kind === "mule") {
      const inbound = ordered.filter((row) => row.direction === "IN").length;
      const outbound = ordered.filter((row) => row.direction === "OUT").length;
      if (inbound >= 3 && outbound >= 2) hits.push({ ...base, ruleId: "TYPOLOGY-MULE", title: "Mule fan-in then fan-out", detail: `${inbound} receipts then ${outbound} disbursements.` });
    }
    if (kind === "trade") hits.push({ ...base, ruleId: "TYPOLOGY-TBML", title: "Trade invoice pattern", detail: "Round commercial-invoice wires to a trading counterparty." });
    if (kind === "crypto_offramp") hits.push({ ...base, ruleId: "TYPOLOGY-OFFRAMP", title: "Virtual currency to fiat off-ramp", detail: "Stablecoin in, fiat out inside a few hours." });
    if (kind === "round_trip" && new Set(ordered.map((row) => row.customer)).size >= 3) {
      hits.push({ ...base, ruleId: "TYPOLOGY-ROUNDTRIP", title: "Round-trip across customers", customer: ordered[ordered.length - 1].beneficiary || customer, detail: "Value circles back at nearly the same amount." });
    }
  }
  hits.sort((left, right) => left.ruleId.localeCompare(right.ruleId) || left.customer.localeCompare(right.customer));
  return hits;
}

export function simulateBook(raw: Partial<SimControls> = {}) {
  const controls: SimControls = { ...SIM_DEFAULTS, ...raw };
  controls.days = Math.max(7, Math.min(45, Math.round(controls.days)));
  controls.customers = Math.max(6, Math.min(24, Math.round(controls.customers)));
  const random = rng(controls.seed);
  const people = PERSONAS.slice(0, controls.customers);
  const rows: SimTxn[] = [];
  let serial = 0;
  const anchor = new Date(Date.UTC(2026, 2, 2));
  const daily = new Map<string, Record<string, number>>();

  function rates(day: Date) {
    const key = day.toISOString().slice(0, 10);
    const cached = daily.get(key);
    if (cached) return cached;
    const next: Record<string, number> = {};
    for (const [asset, base] of Object.entries(RATES)) {
      if (asset === "CAD") next[asset] = 1;
      else {
        const shock = controls.fxVol * (asset === "USDT" ? 0.15 : 1);
        next[asset] = Math.max(0.01, base * (1 + random.gauss(0, shock)));
      }
    }
    daily.set(key, next);
    return next;
  }

  function pickAsset() {
    let roll = random.rand();
    for (let index = 0; index < ASSETS.length; index += 1) {
      roll -= ASSET_WEIGHTS[index];
      if (roll <= 0) return ASSETS[index];
    }
    return "BTC";
  }

  function add(input: Omit<SimTxn, "id" | "country" | "asset" | "amountAsset" | "fxRate"> & { asset?: string; atDate: Date }) {
    serial += 1;
    const cad = Math.round(input.cad * 100) / 100;
    let asset = "CAD";
    let fxRate = 1;
    let amountAsset = cad;
    if (input.channel === "VIRTUAL_CURRENCY") {
      asset = input.asset || pickAsset();
      fxRate = rates(input.atDate)[asset];
      amountAsset = cad / fxRate;
    }
    rows.push({
      id: `sim-${controls.seed}-${String(serial).padStart(4, "0")}`,
      at: input.at,
      customer: input.customer,
      persona: input.persona,
      city: input.city,
      province: input.province,
      country: "CA",
      counterpartyCountry: input.counterpartyCountry,
      direction: input.direction,
      channel: input.channel,
      asset,
      amountAsset: Math.round(amountAsset * 1e8) / 1e8,
      fxRate: Math.round(fxRate * 10000) / 10000,
      cad,
      typology: input.typology,
      purpose: input.purpose,
      beneficiary: input.beneficiary,
      flowId: input.flowId,
    });
  }

  function person(persona: string, fallback = 0): Person {
    return people.find((item) => item.persona === persona) ?? people[fallback % people.length];
  }

  for (let offset = 0; offset < controls.days; offset += 1) {
    const day = addDays(anchor, offset);
    const scale = seasonOf(day, controls.seasonality);
    for (const individual of people) {
      const count = poisson(random.rand, individual.activity * scale * 0.85);
      for (let index = 0; index < count; index += 1) {
        const hour = hourOf(random.rand, controls.nightShare, false);
        const minute = Math.floor(random.rand() * 60);
        const cad = Math.min(80000, Math.exp(random.gauss(controls.mu, controls.sigma)));
        const roll = random.rand();
        const channel = roll < individual.cash ? "CASH" : roll < individual.cash + 0.2 ? "EFT" : roll < individual.cash + 0.38 ? "E_TRANSFER" : "VIRTUAL_CURRENCY";
        const abroad = random.rand();
        add({
          at: stamp(day, hour, minute),
          atDate: day,
          customer: individual.name,
          persona: individual.persona,
          city: individual.city,
          province: individual.province,
          counterpartyCountry: abroad < 0.08 ? "US" : abroad < 0.11 ? "GB" : "CA",
          direction: random.rand() < 0.68 ? "IN" : "OUT",
          channel,
          cad,
          typology: "retail",
          purpose: "Everyday activity",
          beneficiary: "",
          flowId: "",
        });
      }
      if (controls.payroll && day.getUTCDay() === 4 && Math.floor(offset / 7) % 2 === 0 && (individual.persona === "salaried" || individual.persona === "student")) {
        const center = individual.persona === "salaried" ? 3600 : 980;
        const amount = Math.min(6200, Math.max(720, random.gauss(center, 180)));
        add({
          at: stamp(day, 9, 10 + Math.floor(random.rand() * 20)),
          atDate: day,
          customer: individual.name,
          persona: individual.persona,
          city: individual.city,
          province: individual.province,
          counterpartyCountry: "CA",
          direction: "IN",
          channel: "EFT",
          cad: amount,
          typology: "payroll",
          purpose: "Payroll deposit",
          beneficiary: "Employer payroll",
          flowId: "",
        });
      }
      if (controls.rent && (day.getUTCDate() === 1 || day.getUTCDate() === 2) && individual.persona !== "msb_agent" && individual.persona !== "mule") {
        add({
          at: stamp(day, 8, 5 + Math.floor(random.rand() * 25)),
          atDate: day,
          customer: individual.name,
          persona: individual.persona,
          city: individual.city,
          province: individual.province,
          counterpartyCountry: "CA",
          direction: "OUT",
          channel: "EFT",
          cad: Math.max(900, random.gauss(1850, 220)),
          typology: "rent",
          purpose: "Rent",
          beneficiary: "Landlord",
          flowId: "",
        });
      }
    }
  }

  const plantDay = addDays(anchor, Math.min(4, controls.days - 1));
  if (controls.structuring) {
    const subject = person("msb_agent");
    [8200, 7600, 9100, 6400].forEach((amount, index) => {
      const when = new Date(plantDay.getTime() + index * 10 * 3600_000);
      add({
        at: stamp(when, when.getUTCHours(), when.getUTCMinutes() || 12),
        atDate: when,
        customer: subject.name,
        persona: subject.persona,
        city: subject.city,
        province: subject.province,
        counterpartyCountry: "CA",
        direction: "IN",
        channel: "CASH",
        cad: amount,
        typology: "structuring",
        purpose: "Cash purchase of virtual currency",
        beneficiary: "Harbour Counter",
        flowId: "",
      });
    });
    const ring = addDays(plantDay, 1);
    ["small_business", "student", "retiree"].forEach((persona, index) => {
      const individual = person(persona, index);
      add({
        at: stamp(ring, 11 + index, 15),
        atDate: ring,
        customer: individual.name,
        persona: individual.persona,
        city: individual.city,
        province: individual.province,
        counterpartyCountry: "CA",
        direction: "IN",
        channel: "CASH",
        cad: [4200, 3800, 4600][index],
        typology: "structuring",
        purpose: "Cash under the large-cash line",
        beneficiary: "North Wharf MSB",
        flowId: "",
      });
    });
  }
  if (controls.layering) {
    const subject = person("crypto_native");
    const start = addDays(anchor, Math.min(8, controls.days - 1));
    [18400, 17120, 16340, 15110].forEach((amount, index) => {
      const when = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 1, 20 + index * 40));
      add({
        at: stamp(when, when.getUTCHours(), when.getUTCMinutes()),
        atDate: when,
        customer: subject.name,
        persona: subject.persona,
        city: subject.city,
        province: subject.province,
        counterpartyCountry: "CA",
        direction: "OUT",
        channel: "VIRTUAL_CURRENCY",
        asset: "BTC",
        cad: amount,
        typology: "layering",
        purpose: "Successive wallet hop",
        beneficiary: "",
        flowId: "layer-1",
      });
    });
  }
  if (controls.mules) {
    const mule = person("mule");
    const start = addDays(anchor, Math.min(6, controls.days - 1));
    [2100, 1800, 2400, 1950].forEach((amount, index) => {
      const when = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 22, 5 + index * 25));
      add({
        at: stamp(when, when.getUTCHours(), when.getUTCMinutes()),
        atDate: when,
        customer: mule.name,
        persona: mule.persona,
        city: mule.city,
        province: mule.province,
        counterpartyCountry: "CA",
        direction: "IN",
        channel: "E_TRANSFER",
        cad: amount,
        typology: "mule",
        purpose: "Incoming from a separate customer",
        beneficiary: people[index % people.length].name,
        flowId: "mule-1",
      });
    });
    [2600, 2400, 2200].forEach((amount, index) => {
      const when = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 1, 10 + index * 15));
      when.setUTCDate(when.getUTCDate() + 1);
      add({
        at: stamp(when, when.getUTCHours(), when.getUTCMinutes()),
        atDate: when,
        customer: mule.name,
        persona: mule.persona,
        city: mule.city,
        province: mule.province,
        counterpartyCountry: "CA",
        direction: "OUT",
        channel: "VIRTUAL_CURRENCY",
        asset: "USDT",
        cad: amount,
        typology: "mule",
        purpose: "Fan-out to external wallets",
        beneficiary: "",
        flowId: "mule-1",
      });
    });
  }
  if (controls.trade) {
    const importer = person("importer");
    const start = addDays(anchor, Math.min(10, controls.days - 1));
    [48000, 125000].forEach((amount, index) => {
      const when = addDays(start, index);
      add({
        at: stamp(when, 14, 0),
        atDate: when,
        customer: importer.name,
        persona: importer.persona,
        city: importer.city,
        province: importer.province,
        counterpartyCountry: "HK",
        direction: "OUT",
        channel: "EFT",
        cad: amount,
        typology: "trade",
        purpose: "Commercial invoice — electronics",
        beneficiary: "Harbour Trading Ltd",
        flowId: "trade-1",
      });
    });
  }
  if (controls.offramp) {
    const subject = person("crypto_native", 1);
    const start = addDays(anchor, Math.min(12, controls.days - 1));
    const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 3, 40));
    const second = new Date(first.getTime() + 2 * 3600_000);
    add({
      at: stamp(first, 3, 40),
      atDate: first,
      customer: subject.name,
      persona: subject.persona,
      city: subject.city,
      province: subject.province,
      counterpartyCountry: "CA",
      direction: "IN",
      channel: "VIRTUAL_CURRENCY",
      asset: "USDT",
      cad: 22000,
      typology: "crypto_offramp",
      purpose: "Stablecoin receipt",
      beneficiary: "",
      flowId: "offramp-1",
    });
    add({
      at: stamp(second, second.getUTCHours(), second.getUTCMinutes()),
      atDate: second,
      customer: subject.name,
      persona: subject.persona,
      city: subject.city,
      province: subject.province,
      counterpartyCountry: "CA",
      direction: "OUT",
      channel: "EFT",
      cad: 20500,
      typology: "crypto_offramp",
      purpose: "Fiat withdrawal after virtual-currency receipt",
      beneficiary: "",
      flowId: "offramp-1",
    });
  }
  if (controls.roundTrip) {
    const trio = [0, 4, 7].map((index) => people[index % people.length]);
    const start = addDays(anchor, Math.min(3, controls.days - 1));
    const hops: [Person, Person, number][] = [
      [trio[0], trio[1], 6400],
      [trio[1], trio[2], 6100],
      [trio[2], trio[0], 5950],
    ];
    hops.forEach(([sender, receiver, amount], index) => {
      const when = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 16 + index * 8, 10));
      add({
        at: stamp(when, when.getUTCHours(), 10),
        atDate: when,
        customer: sender.name,
        persona: sender.persona,
        city: sender.city,
        province: sender.province,
        counterpartyCountry: "CA",
        direction: "OUT",
        channel: "VIRTUAL_CURRENCY",
        asset: "ETH",
        cad: amount,
        typology: "round_trip",
        purpose: `Transfer toward ${receiver.name}`,
        beneficiary: receiver.name,
        flowId: "round-1",
      });
    });
  }

  rows.sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id));
  const hits = evaluateBook(rows);
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
  return {
    disclaimer: "Synthetic book. Rule hits are indicators for the demo. They do not find that anyone laundered money.",
    controls,
    summary: {
      transactions: rows.length,
      customers: people.length,
      cadTotal: Math.round(cadTotal * 100) / 100,
      hitCount: hits.length,
      byChannel,
      byHour,
      byTypology,
      byProvince,
      windowStart: "2026-03-02",
    },
    customers: people,
    hits,
    transactions: rows,
  };
}
