import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import betweennessCentrality from "graphology-metrics/centrality/betweenness";

export type NetNode = {
  id: string;
  kind: string;
  label?: string;
  customer_id?: number;
  external_risk_score?: number;
  country?: string;
  risk_tags?: string[];
};

export type NetEdge = {
  id: string;
  source: string;
  target: string;
  relation?: string;
  kind?: string;
  cad_value?: number;
  occurred_at?: string;
  instrument?: string;
  asset?: string;
};

export type Pattern = "cycle" | "round_trip" | "fan_in" | "fan_out";

const PALETTE = ["#3dbea0", "#e2c48a", "#7eb6d9", "#e39a55", "#d7b0ea", "#f0b4bc", "#9ad7c4", "#e07a68", "#8fd0ea", "#f2d48a"];

function parseTime(value: string | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value.endsWith("Z") ? value : `${value}Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

function cycles(edges: { source: string; target: string; id: string; cad: number }[]) {
  const adjacency = new Map<string, { target: string; id: string; cad: number }[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.source) ?? [];
    list.push({ target: edge.target, id: edge.id, cad: edge.cad });
    adjacency.set(edge.source, list);
  }
  const found: { nodes: string[]; edges: string[]; roundTrip: boolean }[] = [];
  const seenCycle = new Set<string>();
  let budget = 0;
  for (const start of adjacency.keys()) {
    const stack: { node: string; path: string[]; edges: string[]; cads: number[] }[] = [{ node: start, path: [start], edges: [], cads: [] }];
    while (stack.length && budget < 8000 && found.length < 12) {
      budget += 1;
      const current = stack.pop()!;
      for (const next of adjacency.get(current.node) ?? []) {
        if (next.target === start && current.path.length >= 3) {
          const key = [...current.path].sort().join("|");
          if (seenCycle.has(key)) continue;
          seenCycle.add(key);
          const amounts = [...current.cads, next.cad].filter((value) => value > 0);
          const roundTrip = amounts.length >= 3 && Math.max(...amounts) <= Math.min(...amounts) * 1.25;
          found.push({ nodes: current.path, edges: [...current.edges, next.id], roundTrip });
          continue;
        }
        if (current.path.includes(next.target) || current.path.length >= 5) continue;
        stack.push({
          node: next.target,
          path: [...current.path, next.target],
          edges: [...current.edges, next.id],
          cads: [...current.cads, next.cad],
        });
      }
    }
  }
  return found;
}

export function analyzeNetwork(nodes: NetNode[], edges: NetEdge[], from: number | null, to: number | null) {
  const visibleEdges = edges.filter((edge) => {
    if (edge.kind !== "transaction") return true;
    const time = parseTime(edge.occurred_at);
    if (time == null) return true;
    if (from != null && time < from) return false;
    if (to != null && time > to) return false;
    return true;
  });
  const used = new Set<string>();
  for (const edge of visibleEdges) {
    used.add(edge.source);
    used.add(edge.target);
  }
  const visibleNodes = nodes.filter((node) => used.has(node.id));
  const undirected = new Graph({ type: "undirected", multi: false });
  for (const node of visibleNodes) {
    if (!undirected.hasNode(node.id)) undirected.addNode(node.id);
  }
  for (const edge of visibleEdges) {
    if (!undirected.hasNode(edge.source) || !undirected.hasNode(edge.target)) continue;
    if (edge.source === edge.target || undirected.hasEdge(edge.source, edge.target)) continue;
    undirected.addEdge(edge.source, edge.target);
  }
  const communities = undirected.order ? louvain(undirected) : {};
  const betweenness = undirected.order > 2 ? betweennessCentrality(undirected, { normalized: true }) : {};
  const degree = new Map<string, number>();
  undirected.forEachNode((id) => degree.set(id, undirected.degree(id)));
  const maxDegree = Math.max(1, ...degree.values());

  const flow = visibleEdges
    .filter((edge) => edge.kind === "transaction")
    .map((edge) => ({ source: edge.source, target: edge.target, id: edge.id, cad: Number(edge.cad_value) || 0 }));
  const foundCycles = cycles(flow);
  const cycleEdges = new Set(foundCycles.flatMap((cycle) => cycle.edges));
  const roundEdges = new Set(foundCycles.filter((cycle) => cycle.roundTrip).flatMap((cycle) => cycle.edges));

  const inbound = new Map<string, Set<string>>();
  const outbound = new Map<string, Set<string>>();
  for (const edge of flow) {
    const into = inbound.get(edge.target) ?? new Set<string>();
    into.add(edge.source);
    inbound.set(edge.target, into);
    const out = outbound.get(edge.source) ?? new Set<string>();
    out.add(edge.target);
    outbound.set(edge.source, out);
  }
  const fanIn = new Set([...inbound.entries()].filter(([, sources]) => sources.size >= 3).map(([id]) => id));
  const fanOut = new Set([...outbound.entries()].filter(([, targets]) => targets.size >= 3).map(([id]) => id));

  const times = edges.map((edge) => parseTime(edge.occurred_at)).filter((value): value is number => value != null);
  const minTime = times.length ? Math.min(...times) : 0;
  const maxTime = times.length ? Math.max(...times) : 0;

  return {
    minTime,
    maxTime,
    communityCount: new Set(Object.values(communities)).size,
    cycleCount: foundCycles.length,
    roundTripCount: foundCycles.filter((cycle) => cycle.roundTrip).length,
    fanInCount: fanIn.size,
    fanOutCount: fanOut.size,
    nodes: visibleNodes.map((node) => {
      const community = communities[node.id] ?? 0;
      const centrality = betweenness[node.id] ?? (degree.get(node.id) ?? 0) / maxDegree;
      const patterns: Pattern[] = [];
      if (fanIn.has(node.id)) patterns.push("fan_in");
      if (fanOut.has(node.id)) patterns.push("fan_out");
      return {
        ...node,
        community,
        color: PALETTE[Math.abs(community) % PALETTE.length],
        centrality,
        patterns,
      };
    }),
    links: visibleEdges.map((edge) => ({
      ...edge,
      cycle: cycleEdges.has(edge.id),
      roundTrip: roundEdges.has(edge.id),
      flow: edge.kind === "transaction",
      value: Number(edge.cad_value) || 0,
    })),
  };
}
