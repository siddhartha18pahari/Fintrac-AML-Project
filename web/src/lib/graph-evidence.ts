/** Edge facts traced to ledger rows or labelled as catalogue links. Amounts are never invented. */

export type LedgerTouch = {
  id: number;
  transaction_id: string;
  customer_id: number;
  occurred_at: string;
  cad_value: number;
  asset: string;
  direction: string;
  instrument: string;
  wallet_from: string | null;
  wallet_to: string | null;
  blockchain: string | null;
  beneficiary_id: number | null;
  third_party_id: number | null;
  device_id: string | null;
};

export type AlertTouch = {
  id: number;
  rule_id: string;
  rule_version: string | number;
  title: string;
  customer_id: number;
  case_id: number | null;
  evidence_txn_ids: number[];
};

export type EdgeRef = { id: string; source: string; target: string; relation: string };

export type EdgeSample = {
  id: number;
  ref: string;
  at: string;
  cad: number;
  direction: string;
  asset: string;
};

export type EdgeFact = {
  basis: "observed" | "derived";
  meaning: string;
  directionLabel: string;
  count: number | null;
  cad: number | null;
  currency: "CAD" | null;
  assets: string[];
  windowStart: string | null;
  windowEnd: string | null;
  samples: EdgeSample[];
  note: string;
};

const LEDGER = new Set(["wallet", "device", "ip", "beneficiary", "third_party"]);

function customerId(nodeId: string) {
  if (!nodeId.startsWith("customer:")) return null;
  const id = Number(nodeId.slice("customer:".length));
  return Number.isFinite(id) ? id : null;
}

function walletOf(nodeId: string) {
  if (!nodeId.startsWith("wallet:")) return null;
  const rest = nodeId.slice("wallet:".length);
  const split = rest.indexOf(":");
  if (split < 0) return { chain: "", address: rest };
  return { chain: rest.slice(0, split), address: rest.slice(split + 1) };
}

function partyId(nodeId: string) {
  if (!nodeId.startsWith("party:")) return null;
  const id = Number(nodeId.slice("party:".length));
  return Number.isFinite(id) ? id : null;
}

function alertId(nodeId: string) {
  if (!nodeId.startsWith("alert:")) return null;
  const id = Number(nodeId.slice("alert:".length));
  return Number.isFinite(id) ? id : null;
}

function summarise(rows: LedgerTouch[], meaning: string, directionLabel: string, note: string): EdgeFact {
  const ordered = [...rows].sort((left, right) => left.occurred_at.localeCompare(right.occurred_at));
  const assets = [...new Set(ordered.map((row) => row.asset).filter(Boolean))];
  const cad = ordered.reduce((sum, row) => sum + (Number(row.cad_value) || 0), 0);
  return {
    basis: "observed",
    meaning,
    directionLabel,
    count: ordered.length,
    cad: Math.round(cad * 100) / 100,
    currency: "CAD",
    assets,
    windowStart: ordered[0]?.occurred_at ?? null,
    windowEnd: ordered[ordered.length - 1]?.occurred_at ?? null,
    samples: ordered.slice(0, 6).map((row) => ({
      id: row.id,
      ref: row.transaction_id,
      at: row.occurred_at,
      cad: Number(row.cad_value) || 0,
      direction: row.direction,
      asset: row.asset,
    })),
    note,
  };
}

function derived(meaning: string, directionLabel: string, note: string): EdgeFact {
  return {
    basis: "derived",
    meaning,
    directionLabel,
    count: null,
    cad: null,
    currency: null,
    assets: [],
    windowStart: null,
    windowEnd: null,
    samples: [],
    note,
  };
}

export function explainEdges(edges: EdgeRef[], ledger: LedgerTouch[], alerts: AlertTouch[]) {
  const byId = new Map(ledger.map((row) => [row.id, row]));
  const alertsById = new Map(alerts.map((row) => [row.id, row]));
  const facts: Record<string, EdgeFact> = {};

  for (const edge of edges) {
    const customer = customerId(edge.source) ?? customerId(edge.target);
    if (edge.relation === "wallet") {
      const wallet = walletOf(edge.source) ?? walletOf(edge.target);
      const rows = wallet
        ? ledger.filter((row) => {
            if (customer != null && row.customer_id !== customer) return false;
            const addressHit = row.wallet_from === wallet.address || row.wallet_to === wallet.address;
            const chainHit = !wallet.chain || !row.blockchain || row.blockchain === wallet.chain;
            return addressHit && chainHit;
          })
        : [];
      facts[edge.id] = summarise(
        rows,
        "Observed wallet use",
        "Customer → wallet on a ledger row",
        "Counted only where this customer’s transaction names this address. Shared-wallet links are still one customer’s rows, not a claim the wallets are the same person.",
      );
      continue;
    }
    if (edge.relation === "device") {
      const device = edge.source.startsWith("device:")
        ? edge.source.slice("device:".length)
        : edge.target.startsWith("device:")
          ? edge.target.slice("device:".length)
          : "";
      const rows = ledger.filter((row) => row.device_id === device && (customer == null || row.customer_id === customer));
      facts[edge.id] = summarise(
        rows,
        "Observed device id",
        "Customer → device id on transaction context",
        "The device id is the value stored on the transaction context. It is not a device fingerprint from a live feed.",
      );
      continue;
    }
    if (edge.relation === "beneficiary" || edge.relation === "third_party") {
      const party = partyId(edge.source) ?? partyId(edge.target);
      const rows = ledger.filter((row) => {
        if (customer != null && row.customer_id !== customer) return false;
        return edge.relation === "beneficiary" ? row.beneficiary_id === party : row.third_party_id === party;
      });
      facts[edge.id] = summarise(
        rows,
        edge.relation === "beneficiary" ? "Observed beneficiary" : "Observed third party",
        "Customer → party named on a ledger row",
        "The party id is the beneficiary or third-party field on the transaction. It is not an inferred ownership link.",
      );
      continue;
    }
    if (edge.relation === "alert") {
      const id = alertId(edge.source) ?? alertId(edge.target);
      const alert = id == null ? undefined : alertsById.get(id);
      const evidence = (alert?.evidence_txn_ids ?? []).map((txnId) => byId.get(txnId)).filter((row): row is LedgerTouch => Boolean(row));
      const fact = summarise(
        evidence,
        "Detection output",
        "Customer → alert produced by a rule",
        "The edge is the alert record. CAD and count are the alert’s evidence transactions, not a separate payment from the customer to the alert.",
      );
      fact.basis = "derived";
      fact.note = alert
        ? `${alert.rule_id} v${alert.rule_version}. ${alert.title}. ${fact.note}`
        : fact.note;
      facts[edge.id] = fact;
      continue;
    }
    if (edge.relation === "rule") {
      const id = alertId(edge.source) ?? alertId(edge.target);
      const alert = id == null ? undefined : alertsById.get(id);
      facts[edge.id] = derived(
        "Alert cites a catalogue rule",
        "Alert → rule id",
        alert
          ? `${alert.rule_id} version ${alert.rule_version}. This is the rule named on the alert, not a movement of funds.`
          : "The alert record for this edge is not in the snapshot slice passed to the inspector.",
      );
      continue;
    }
    if (edge.relation === "case" || edge.relation === "case_alert") {
      facts[edge.id] = derived(
        edge.relation === "case" ? "Case opened for the customer" : "Alert linked to a case",
        edge.relation === "case" ? "Customer → case" : "Case → alert",
        "Taken from the case and alert identifiers in the detection snapshot. Not a payment and not a finding.",
      );
      continue;
    }
    if (edge.relation === "business") {
      facts[edge.id] = derived(
        "Occupation classified as a typology",
        "Customer → typology label",
        "Derived from the declared occupation or business (MSB or casino wording). No transaction amount is attached because the link is not a payment.",
      );
      continue;
    }
    if (edge.relation === "typology") {
      facts[edge.id] = derived(
        "Catalogue grouping",
        "Rule → typology",
        "A label in the rule catalogue. It is not observed activity and it has no amount.",
      );
      continue;
    }
    facts[edge.id] = LEDGER.has(edge.relation)
      ? summarise([], "Ledger relation without matching rows", `${edge.source} → ${edge.target}`, "The edge is in the graph, but no snapshot transaction matched this customer and identifier.")
      : derived("Graph relation", `${edge.relation}: ${edge.source} → ${edge.target}`, "No amount is shown because this relation is not a summed ledger edge.");
  }
  return facts;
}

export function relationBasis(relation: string): "observed" | "derived" {
  return LEDGER.has(relation) ? "observed" : "derived";
}
