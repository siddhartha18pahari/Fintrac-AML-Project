import { data } from "@/lib/snapshot";

/** Counts of snapshot defects. These are diagnostics, not a compliance score. */

export function snapshotDiagnostics() {
  const txnIds = new Set<number>();
  let duplicateTransactions = 0;
  let missingCad = 0;
  let missingCustomer = 0;
  for (const txn of data.transactions) {
    if (txnIds.has(txn.id)) duplicateTransactions += 1;
    txnIds.add(txn.id);
    if (txn.cad_value == null || Number.isNaN(Number(txn.cad_value))) missingCad += 1;
    if (!txn.customer_id) missingCustomer += 1;
  }
  const known = new Set(data.transactions.map((txn) => txn.id));
  let alertsWithMissingEvidence = 0;
  let danglingEvidenceIds = 0;
  for (const alert of data.alerts) {
    const missing = alert.evidence_txn_ids.filter((id) => !known.has(id));
    if (missing.length) alertsWithMissingEvidence += 1;
    danglingEvidenceIds += missing.length;
  }
  const unnamedCustomers = data.customers.filter((customer) => !customer.name?.trim()).length;
  return {
    synthetic: true,
    asOf: data.meta.as_of,
    transactions: data.transactions.length,
    alerts: data.alerts.length,
    customers: data.customers.length,
    duplicateTransactions,
    missingCad,
    transactionsWithoutCustomer: missingCustomer,
    alertsWithMissingEvidence,
    danglingEvidenceIds,
    unnamedCustomers,
    note: "Counts are taken from the bundled snapshot. A zero is a clean check of this file, not a production data-quality attestation.",
  };
}
