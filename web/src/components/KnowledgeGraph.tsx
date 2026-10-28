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

function riskColor(risk: number | null | undefined) {
  if (risk == null) return "#7f948c";
  if (risk >= 75) return "#8c2f39";
  if (risk >= 50) return "#9a5720";
  if (risk >= 25) return "#9a7433";
  return "#1d684f";
}

function layout(nodes: GraphNode[]) {
  const groups = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const list = groups.get(node.kind) ?? [];
    list.push(node);
    groups.set(node.kind, list);
  }
  const kinds = COLUMNS.filter((kind) => groups.has(kind));
  const height = Math.max(640, Math.max(1, ...kinds.map((kind) => groups.get(kind)!.length)) * 36 + 80);
  const width = Math.max(960, kinds.length * 168 + 80);
  const pos = new Map<string, { x: number; y: number }>();
  kinds.forEach((kind, column) => {
    groups.get(kind)!.forEach((node, row) => {
      pos.set(node.id, { x: 90 + column * 168, y: 36 + row * 36 });
    });
  });
  return { pos, width, height };
}

function relax(nodes: GraphNode[], edges: GraphEdge[], seed: Map<string, { x: number; y: number }>) {
  const pos = new Map([...seed].map(([id, point]) => [id, { ...point }]));
  const ids = [...pos.keys()];
  for (let step = 0; step < 48; step += 1) {
    const force = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const left = pos.get(ids[i])!;
        const right = pos.get(ids[j])!;
        let dx = left.x - right.x;
        let dy = left.y - right.y;
        const distance = Math.hypot(dx, dy) || 0.1;
        const push = 520 / (distance * distance);
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
      const pull = (distance - 96) * 0.015;
      force.get(edge.source)!.x += (dx / distance) * pull;
      force.get(edge.source)!.y += (dy / distance) * pull;
      force.get(edge.target)!.x -= (dx / distance) * pull;
      force.get(edge.target)!.y -= (dy / distance) * pull;
    }
    for (const id of ids) {
      const home = seed.get(id)!;
      const point = pos.get(id)!;
      const push = force.get(id)!;
      push.x += (home.x - point.x) * 0.06;
      push.y += (home.y - point.y) * 0.06;
      point.x += Math.max(-14, Math.min(14, push.x));
      point.y += Math.max(-14, Math.min(14, push.y));
    }
  }
  return pos;
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
  const [focus, setFocus] = useState<Set<string>>(seed);
  const [selected, setSelected] = useState<string | null>(seed.values().next().value ?? null);
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [path, setPath] = useState<string[] | null>(null);
  const [pathNote, setPathNote] = useState("");
  const [camera, setCamera] = useState({ x: 24, y: 16, k: 0.9 });
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const surface = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setCamera((current) => ({
        ...current,
        k: Math.min(2.2, Math.max(0.35, current.k * (event.deltaY > 0 ? 0.92 : 1.08))),
      }));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const visibleIds = useMemo(() => {
    const ids = new Set(focus);
    for (const id of focus) {
      for (const next of neighbours.get(id) ?? []) ids.add(next);
    }
    return ids;
  }, [focus, neighbours]);
  const visibleNodes = nodes.filter((node) => visibleIds.has(node.id));
  const placed = useMemo(() => {
    const seed = layout(visibleNodes);
    return { ...seed, relaxed: relax(visibleNodes, edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)), seed.pos) };
  }, [visibleNodes, edges, visibleIds]);
  const [blend, setBlend] = useState(1);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setBlend(1);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const next = Math.min(1, (now - start) / 800);
      setBlend(next);
      if (next < 1) frame = requestAnimationFrame(tick);
    };
    setBlend(0);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [placed]);
  const pos = useMemo(() => {
    const mixed = new Map<string, { x: number; y: number }>();
    for (const [id, start] of placed.pos) {
      const end = placed.relaxed.get(id) ?? start;
      mixed.set(id, { x: start.x + (end.x - start.x) * blend, y: start.y + (end.y - start.y) * blend });
    }
    return mixed;
  }, [placed, blend]);
  const { width, height } = placed;
  const visibleEdges = edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  const pathSet = new Set(path ?? []);
  const matches = query.trim()
    ? nodes.filter((node) => `${node.label ?? ""} ${node.kind} ${node.detail ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
    : [];
  const selectedNode = selected ? byId.get(selected) : undefined;

  function expand(id: string) {
    setFocus((current) => new Set([...current, id]));
    setSelected(id);
  }

  function findPath() {
    if (!from || !to) {
      setPathNote("Choose two entities.");
      setPath(null);
      return;
    }
    const found = shortestPath(edges, from, to);
    if (!found) {
      setPath(null);
      setPathNote("No connection in this book.");
      return;
    }
    setPath(found);
    setPathNote(`${found.length - 1} step${found.length === 2 ? "" : "s"}.`);
    setFocus((current) => new Set([...current, ...found]));
    setSelected(found[0]);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Search entities</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, rule, wallet" className="field" />
        </label>
        {matches.length ? (
          <ul className="rounded-2xl border border-line bg-card">
            {matches.map((node) => (
              <li key={node.id}>
                <button type="button" onClick={() => expand(node.id)} className="block w-full px-3 py-2 text-left text-sm hover:bg-line/40">
                  <span className="font-semibold">{node.label}</span>
                  <span className="ml-2 text-xs text-muted">{node.kind}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <fieldset className="space-y-2 rounded-2xl border border-line bg-card p-3">
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
          <button type="button" onClick={findPath} className="rounded-md bg-spruce px-3 py-2 text-sm font-semibold text-white">
            Find path
          </button>
          <p className="text-sm text-muted" role="status">{pathNote || "A path is a connection to inspect."}</p>
        </fieldset>
        {selectedNode ? (
          <article className="rounded-2xl border border-line bg-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-brass">{selectedNode.kind}</p>
            <h2 className="font-display text-2xl text-spruce">{selectedNode.label}</h2>
            <p className="mt-1 text-sm text-muted">{selectedNode.detail}</p>
            <p className="num mt-2 text-sm">Risk {selectedNode.risk ?? "—"}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => expand(selectedNode.id)} className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold">
                Expand neighbours
              </button>
              {selectedNode.href ? (
                <Link href={selectedNode.href} className="rounded-md bg-spruce px-3 py-1.5 text-sm font-semibold text-white">
                  Open
                </Link>
              ) : null}
            </div>
          </article>
        ) : (
          <p className="text-sm text-muted">Select a node to read it. The highest-residual customers start expanded.</p>
        )}
        <p className="text-xs leading-relaxed text-muted">{disclaimer}</p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-line bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
          <p className="text-xs text-muted">{visibleNodes.length} of {nodes.length} entities in view</p>
          <div className="flex gap-2">
            <button type="button" className="rounded-md border border-line px-2 py-1 text-sm" onClick={() => setCamera((c) => ({ ...c, k: Math.min(2.2, c.k * 1.15) }))} aria-label="Zoom in">+</button>
            <button type="button" className="rounded-md border border-line px-2 py-1 text-sm" onClick={() => setCamera((c) => ({ ...c, k: Math.max(0.35, c.k / 1.15) }))} aria-label="Zoom out">−</button>
            <button type="button" className="rounded-md border border-line px-2 py-1 text-sm" onClick={() => setCamera({ x: 24, y: 16, k: 0.9 })}>Reset</button>
          </div>
        </div>
        <div
          ref={surface}
          className="relative h-[70vh] min-h-[520px] cursor-grab touch-none active:cursor-grabbing"
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest("a, button")) return;
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
              {visibleEdges.map((edge) => {
                const source = pos.get(edge.source);
                const target = pos.get(edge.target);
                if (!source || !target) return null;
                const onPath = pathSet.has(edge.source) && pathSet.has(edge.target);
                return (
                  <line
                    key={edge.id}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke={onPath ? "#8c2f39" : "currentColor"}
                    strokeOpacity={onPath ? 0.9 : 0.25}
                    strokeWidth={onPath ? 2.4 : 1}
                  />
                );
              })}
              {visibleNodes.map((node) => {
                const point = pos.get(node.id);
                if (!point) return null;
                const active = node.id === selected;
                return (
                  <g key={node.id} transform={`translate(${point.x} ${point.y})`} className="cursor-pointer" onClick={() => expand(node.id)}>
                    <circle
                      r={active ? 11 : (node.risk ?? 0) >= 75 ? 10 : 8}
                      fill={riskColor(node.risk)}
                      filter={(node.risk ?? 0) >= 75 ? "url(#risk-glow)" : undefined}
                      stroke={pathSet.has(node.id) ? "#8c2f39" : "transparent"}
                      strokeWidth="2"
                    />
                    <text x={14} y={4} fontSize="11" fill="currentColor">
                      {node.label}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
          <svg className="pointer-events-none absolute bottom-3 right-3 hidden h-28 w-40 rounded-xl border border-line bg-card/90 shadow-lg sm:block" aria-hidden="true" viewBox={`0 0 ${width} ${height}`}>
              {visibleEdges.map((edge) => {
                const source = pos.get(edge.source);
                const target = pos.get(edge.target);
                if (!source || !target) return null;
                return <line key={`mini-${edge.id}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke="currentColor" strokeOpacity="0.25" />;
              })}
              {visibleNodes.map((node) => {
                const point = pos.get(node.id);
                if (!point) return null;
                return <circle key={`mini-${node.id}`} cx={point.x} cy={point.y} r={node.id === selected ? 18 : 10} fill={riskColor(node.risk)} />;
              })}
          </svg>
        </div>
        <ul className="flex flex-wrap gap-3 border-t border-line px-3 py-2 text-xs text-muted" aria-label="Risk legend">
          <li><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#1d684f]" /> Under 25</li>
          <li><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#9a7433]" /> 25–49</li>
          <li><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#9a5720]" /> 50–74</li>
          <li><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#8c2f39] shadow-[0_0_8px_#8c2f39]" /> 75 and above, glowing</li>
        </ul>
      </div>
    </div>
  );
}
