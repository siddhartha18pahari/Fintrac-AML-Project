"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { GraphEdge, GraphNode } from "@/components/KnowledgeGraph";
import { useReducedMotion } from "@/lib/motion";
import { shortestPath } from "@/lib/bm25";

const GLYPH: Record<string, string> = {
  customer: "C",
  wallet: "W",
  alert: "!",
  rule: "R",
  case: "K",
  typology: "T",
  beneficiary: "B",
  device: "D",
  ip: "I",
  third_party: "P",
};

function riskColor(risk: number | null | undefined) {
  if (risk == null) return "#8aa399";
  if (risk >= 75) return "#e06b76";
  if (risk >= 50) return "#e39a55";
  if (risk >= 25) return "#e2c48a";
  return "#3dbea0";
}

type Force3D = React.ComponentType<Record<string, unknown>>;

export function KnowledgeGraph3D({
  nodes,
  edges,
  alertTimes,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  alertTimes: Record<string, string>;
}) {
  const reduce = useReducedMotion();
  const [Graph, setGraph] = useState<Force3D | null>(null);
  const [focus, setFocus] = useState("");
  const [depth, setDepth] = useState(2);
  const [pathEnd, setPathEnd] = useState("");
  const [failed, setFailed] = useState("");
  const times = Object.values(alertTimes).map((value) => Date.parse(value.endsWith("Z") ? value : `${value}Z`)).filter((value) => !Number.isNaN(value));
  const min = times.length ? Math.min(...times) : 0;
  const max = times.length ? Math.max(...times) : 0;
  const [until, setUntil] = useState(max);

  useEffect(() => {
    let live = true;
    Promise.all([import("react-force-graph-3d"), import("three")])
      .then(([mod]) => {
        if (live) setGraph(() => mod.default as Force3D);
      })
      .catch(() => {
        if (live) setFailed("WebGL is unavailable, so the 3D graph stayed closed.");
      });
    return () => {
      live = false;
    };
  }, []);

  const customers = nodes.filter((node) => node.kind === "customer");
  const startId = focus || customers.slice().sort((left, right) => (right.risk ?? 0) - (left.risk ?? 0))[0]?.id || nodes[0]?.id || "";

  const view = useMemo(() => {
    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
      adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
      adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]);
    }
    const kept = new Set<string>();
    if (startId) {
      let frontier = new Set([startId]);
      kept.add(startId);
      for (let hop = 0; hop < depth; hop += 1) {
        const next = new Set<string>();
        for (const node of frontier) for (const neighbour of adjacency.get(node) ?? []) if (!kept.has(neighbour)) next.add(neighbour);
        for (const node of next) kept.add(node);
        frontier = next;
      }
    }
    const timed = nodes.filter((node) => {
      if (!kept.has(node.id)) return false;
      if (node.kind !== "alert") return true;
      const raw = alertTimes[node.id];
      if (!raw || !until) return true;
      const time = Date.parse(raw.endsWith("Z") ? raw : `${raw}Z`);
      return Number.isNaN(time) || time <= until;
    });
    const ids = new Set(timed.map((node) => node.id));
    const path = startId && pathEnd ? shortestPath(edges, startId, pathEnd) : null;
    const pathEdges = new Set<string>();
    if (path) {
      for (let index = 1; index < path.length; index += 1) {
        pathEdges.add(`${path[index - 1]}|${path[index]}`);
        pathEdges.add(`${path[index]}|${path[index - 1]}`);
      }
    }
    return {
      path,
      graphData: {
        nodes: timed.map((node) => ({ ...node })),
        links: edges
          .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
          .map((edge) => ({ ...edge, onPath: pathEdges.has(`${edge.source}|${edge.target}`) })),
      },
    };
  }, [alertTimes, depth, edges, nodes, pathEnd, startId, until]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Ego</span>
          <select className="field" value={startId} onChange={(event) => setFocus(event.target.value)}>
            {customers.map((node) => (
              <option key={node.id} value={node.id}>{node.label}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Hops {depth}</span>
          <input type="range" min={1} max={3} value={depth} onChange={(event) => setDepth(Number(event.target.value))} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Path to</span>
          <select className="field" value={pathEnd} onChange={(event) => setPathEnd(event.target.value)}>
            <option value="">None</option>
            {customers.map((node) => (
              <option key={node.id} value={node.id}>{node.label}</option>
            ))}
          </select>
        </label>
        {max > min ? (
          <label className="min-w-48 flex-1 text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">
              Alerts through {until ? new Date(until).toISOString().slice(0, 10) : "the end"}
            </span>
            <input type="range" min={min} max={max} value={until || max} onChange={(event) => setUntil(Number(event.target.value))} />
          </label>
        ) : null}
      </div>
      {view.path ? (
        <p className="mb-3 text-sm text-muted">
          Path: {view.path.map((id) => nodes.find((node) => node.id === id)?.label ?? id).join(" → ")}
        </p>
      ) : pathEnd ? (
        <p className="mb-3 text-sm text-muted">No path inside this ego network. Widen the hop count.</p>
      ) : null}
      <div className="relative h-[720px] overflow-hidden rounded-3xl border border-white/10 bg-[#071410]">
        {failed ? <p className="p-6 text-sm text-[#d7e4de]">{failed}</p> : null}
        {!failed && !Graph ? <p className="p-6 text-sm text-[#d7e4de]">Starting the 3D layout…</p> : null}
        {Graph ? (
          <Graph
            graphData={view.graphData}
            backgroundColor="#071410"
            showNavInfo={false}
            nodeLabel={(node: GraphNode) => `${node.kind}: ${node.label ?? node.id}`}
            nodeColor={(node: GraphNode) => riskColor(node.risk)}
            nodeVal={(node: GraphNode) => (node.kind === "customer" ? 8 : 3) + Math.min(6, (node.risk ?? 0) / 20)}
            nodeThreeObject={(node: GraphNode) => spriteFor(node)}
            nodeThreeObjectExtend
            linkColor={(link: { onPath?: boolean }) => (link.onPath ? "#e2c48a" : "rgba(167,214,196,0.28)")}
            linkWidth={(link: { onPath?: boolean }) => (link.onPath ? 1.6 : 0.3)}
            linkDirectionalParticles={(link: { onPath?: boolean }) => (reduce ? 0 : link.onPath ? 4 : 0)}
            linkDirectionalParticleWidth={1.6}
            linkDirectionalParticleSpeed={reduce ? 0 : 0.006}
            linkDirectionalParticleColor={() => "#f4e7c8"}
            cooldownTicks={reduce ? 12 : 160}
          />
        ) : null}
      </div>
      <p className="mt-3 text-xs text-muted">
        Glyphs mark entity type. The halo is residual risk. Animated particles run only on the selected path.
        {startId.startsWith("customer:") ? (
          <>
            {" "}
            <Link className="text-info underline" href={`/customers/${startId.slice("customer:".length)}`}>Open this customer.</Link>
          </>
        ) : null}
      </p>
    </div>
  );
}

const spriteCache = new Map<string, THREE.Group>();

function spriteFor(node: GraphNode) {
  const cached = spriteCache.get(node.id);
  if (cached) return cached;
  const group = new THREE.Group();
  const color = riskColor(node.risk);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry((node.risk ?? 0) >= 50 ? 8 : 5, 16, 16),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22 }),
  );
  group.add(halo);
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = color;
    context.beginPath();
    context.arc(32, 32, 24, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#071410";
    context.font = "700 28px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(GLYPH[node.kind] ?? "•", 32, 34);
  }
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(10, 10, 1);
  group.add(sprite);
  spriteCache.set(node.id, group);
  return group;
}
