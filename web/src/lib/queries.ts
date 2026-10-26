import { data, type AlertRow, type CustomerRow, type TransactionRow } from "@/lib/snapshot";

export type AlertFilters = {
  q?: string;
  severity?: string;
  rule?: string;
};

export type TransactionFilters = {
  q?: string;
  instrument?: string;
  direction?: string;
  min?: string;
};

export function filterAlerts(filters: AlertFilters): AlertRow[] {
  const q = (filters.q ?? "").trim().toLowerCase();
  const severity = (filters.severity ?? "").toUpperCase();
  const rule = (filters.rule ?? "").trim();
  return data.alerts.filter((alert) => {
    if (severity && alert.severity.toUpperCase() !== severity) return false;
    if (rule && alert.rule_id !== rule) return false;
    if (!q) return true;
    const haystack = `${alert.title} ${alert.customer_name ?? ""} ${alert.rule_id} ${alert.explanation.detail}`.toLowerCase();
    return haystack.includes(q);
  });
}

export function filterTransactions(filters: TransactionFilters): TransactionRow[] {
  const q = (filters.q ?? "").trim().toLowerCase();
  const instrument = (filters.instrument ?? "").toUpperCase();
  const direction = (filters.direction ?? "").toUpperCase();
  const min = filters.min ? Number(filters.min) : 0;
  return data.transactions.filter((txn) => {
    if (instrument && txn.instrument !== instrument) return false;
    if (direction && txn.direction !== direction) return false;
    if (min && txn.cad_value < min) return false;
    if (!q) return true;
    const haystack = `${txn.transaction_id} ${txn.customer_name ?? ""} ${txn.asset} ${txn.scenario ?? ""} ${txn.wallet_from ?? ""} ${txn.wallet_to ?? ""}`.toLowerCase();
    return haystack.includes(q);
  });
}

export function sortCustomers(sort: string | undefined): CustomerRow[] {
  const rows = [...data.customers];
  if (sort === "name") {
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }
  if (sort === "inherent") {
    rows.sort((a, b) => b.risk.inherent - a.risk.inherent || a.name.localeCompare(b.name));
    return rows;
  }
  rows.sort((a, b) => b.risk.residual - a.risk.residual || a.name.localeCompare(b.name));
  return rows;
}

export function ruleOptions() {
  const ids = new Set(data.alerts.map((alert) => alert.rule_id));
  return [...ids].sort();
}

export function alertsCiting(transactionId: number) {
  return data.alerts.filter((alert) => alert.evidence_txn_ids.includes(transactionId));
}
