/**
 * Static geographic reference for the offline world map.
 *
 * Numeric ids match world-atlas 2 countries-50m (ISO 3166-1 numeric, zero-padded).
 * FATF membership of the lists is the public statement of 19 June 2026:
 * call for action (KP, IR, MM) and jurisdictions under increased monitoring.
 * The October 2026 plenary had not published a replacement list when this
 * snapshot was bundled. It is not a sanctions list and it is not the
 * AML-VC-009 placeholder in app/config.py.
 */

export const FATF_AS_OF = "19 June 2026";

export const ISO_NUMERIC: Record<string, string> = {
  AE: "784",
  AF: "004",
  AO: "024",
  BA: "070",
  BG: "100",
  BO: "068",
  CA: "124",
  CD: "180",
  CI: "384",
  CM: "120",
  DE: "276",
  HT: "332",
  IQ: "368",
  IR: "364",
  KE: "404",
  KP: "408",
  KW: "414",
  LA: "418",
  LB: "422",
  MC: "492",
  MM: "104",
  NP: "524",
  PG: "598",
  SS: "728",
  SY: "760",
  US: "840",
  VE: "862",
  VG: "092",
  VN: "704",
  YE: "887",
};

/** High-risk jurisdictions subject to a FATF call for action. */
export const FATF_CALL_FOR_ACTION = new Set(["408", "364", "104"]);

/** Jurisdictions under increased monitoring (grey list), 19 June 2026. */
export const FATF_INCREASED_MONITORING = new Set([
  "024",
  "068",
  "070",
  "100",
  "120",
  "384",
  "180",
  "332",
  "368",
  "404",
  "414",
  "418",
  "422",
  "492",
  "524",
  "598",
  "728",
  "760",
  "862",
  "704",
  "092",
  "887",
]);

export type FatfStatus = "call-for-action" | "increased-monitoring" | null;

export function fatfStatus(numericId: string): FatfStatus {
  if (FATF_CALL_FOR_ACTION.has(numericId)) return "call-for-action";
  if (FATF_INCREASED_MONITORING.has(numericId)) return "increased-monitoring";
  return null;
}

export function padNumericId(id: string | number | undefined) {
  return String(id ?? "").padStart(3, "0");
}
