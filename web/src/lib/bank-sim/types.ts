export type SimControls = {
  seed: number;
  days: number;
  customers: number;
  mu: number;
  sigma: number;
  seasonality: number;
  nightShare: number;
  fxVol: number;
  intensity: number;
  camouflage: number;
  focusCity: string;
  structuring: boolean;
  layering: boolean;
  mules: boolean;
  trade: boolean;
  offramp: boolean;
  roundTrip: boolean;
  funnel: boolean;
  rapid: boolean;
  professional: boolean;
  payroll: boolean;
  rent: boolean;
  preset: string;
};

export type SimTxn = {
  id: string;
  at: string;
  customer: string;
  persona: string;
  occupation: string;
  incomeBand: string;
  accountType: string;
  accountNumber: string;
  city: string;
  province: string;
  country: string;
  postal: string;
  direction: "IN" | "OUT";
  channel: string;
  method: string;
  disposition: string;
  asset: string;
  amountAsset: number;
  fxRate: number;
  cad: number;
  mcc: string;
  counterparty: string;
  counterpartyCountry: string;
  counterpartyBank: string;
  counterpartyCity: string;
  purpose: string;
  conductor: string;
  beneficiary: string;
  thresholdIndicator: boolean;
  typology: string;
  groundTruth: "benign" | "suspicious";
  camouflage: boolean;
  flowId: string;
};

export type SimHit = {
  ruleId: string;
  title: string;
  customer: string;
  detail: string;
  cad: number;
  txnIds: string[];
  planted: string[];
  truth: string;
  caught: string;
  missedIds: string[];
};

export type SimCustomer = {
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
  accountNumber: string;
  dob: string;
  postal: string;
  lat: number;
  lon: number;
};

export type TypologyStat = { typology: string; plants: number; detected: number; rate: number };

export type Evaluation = {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  alertPrecision: number;
  alerts: number;
  byTypology: TypologyStat[];
  medianHoursToDetect: number | null;
  times: { flowId: string; typology: string; hours: number | null; detected: boolean }[];
};

export type SimBook = {
  disclaimer: string;
  controls: SimControls;
  summary: {
    transactions: number;
    customers: number;
    cadTotal: number;
    hitCount: number;
    byChannel: Record<string, number>;
    byHour: number[];
    byTypology: Record<string, number>;
    byProvince: Record<string, number>;
    windowStart: string;
    windowEnd: string;
  };
  customers: SimCustomer[];
  directory: {
    merchants: { name: string; mcc: string; city: string; category: string }[];
    correspondents: { name: string; country: string; city: string }[];
    exchanges: { name: string; country: string; city: string }[];
  };
  hits: SimHit[];
  transactions: SimTxn[];
  evaluation: Evaluation;
};

export type Preset = {
  id: string;
  name: string;
  blurb: string;
  controls: Partial<SimControls>;
};
