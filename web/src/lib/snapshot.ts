import raw from "@/data/snapshot.json";

export const data = raw;

export type AlertRow = (typeof raw.alerts)[number];
export type CustomerRow = (typeof raw.customers)[number];
export type TransactionRow = (typeof raw.transactions)[number];
export type CaseRow = (typeof raw.cases)[number];
export type ReportRow = (typeof raw.reports)[number];
export type RuleRow = (typeof raw.rules)[number];

export function customerById(id: number) {
  return data.customers.find((row) => row.id === id);
}

export function alertById(id: number) {
  return data.alerts.find((row) => row.id === id);
}

export function transactionById(id: number) {
  return data.transactions.find((row) => row.id === id);
}

export function reportByCaseId(id: number) {
  return data.reports.find((row) => row.case_id === id);
}

export function alertsForCustomer(id: number) {
  return data.alerts.filter((row) => row.customer_id === id);
}

export function transactionsForCustomer(id: number) {
  return data.transactions.filter((row) => row.customer_id === id);
}

export function anomalyForCustomer(id: number) {
  return data.anomaly.find((row) => row.customer_id === id);
}
