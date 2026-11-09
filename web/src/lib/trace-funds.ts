import { shortestPath } from "@/lib/bm25";
import { explainEdges, relationBasis, type EdgeFact, type LedgerTouch, type AlertTouch } from "@/lib/graph-evidence";
import { data } from "@/lib/snapshot";

export type TraceStep = {
  from: string;
  to: string;
  relation: string;
  basis: "observed" | "derived";
  fact: EdgeFact | null;
};

function resolve(text: string) {
  const cleaned = text.trim().toLowerCase();
  if (!cleaned) return null;
  const nodes = data.knowledge_graph.nodes;
  const exact = nodes.find((node) => node.id.toLowerCase() === cleaned || (node.label ?? "").toLowerCase() === cleaned);
  if (exact) return exact.id;
  return nodes.find((node) => (node.label ?? "").toLowerCase().includes(cleaned))?.id ?? null;
}

function ledger(): LedgerTouch[] {
  return data.transactions.map((txn) => ({
    id: txn.id,
    transaction_id: txn.transaction_id,
    customer_id: txn.customer_id,
    occurred_at: txn.occurred_at,
    cad_value: Number(txn.cad_value),
    asset: txn.asset,
    direction: txn.direction,
    instrument: txn.instrument,
    wallet_from: txn.wallet_from,
    wallet_to: txn.wallet_to,
    blockchain: txn.blockchain,
    beneficiary_id: txn.beneficiary_id,
    third_party_id: txn.third_party_id,
    device_id: typeof txn.context?.device_id === "string" ? txn.context.device_id : null,
  }));
}

function alerts(): AlertTouch[] {
  return data.alerts.map((alert) => ({
    id: alert.id,
    rule_id: alert.rule_id,
    rule_version: alert.rule_version,
    title: alert.title,
    customer_id: alert.customer_id,
    case_id: alert.case_id,
    evidence_txn_ids: alert.evidence_txn_ids,
  }));
}

export function traceFunds(from: string, to: string) {
  const start = resolve(from);
  const end = resolve(to);
  if (!start || !end) {
    return {
      found: false,
      reason: "One or both names are not on the knowledge graph in this snapshot.",
      path: [] as { id: string; label: string | null; kind: string | null }[],
      steps: [] as TraceStep[],
      observedCad: null as number | null,
      synthetic: true,
    };
  }
  const ids = shortestPath(data.knowledge_graph.edges, start, end);
  if (!ids) {
    return {
      found: false,
      reason: "Those entities are not connected in this snapshot.",
      path: [],
      steps: [] as TraceStep[],
      observedCad: null,
      synthetic: true,
    };
  }
  const byId = new Map(data.knowledge_graph.nodes.map((node) => [node.id, node]));
  const steps: TraceStep[] = [];
  for (let index = 0; index < ids.length - 1; index += 1) {
    const source = ids[index];
    const target = ids[index + 1];
    const edge = data.knowledge_graph.edges.find(
      (item) => (item.source === source && item.target === target) || (item.source === target && item.target === source),
    );
    steps.push({
      from: source,
      to: target,
      relation: edge?.relation ?? "unknown",
      basis: relationBasis(edge?.relation ?? ""),
      fact: null,
    });
  }
  const facts = explainEdges(
    steps.flatMap((step) => {
      const edge = data.knowledge_graph.edges.find(
        (item) => (item.source === step.from && item.target === step.to) || (item.source === step.to && item.target === step.from),
      );
      return edge ? [edge] : [];
    }),
    ledger(),
    alerts(),
  );
  for (const step of steps) {
    const edge = data.knowledge_graph.edges.find(
      (item) => (item.source === step.from && item.target === step.to) || (item.source === step.to && item.target === step.from),
    );
    step.fact = edge ? facts[edge.id] ?? null : null;
  }
  const observedCad = steps.reduce((sum, step) => sum + (step.basis === "observed" && step.fact?.cad != null ? step.fact.cad : 0), 0);
  return {
    found: true,
    reason: "Shortest undirected path on the snapshot graph. Observed steps cite ledger rows. Derived steps are catalogue, case, or alert links and are not payments.",
    path: ids.map((id) => ({ id, label: byId.get(id)?.label ?? null, kind: byId.get(id)?.kind ?? null, href: byId.get(id)?.href ?? null })),
    steps,
    observedCad: Math.round(observedCad * 100) / 100,
    currency: "CAD",
    synthetic: true,
  };
}
