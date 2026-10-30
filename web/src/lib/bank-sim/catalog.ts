import raw from "./catalog.json";

export type Persona = {
  name: string;
  persona: string;
  city: string;
  province: string;
  activity: number;
  cash: number;
  occupation: string;
  employer: string;
  incomeBand: string;
  accountType: string;
  dob: string;
};

export type Merchant = { name: string; mcc: string; city: string; category: string };
export type Bank = { name: string; country: string; city: string; lat: number; lon: number };
export type Exchange = { name: string; country: string; city: string };

export const ANCHOR_ISO = "2026-02-02";
export const HOLIDAYS = new Set(raw.holidays);
export const CITY = raw.city as Record<string, { lat: number; lon: number; postal: string }>;
export const COUNTRY = raw.country as Record<string, { name: string; lat: number; lon: number }>;
export const PERSONAS = raw.personas as Persona[];
export const MERCHANTS = raw.merchants as Merchant[];
export const CORRESPONDENTS = raw.correspondents as Bank[];
export const EXCHANGES = raw.exchanges as Exchange[];
export const BASE_RATES = raw.baseRates as Record<string, number>;
export const VC_ASSETS = raw.vcAssets as readonly string[];
export const VC_WEIGHTS = raw.vcWeights as number[];
export const MIX = raw.mix as unknown as Record<string, [string, number][]>;
export const BENIGN = new Set(["retail", "payroll", "rent", "bill", "lookalike"]);
