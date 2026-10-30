import { shortestPath } from "@/lib/bm25";
import { simulateBook, type SimControls } from "@/lib/simulator-engine";
import { data } from "@/lib/snapshot";
import { benfordTest, mean } from "@/lib/statistics";

const BENIGN = new Set(["normal_retail", "demo_baseline", "casino_ordinary_play", "trade_within_tolerance", ""]);

export function listAlerts(input: { severity?: string; ruleId?: string; q?: string; limit?: number }) {
  const severity = (input.severity ?? "").trim().toLowerCase();
  const ruleId = (input.ruleId ?? "").trim().toUpperCase();
  const needle = (input.q ?? "").trim().toLowerCase();
  const rows = data.alerts.filter((alert) => {
    if (severity && alert.severity.toLowerCase() !== severity) return false;
    if (ruleId && alert.rule_id.toUpperCase() !== ruleId) return false;
    if (!needle) return true;
    const blob = `${alert.title} ${alert.customer_name ?? ""} ${alert.rule_id} ${alert.explanation}`.toLowerCase();
    return blob.includes(needle);
  });
  const limit = input.limit ?? 25;
  return {
    count: rows.length,
    alerts: rows.slice(0, limit).map((alert) => ({
      id: alert.id,
      rule_id: alert.rule_id,
      title: alert.title,
      severity: alert.severity,
      customer_id: alert.customer_id,
      customer_name: alert.customer_name,
      case_id: alert.case_id,
      score_contribution: alert.score_contribution,
      occurred_at: alert.occurred_at,
    })),
  };
}

export function listCases(input: { tier?: string; status?: string; limit?: number }) {
  const tier = (input.tier ?? "").trim().toUpperCase();
  const status = (input.status ?? "").trim().toUpperCase();
  const rows = data.cases
    .filter((row) => (!tier || row.risk_tier.toUpperCase() === tier) && (!status || row.status.toUpperCase() === status))
    .map((row) => ({
      id: row.id,
      reference: row.reference,
      customer_id: row.customer_id,
      customer_name: row.customer_name,
      status: row.status,
      priority: row.priority,
      risk_tier: row.risk_tier,
      risk_score: row.risk_score,
      lvctr_required: row.lvctr_required,
      str_candidate: row.str_candidate,
      due_at: row.due_at,
    }))
    .sort((left, right) => right.risk_score - left.risk_score || left.reference.localeCompare(right.reference));
  return { count: rows.length, cases: rows.slice(0, input.limit ?? 25) };
}

export function listEntities(input: { q?: string; kind?: string; limit?: number }) {
  const needle = (input.q ?? "").trim().toLowerCase();
  const kind = (input.kind ?? "customer").toLowerCase();
  if (kind !== "customer") {
    const nodes = data.knowledge_graph.nodes.filter((node) => {
      if (kind !== "any" && node.kind !== kind) return false;
      if (!needle) return true;
      return `${node.label ?? ""} ${node.id} ${node.detail ?? ""}`.toLowerCase().includes(needle);
    });
    return {
      count: nodes.length,
      entities: nodes.slice(0, input.limit ?? 20).map((node) => ({
        id: node.id,
        kind: node.kind,
        label: node.label,
        risk: node.risk,
        detail: node.detail,
      })),
    };
  }
  const rows = data.customers.filter((customer) => {
    if (!needle) return true;
    return `${customer.name} ${customer.customer_id} ${customer.id} ${customer.occupation_or_business} ${customer.profile.city ?? ""}`
      .toLowerCase()
      .includes(needle);
  });
  return {
    count: rows.length,
    entities: rows.slice(0, input.limit ?? 20).map((customer) => ({
      id: customer.id,
      reference: customer.customer_id,
      name: customer.name,
      kind: "customer",
      tier: customer.risk.tier,
      residual: customer.risk.residual,
      city: customer.profile.city,
      occupation: customer.occupation_or_business,
    })),
  };
}

function neighbours(nodeId: string) {
  const ids = new Set<string>();
  for (const edge of data.knowledge_graph.edges) {
    if (edge.source === nodeId) ids.add(edge.target);
    if (edge.target === nodeId) ids.add(edge.source);
  }
  return [...ids].slice(0, 16).map((id) => {
    const node = data.knowledge_graph.nodes.find((item) => item.id === id);
    return { id, label: node?.label, kind: node?.kind };
  });
}

export function entityDetail(entityId: string) {
  const needle = entityId.trim().toLowerCase();
  const customer =
    data.customers.find((row) => [String(row.id), row.customer_id.toLowerCase(), row.name.toLowerCase()].includes(needle)) ??
    data.customers.find((row) => needle && row.name.toLowerCase().includes(needle));
  if (!customer) {
    const node = data.knowledge_graph.nodes.find((item) => item.id.toLowerCase() === needle);
    if (!node) return null;
    return { kind: node.kind, node, neighbours: neighbours(node.id) };
  }
  return {
    kind: "customer",
    customer: {
      id: customer.id,
      reference: customer.customer_id,
      name: customer.name,
      occupation: customer.occupation_or_business,
      country: customer.country,
      city: customer.profile.city,
      risk: customer.risk,
      screening: customer.screening,
    },
    alerts: data.alerts
      .filter((alert) => alert.customer_id === customer.id)
      .slice(0, 12)
      .map((alert) => ({ id: alert.id, rule_id: alert.rule_id, title: alert.title, severity: alert.severity })),
    transactions: data.transactions
      .filter((txn) => txn.customer_id === customer.id)
      .slice(0, 12)
      .map((txn) => ({
        id: txn.id,
        cad_value: txn.cad_value,
        instrument: txn.instrument,
        direction: txn.direction,
        occurred_at: txn.occurred_at,
      })),
    neighbours: neighbours(`customer:${customer.id}`),
  };
}

function resolveNode(text: string) {
  const cleaned = text.trim().toLowerCase();
  if (!cleaned) return null;
  const exact = data.knowledge_graph.nodes.find((node) => node.id.toLowerCase() === cleaned || (node.label ?? "").toLowerCase() === cleaned);
  if (exact) return exact.id;
  const partial = data.knowledge_graph.nodes.find((node) => (node.label ?? "").toLowerCase().includes(cleaned));
  return partial?.id ?? null;
}

export function graphQuery(input: { source?: string; target?: string; ego?: string; depth?: number }) {
  const nodes = new Map(data.knowledge_graph.nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, string[]>();
  for (const edge of data.knowledge_graph.edges) {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
    adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]);
  }
  const publicNode = (id: string) => {
    const node = nodes.get(id);
    return { id, label: node?.label, kind: node?.kind, risk: node?.risk };
  };
  if (input.source && input.target) {
    const start = resolveNode(input.source);
    const end = resolveNode(input.target);
    if (!start || !end) return { found: false, reason: "One or both names are not on the knowledge graph.", path: [] };
    const path = shortestPath(data.knowledge_graph.edges, start, end);
    return { found: Boolean(path), path: (path ?? []).map(publicNode), hops: path ? path.length - 1 : null };
  }
  let focus = resolveNode(input.ego || input.source || "");
  if (!focus) {
    focus = [...data.knowledge_graph.nodes].sort((left, right) => (right.risk ?? 0) - (left.risk ?? 0))[0]?.id;
  }
  if (!focus) return { nodes: [], edges: [] };
  const depth = Math.max(1, Math.min(4, input.depth ?? 2));
  const kept = new Set([focus]);
  let frontier = new Set([focus]);
  for (let hop = 0; hop < depth; hop += 1) {
    const next = new Set<string>();
    for (const node of frontier) for (const neighbour of adjacency.get(node) ?? []) if (!kept.has(neighbour)) next.add(neighbour);
    for (const node of next) kept.add(node);
    frontier = next;
  }
  return {
    focus: publicNode(focus),
    nodes: [...kept].map(publicNode),
    edges: data.knowledge_graph.edges
      .filter((edge) => kept.has(edge.source) && kept.has(edge.target))
      .slice(0, 80)
      .map((edge) => ({ source: edge.source, target: edge.target, relation: edge.relation })),
  };
}

export function explainRule(ruleId: string) {
  const cleaned = ruleId.trim().toUpperCase();
  const match =
    data.rules.find((rule) => rule.rule_id.toUpperCase() === cleaned) ??
    (cleaned ? data.rules.find((rule) => rule.name.toUpperCase().includes(cleaned)) : undefined);
  if (!match) {
    return {
      found: false,
      catalogue: data.rules.filter((rule) => rule.in_force).slice(0, 12).map((rule) => ({ rule_id: rule.rule_id, name: rule.name })),
    };
  }
  return {
    found: true,
    rule_id: match.rule_id,
    name: match.name,
    category: match.category,
    severity: match.severity,
    description: match.description,
    in_force: match.in_force,
  };
}

export function computeStats(metric = "overview") {
  const amounts = data.transactions.map((txn) => Number(txn.cad_value)).filter((value) => value > 0);
  const benford = benfordTest(amounts);
  const suspiciousCustomers = new Set(
    data.transactions.filter((txn) => txn.scenario && !BENIGN.has(txn.scenario)).map((txn) => txn.customer_id),
  );
  const scores = data.anomaly.map((row) => row.score);
  const labels = data.anomaly.map((row) => (suspiciousCustomers.has(row.customer_id) ? 1 : 0));
  const name = metric.toLowerCase();
  if (name === "benford" || name === "digits") return { metric: "benford", benford };
  if (name === "overview" || name === "roc" || name === "anomaly") {
    return {
      metric: name,
      transactions: amounts.length,
      customers: data.customers.length,
      cad_total: Math.round(amounts.reduce((sum, value) => sum + value, 0) * 100) / 100,
      benford_conformity: benford.conformity,
      benford_mad: benford.mad,
      mean_anomaly: mean(scores),
      planted_customers: suspiciousCustomers.size,
      labelled_pairs: labels.length,
      disclaimer: "Planted scenario labels are not adjudicated outcomes. A reporting threshold is not suspicion.",
    };
  }
  return {
    metric: "overview",
    transactions: amounts.length,
    customers: data.customers.length,
    cad_total: Math.round(amounts.reduce((sum, value) => sum + value, 0) * 100) / 100,
    benford_conformity: benford.conformity,
    benford_mad: benford.mad,
    disclaimer: "Planted scenario labels are not adjudicated outcomes. A reporting threshold is not suspicion.",
  };
}

export function runSimulation(controls: Partial<SimControls>) {
  const book = simulateBook(controls);
  return { ...book, transactions: book.transactions.slice(0, 80) };
}

export function mentionedCustomers(question: string) {
  const lowered = question.toLowerCase();
  return data.customers
    .filter((customer) => {
      if (lowered.includes(customer.name.toLowerCase())) return true;
      const parts = customer.name.split(/\s+/).filter((part) => part.length > 3);
      return parts.length > 0 && parts.slice(0, 2).every((part) => lowered.includes(part.toLowerCase()));
    })
    .map((customer) => customer.name);
}
