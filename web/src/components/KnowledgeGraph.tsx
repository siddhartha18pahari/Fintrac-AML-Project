"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { shortestPath } from "@/lib/bm25";

export type GraphNode = {
  id: string;
  kind: string;
  label?: string;
  risk?: number | null;
  tier?: string | null;
  href?: string | null;
  detail?: string | null;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  relation: string;
};

const COLUMNS = ["typology", "rule", "alert", "case", "customer", "beneficiary", "third_party", "wallet", "device", "ip"];
const RISK_FLOORS = [
  { value: 0, label: "Any risk" },
  { value: 25, label: "25+" },
  { value: 50, label: "50+" },
  { value: 75, label: "75+" },
];

function riskColor(risk: number | null | undefined) {
  if (risk == null) return "#7f948c";
  if (risk >= 75) return "#e06b76";
  if (risk >= 50) return "#e39a55";
  if (risk >= 25) return "#e2c48a";
  return "#3dbea0";
}

function isSanction(node: GraphNode) {
  return `${node.id} ${node.label ?? ""} ${node.detail ?? ""}`.toLowerCase().includes("sanction");
}

function layout(nodes: GraphNode[]) {
  const groups = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const list = groups.get(node.kind) ?? [];
    list.push(node);
    groups.set(node.kind, list);
  }
  const kinds = COLUMNS.filter((kind) => groups.has(kind));
  const height = Math.max(640, Math.max(1, ...kinds.map((kind) => groups.get(kind)!.length)) * 28 + 120);
  const width = Math.max(980, kinds.length * 210 + 80);
  const pos = new Map<string, { x: number; y: number }>();
  kinds.forEach((kind, column) => {
    const members = groups.get(kind)!;
    const radius = Math.min(150, 28 + members.length * 3.1);
    members.forEach((node, row) => {
      const angle = (row / members.length) * Math.PI * 2 - Math.PI / 2;
      pos.set(node.id, {
        x: 120 + column * 210 + Math.cos(angle) * radius * 0.42,
        y: 70 + (row % Math.max(members.length, 1)) * 26 + Math.sin(angle) * 8,
      });
    });
  });
  return { pos, width, height, kinds };
}

function clusterLayout(nodes: GraphNode[]) {
  const groups = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const list = groups.get(node.kind) ?? [];
    list.push(node);
    groups.set(node.kind, list);
  }
  const kinds = COLUMNS.filter((kind) => groups.has(kind));
  const pos = new Map<string, { x: number; y: number }>();
  kinds.forEach((kind, index) => {
    const angle = (index / Math.max(kinds.length, 1)) * Math.PI * 2 - Math.PI / 2;
    pos.set(`cluster:${kind}`, {
      x: 480 + Math.cos(angle) * 250,
      y: 300 + Math.sin(angle) * 200,
    });
  });
  return { pos, width: 980, height: 640, kinds, groups };
}

function relax(nodes: GraphNode[], edges: GraphEdge[], seed: Map<string, { x: number; y: number }>) {
  const pos = new Map([...seed].map(([id, point]) => [id, { ...point }]));
  const ids = [...pos.keys()];
  const steps = ids.length > 120 ? 12 : 36;
  for (let step = 0; step < steps; step += 1) {
    const force = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const left = pos.get(ids[i])!;
        const right = pos.get(ids[j])!;
        let dx = left.x - right.x;
        let dy = left.y - right.y;
        const distance = Math.hypot(dx, dy) || 0.1;
        const push = 420 / (distance * distance);
        dx /= distance;
        dy /= distance;
        force.get(ids[i])!.x += dx * push;
        force.get(ids[i])!.y += dy * push;
        force.get(ids[j])!.x -= dx * push;
        force.get(ids[j])!.y -= dy * push;
      }
    }
    for (const edge of edges) {
      const left = pos.get(edge.source);
      const right = pos.get(edge.target);
      if (!left || !right) continue;
      const dx = right.x - left.x;
      const dy = right.y - left.y;
      const distance = Math.hypot(dx, dy) || 1;
      const pull = (distance - 110) * 0.012;
      const source = force.get(edge.source);
      const target = force.get(edge.target);
      if (!source || !target) continue;
      source.x += (dx / distance) * pull;
      source.y += (dy / distance) * pull;
      target.x -= (dx / distance) * pull;
      target.y -= (dy / distance) * pull;
    }
    for (const id of ids) {
      const home = seed.get(id)!;
      const point = pos.get(id)!;
      const push = force.get(id)!;
      push.x += (home.x - point.x) * 0.08;
      push.y += (home.y - point.y) * 0.08;
      point.x += Math.max(-12, Math.min(12, push.x));
      point.y += Math.max(-12, Math.min(12, push.y));
    }
  }
  return pos;
}

function curve(source: { x: number; y: number }, target: { x: number; y: number }) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy) || 1;
  const bend = 14;
  const cx = (source.x + target.x) / 2 + (-dy / length) * bend;
  const cy = (source.y + target.y) / 2 + (dx / length) * bend;
  return `M ${source.x} ${source.y} Q ${cx} ${cy} ${target.x} ${target.y}`;
}

export function KnowledgeGraph({
  nodes,
  edges,
  disclaimer,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  disclaimer: string;
}) {
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const edge of edges) {
      map.set(edge.source, new Set([...(map.get(edge.source) ?? []), edge.target]));
      map.set(edge.target, new Set([...(map.get(edge.target) ?? []), edge.source]));
    }
    return map;
  }, [edges]);
  const seed = useMemo(() => {
    const customers = nodes.filter((node) => node.kind === "customer").sort((a, b) => (b.risk ?? 0) - (a.risk ?? 0));
    return new Set(customers.slice(0, 8).map((node) => node.id));
  }, [nodes]);
  const kindsPresent = useMemo(() => COLUMNS.filter((kind) => nodes.some((node) => node.kind === kind)), [nodes]);
  const sanctioned = useMemo(() => nodes.filter(isSanction), [nodes]);
  const [focus, setFocus] = useState<Set<string>>(seed);
  const [selected, setSelected] = useState<string | null>(seed.values().next().value ?? null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [path, setPath] = useState<string[] | null>(null);
  const [pathNote, setPathNote] = useState("");
  const [enabledKinds, setEnabledKinds] = useState<Set<string>>(() => new Set(COLUMNS));
  const [riskFloor, setRiskFloor] = useState(0);
  const [clustered, setClustered] = useState(false);
  const [camera, setCamera] = useState({ x: 20, y: 12, k: 0.86 });
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const pendingCenter = useRef<string | null>(null);

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setCamera((current) => {
        const next = Math.min(2.4, Math.max(0.35, current.k * (event.deltaY > 0 ? 0.92 : 1.08)));
        const ratio = next / current.k;
        return { k: next, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const pathSet = useMemo(() => new Set(path ?? []), [path]);
  const pathEdges = useMemo(() => {
    const pairs = new Set<string>();
    if (!path) return pairs;
    for (let index = 0; index < path.length - 1; index += 1) {
      pairs.add([path[index], path[index + 1]].sort().join("|"));
    }
    return pairs;
  }, [path]);

  const visibleIdList = useMemo(() => {
    const ids = new Set(focus);
    for (const id of focus) {
      for (const next of neighbours.get(id) ?? []) ids.add(next);
    }
    for (const id of pathSet) ids.add(id);
    return [...ids].filter((id) => {
      const node = byId.get(id);
      if (!node) return false;
      if (pathSet.has(id)) return true;
      if (!enabledKinds.has(node.kind)) return false;
      if (riskFloor === 0) return true;
      return (node.risk ?? -1) >= riskFloor;
    });
  }, [focus, neighbours, pathSet, byId, enabledKinds, riskFloor]);

  const visibleNodes = useMemo(
    () => visibleIdList.map((id) => byId.get(id)).filter((node): node is GraphNode => Boolean(node)),
    [visibleIdList, byId],
  );
  const visibleEdges = useMemo(
    () => edges.filter((edge) => visibleIdList.includes(edge.source) && visibleIdList.includes(edge.target)),
    [edges, visibleIdList],
  );

  const placed = useMemo(() => {
    if (clustered) {
      const grouped = clusterLayout(visibleNodes);
      const clusterEdges: GraphEdge[] = [];
      const seen = new Set<string>();
      for (const edge of visibleEdges) {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        if (!source || !target || source.kind === target.kind) continue;
        const key = [`cluster:${source.kind}`, `cluster:${target.kind}`].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        clusterEdges.push({
          id: key,
          source: `cluster:${source.kind}`,
          target: `cluster:${target.kind}`,
          relation: "group",
        });
      }
      const clusterNodes: GraphNode[] = grouped.kinds.map((kind) => {
        const members = grouped.groups.get(kind) ?? [];
        const risk = Math.max(...members.map((node) => node.risk ?? 0));
        return { id: `cluster:${kind}`, kind, label: `${kind} · ${members.length}`, risk, detail: `${members.length} ${kind} entities` };
      });
      return { pos: grouped.pos, width: grouped.width, height: grouped.height, nodes: clusterNodes, edges: clusterEdges, relaxed: grouped.pos };
    }
    const seedLayout = layout(visibleNodes);
    const relaxed = visibleNodes.length > 160 ? seedLayout.pos : relax(visibleNodes, visibleEdges, seedLayout.pos);
    return { ...seedLayout, nodes: visibleNodes, edges: visibleEdges, relaxed };
  }, [clustered, visibleNodes, visibleEdges, byId]);

  const [blend, setBlend] = useState(1);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || clustered) {
      setBlend(1);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const next = Math.min(1, (now - start) / 700);
      setBlend(next);
      if (next < 1) frame = requestAnimationFrame(tick);
    };
    setBlend(0);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [placed, clustered]);

  const pos = useMemo(() => {
    const mixed = new Map<string, { x: number; y: number }>();
    for (const [id, start] of placed.pos) {
      const end = placed.relaxed.get(id) ?? start;
      mixed.set(id, { x: start.x + (end.x - start.x) * blend, y: start.y + (end.y - start.y) * blend });
    }
    return mixed;
  }, [placed, blend]);

  useEffect(() => {
    if (blend < 1) return;
    const id = pendingCenter.current;
    if (!id) return;
    const point = pos.get(id);
    const box = surface.current?.getBoundingClientRect();
    if (!point || !box) return;
    pendingCenter.current = null;
    const k = 1.25;
    setCamera({ k, x: box.width / 2 - point.x * k, y: box.height / 2 - point.y * k });
  }, [blend, pos]);

  const anchor = clustered ? null : hovered ?? selected;
  const ring = anchor ? new Set([anchor, ...(neighbours.get(anchor) ?? [])]) : null;
  const matches = query.trim()
    ? nodes.filter((node) => `${node.label ?? ""} ${node.kind} ${node.detail ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
    : [];
  const selectedNode = selected ? byId.get(selected) : undefined;
  const hulls = useMemo(() => {
    if (clustered) return [];
    const boxes = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
    for (const node of visibleNodes) {
      const point = pos.get(node.id);
      if (!point) continue;
      const box = boxes.get(node.kind) ?? { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
      box.minX = Math.min(box.minX, point.x);
      box.minY = Math.min(box.minY, point.y);
      box.maxX = Math.max(box.maxX, point.x);
      box.maxY = Math.max(box.maxY, point.y);
      boxes.set(node.kind, box);
    }
    return [...boxes.entries()];
  }, [clustered, visibleNodes, pos]);

  function expand(id: string, center = false) {
    setClustered(false);
    setFocus((current) => new Set([...current, id]));
    setSelected(id);
    if (center) pendingCenter.current = id;
  }

  function showAll() {
    setClustered(false);
    setFocus(new Set(nodes.map((node) => node.id)));
  }

  function resetView() {
    setFocus(new Set(seed));
    setSelected(seed.values().next().value ?? null);
    setPath(null);
    setPathNote("");
    setEnabledKinds(new Set(COLUMNS));
    setRiskFloor(0);
    setClustered(false);
    setCamera({ x: 20, y: 12, k: 0.86 });
    setQuery("");
  }

  function rememberPath(found: string[] | null, note: string) {
    setPath(found);
    setPathNote(note);
    if (found) {
      setClustered(false);
      setFocus((current) => new Set([...current, ...found]));
      setSelected(found[0]);
      pendingCenter.current = found[Math.floor(found.length / 2)] ?? found[0];
    }
  }

  function findPath() {
    if (!from || !to) {
      rememberPath(null, "Choose two entities.");
      return;
    }
    const found = shortestPath(edges, from, to);
    if (!found) {
      rememberPath(null, "No connection in this book.");
      return;
    }
    rememberPath(found, `${found.length - 1} step${found.length === 2 ? "" : "s"}.`);
  }

  function pathToSanction() {
    const start = selected ?? [...seed][0];
    if (!start) {
      rememberPath(null, "No starting entity.");
      return;
    }
    let best: string[] | null = null;
    for (const target of sanctioned) {
      const found = shortestPath(edges, start, target.id);
      if (found && (!best || found.length < best.length)) best = found;
    }
    if (!best) {
      rememberPath(null, "No path from this entity to a sanctions node.");
      return;
    }
    const end = byId.get(best[best.length - 1]);
    rememberPath(best, `${best.length - 1} step${best.length === 2 ? "" : "s"} to ${end?.label ?? "sanctions"}.`);
  }

  function toggleKind(kind: string) {
    setEnabledKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  const drawnNodes = placed.nodes;
  const drawnEdges = placed.edges;

  return (
    <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Search and focus</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, rule, wallet" className="field" />
        </label>
        {matches.length ? (
          <ul className="overflow-hidden rounded-2xl border border-line bg-card/80">
            {matches.map((node) => (
              <li key={node.id}>
                <button type="button" onClick={() => expand(node.id, true)} className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-line/40">
                  <span className="font-semibold">{node.label}</span>
                  <span className="text-xs text-muted">{node.kind}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : query.trim() ? (
          <p className="text-sm text-muted">No entity matches that search.</p>
        ) : null}
        <fieldset className="rounded-2xl border border-line bg-card/80 p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">Type</legend>
          <div className="flex flex-wrap gap-1.5">
            {kindsPresent.map((kind) => {
              const on = enabledKinds.has(kind);
              return (
                <button key={kind} type="button" aria-pressed={on} onClick={() => toggleKind(kind)} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${on ? "bg-spruce text-white" : "border border-line text-muted"}`}>
                  {kind.replaceAll("_", " ")}
                </button>
              );
            })}
          </div>
        </fieldset>
        <fieldset className="rounded-2xl border border-line bg-card/80 p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">Risk floor</legend>
          <div className="flex flex-wrap gap-1.5">
            {RISK_FLOORS.map((floor) => (
              <button key={floor.value} type="button" aria-pressed={riskFloor === floor.value} onClick={() => setRiskFloor(floor.value)} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${riskFloor === floor.value ? "bg-brass text-spruce-deep" : "border border-line text-muted"}`}>
                {floor.label}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={clustered} onClick={() => setClustered((value) => !value)} className="rounded-full border border-line bg-card px-3 py-1.5 text-sm font-semibold">
            {clustered ? "Expand entities" : "Cluster by type"}
          </button>
          <button type="button" onClick={showAll} className="rounded-full border border-line bg-card px-3 py-1.5 text-sm font-semibold">All entities</button>
          <button type="button" onClick={resetView} className="rounded-full border border-line bg-card px-3 py-1.5 text-sm font-semibold">Reset</button>
        </div>
        <fieldset className="space-y-2 rounded-2xl border border-line bg-card/80 p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">Path</legend>
          <label className="block text-sm">
            From
            <select value={from} onChange={(event) => setFrom(event.target.value)} className="field mt-1">
              <option value="">Select</option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>{node.kind}: {node.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            To
            <select value={to} onChange={(event) => setTo(event.target.value)} className="field mt-1">
              <option value="">Select</option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>{node.kind}: {node.label}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={findPath} className="rounded-full bg-spruce px-3 py-1.5 text-sm font-semibold text-white">Find path</button>
            <button type="button" onClick={pathToSanction} className="rounded-full border border-critical/40 px-3 py-1.5 text-sm font-semibold text-critical">Path to sanctions</button>
          </div>
          <p className="text-sm text-muted" role="status">{pathNote || "A path is a connection to inspect, not a finding."}</p>
        </fieldset>
        {selectedNode ? (
          <article className="panel glass p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-brass">{selectedNode.kind}</p>
            <h2 className="font-display text-2xl tracking-tight text-spruce">{selectedNode.label}</h2>
            <p className="mt-1 text-sm text-muted">{selectedNode.detail}</p>
            <p className="num mt-2 text-sm">Risk {selectedNode.risk ?? "—"}{isSanction(selectedNode) ? " · sanctions node" : ""}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => expand(selectedNode.id, true)} className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold">Focus</button>
              {selectedNode.href ? (
                <Link href={selectedNode.href} className="rounded-full bg-spruce px-3 py-1.5 text-sm font-semibold text-white">Open</Link>
              ) : null}
            </div>
          </article>
        ) : (
          <p className="text-sm text-muted">Select a node to read it. The highest-residual customers start in view, with their neighbours lit.</p>
        )}
        <p className="text-xs leading-relaxed text-muted">{disclaimer}</p>
      </div>
      <div className="overflow-hidden rounded-3xl border border-line bg-[#071410] text-[#e7f0ec] shadow-[0_24px_70px_rgba(0,0,0,0.25)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
          <p className="text-xs text-[#b7c7bf]">{clustered ? `${drawnNodes.length} clusters` : `${visibleNodes.length} of ${nodes.length} entities`} in view</p>
          <div className="flex gap-2">
            <button type="button" className="rounded-full border border-white/15 px-2.5 py-1 text-sm" onClick={() => setCamera((current) => ({ ...current, k: Math.min(2.4, current.k * 1.15) }))} aria-label="Zoom in">+</button>
            <button type="button" className="rounded-full border border-white/15 px-2.5 py-1 text-sm" onClick={() => setCamera((current) => ({ ...current, k: Math.max(0.35, current.k / 1.15) }))} aria-label="Zoom out">−</button>
            <button type="button" className="rounded-full border border-white/15 px-2.5 py-1 text-sm" onClick={() => setCamera({ x: 20, y: 12, k: 0.86 })}>Reset</button>
          </div>
        </div>
        {drawnNodes.length === 0 ? (
          <div className="flex h-[70vh] min-h-[520px] items-center justify-center px-6 text-center">
            <div>
              <p className="font-display text-2xl">No entities match these filters</p>
              <p className="mt-2 text-sm text-[#b7c7bf]">Lower the risk floor or turn a type back on.</p>
            </div>
          </div>
        ) : (
          <div
            ref={surface}
            className="relative h-[70vh] min-h-[520px] cursor-grab touch-none active:cursor-grabbing"
            onPointerDown={(event) => {
              if ((event.target as HTMLElement).closest("a, button, [data-node]")) return;
              drag.current = { x: event.clientX, y: event.clientY, cx: camera.x, cy: camera.y };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!drag.current) return;
              setCamera((current) => ({
                ...current,
                x: drag.current!.cx + event.clientX - drag.current!.x,
                y: drag.current!.cy + event.clientY - drag.current!.y,
              }));
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
          >
            <svg width="100%" height="100%" role="img" aria-label="Entity graph">
              <defs>
                <filter id="risk-glow" x="-80%" y="-80%" width="260%" height="260%">
                  <feGaussianBlur stdDeviation="3.2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.k})`}>
                {hulls.map(([kind, box]) => (
                  <g key={kind}>
                    <rect
                      x={box.minX - 36}
                      y={box.minY - 28}
                      width={Math.max(72, box.maxX - box.minX + 92)}
                      height={Math.max(48, box.maxY - box.minY + 52)}
                      rx="18"
                      fill="rgba(255,255,255,0.03)"
                      stroke="rgba(226,196,138,0.28)"
                    />
                    <text x={box.minX - 28} y={box.minY - 34} fontSize="11" fill="#e2c48a" letterSpacing="0.12em">
                      {kind.toUpperCase()}
                    </text>
                  </g>
                ))}
                {drawnEdges.map((edge) => {
                  const source = pos.get(edge.source);
                  const target = pos.get(edge.target);
                  if (!source || !target) return null;
                  const onPath = pathEdges.has([edge.source, edge.target].sort().join("|"));
                  const linked = !ring || ring.has(edge.source) || ring.has(edge.target) || onPath;
                  return (
                    <path
                      key={edge.id}
                      d={curve(source, target)}
                      fill="none"
                      stroke={onPath ? "#e06b76" : "#9ad7c4"}
                      strokeOpacity={onPath ? 0.95 : linked ? 0.35 : 0.05}
                      strokeWidth={onPath ? 2.6 : 1}
                    />
                  );
                })}
                {drawnNodes.map((node) => {
                  const point = pos.get(node.id);
                  if (!point) return null;
                  const active = node.id === selected || node.id === hovered;
                  const linked = !ring || ring.has(node.id) || pathSet.has(node.id);
                  const label = node.label ?? node.id;
                  const showLabel = clustered || drawnNodes.length < 70 || active || (ring?.has(node.id) ?? false) || node.kind === "customer" || node.kind === "typology";
                  return (
                    <g
                      key={node.id}
                      data-node="true"
                      transform={`translate(${point.x} ${point.y})`}
                      className="cursor-pointer"
                      opacity={linked ? 1 : 0.12}
                      onClick={() => {
                        if (node.id.startsWith("cluster:")) {
                          const kind = node.id.slice("cluster:".length);
                          setEnabledKinds(new Set([kind]));
                          setClustered(false);
                          setFocus(new Set(nodes.filter((item) => item.kind === kind).map((item) => item.id)));
                          return;
                        }
                        expand(node.id);
                      }}
                      onMouseEnter={() => setHovered(node.id)}
                      onMouseLeave={() => setHovered((current) => (current === node.id ? null : current))}
                    >
                      <circle
                        r={clustered ? 18 + Math.min(16, (node.risk ?? 0) / 8) : active ? 12 : (node.risk ?? 0) >= 75 ? 10 : 7}
                        fill={riskColor(node.risk)}
                        filter={(node.risk ?? 0) >= 75 || active ? "url(#risk-glow)" : undefined}
                        stroke={pathSet.has(node.id) || isSanction(node) ? "#e2c48a" : "transparent"}
                        strokeWidth={isSanction(node) ? 2.4 : 2}
                        strokeDasharray={isSanction(node) && !pathSet.has(node.id) ? "2 2" : undefined}
                      />
                      {showLabel ? (
                        <text x={clustered ? 0 : 14} y={clustered ? 32 : 4} fontSize="11" fill="currentColor" textAnchor={clustered ? "middle" : "start"}>
                          {label.length > 26 ? `${label.slice(0, 24)}…` : label}
                        </text>
                      ) : null}
                      <title>{`${label} · ${node.kind} · risk ${node.risk ?? "—"}`}</title>
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>
        )}
        <ul className="flex flex-wrap gap-3 border-t border-white/10 px-3 py-2 text-xs text-[#b7c7bf]" aria-label="Risk legend">
          <li><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#3dbea0]" /> Under 25</li>
          <li><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#e2c48a]" /> 25–49</li>
          <li><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#e39a55]" /> 50–74</li>
          <li><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#e06b76]" /> 75 and above</li>
          <li><i className="mr-1 inline-block h-2 w-2 rounded-full border border-[#e2c48a]" /> Sanctions node</li>
        </ul>
      </div>
    </div>
  );
}
