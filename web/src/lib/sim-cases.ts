export type SimCaseFile = {
  id: string;
  reference: string;
  title: string;
  customer: string;
  ruleId: string;
  typology: string;
  cad: number;
  at: string;
  truth: string;
  caught: string;
  txnCount: number;
};

const KEY = "sentinel-sim-cases";

export function readSimCases(): SimCaseFile[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) || "[]") as SimCaseFile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSimCase(file: Omit<SimCaseFile, "id" | "reference" | "at"> & { at?: string }): SimCaseFile[] {
  const existing = readSimCases();
  const record: SimCaseFile = {
    ...file,
    id: `sim-case-${Date.now().toString(36)}`,
    reference: `SIM-2026-${String(existing.length + 1).padStart(3, "0")}`,
    at: file.at || new Date().toISOString(),
  };
  const next = [record, ...existing].slice(0, 40);
  window.localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
