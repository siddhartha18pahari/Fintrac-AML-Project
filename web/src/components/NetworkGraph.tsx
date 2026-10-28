"use client";

import { useMemo, useState } from "react";

type Node = {
  id: string;
  kind: string;
  label?: string;
  customer_id?: number;
  external_risk_score?: number;
  country?: string;
};

type Edge = {
  id: string;
  source: string;
  target: string;
  relation?: string;
  cad_value?: number;
  asset?: string;
  instrument?: string;
};

const COLORS: Record<string, string> = {
  customer: "#12352c",
  wallet: "#9a7433",
  beneficiary: "#8c2f39",
  third_party: "#1c4f78",
  rail: "#1c4f78",
  party: "#8c2f39",
};

function hash(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function layout(nodes: Node[], edges: Edge[]) {
  const width = 1000;
  const height = 680;
  const cx = width / 2;
  const cy = height / 2;
  const pos = new Map<string, { x: number; y: number }>();
  const customers = nodes.filter((node) => node.kind === "customer");
  const others = nodes.filter((node) => node.kind !== "customer");

  customers.forEach((node, index) => {
    const angle = (index / Math.max(customers.length, 1)) * Math.PI * 2 - Math.PI / 2;
    pos.set(node.id, {
      x: cx + Math.cos(angle) * 300,
      y: cy + Math.sin(angle) * 240,
    });
  });

  const neighbors = new Map<string, string[]>();
  for (const edge of edges) {
    neighbors.set(edge.source, [...(neighbors.get(edge.source) ?? []), edge.target]);
    neighbors.set(edge.target, [...(neighbors.get(edge.target) ?? []), edge.source]);
  }

  others.forEach((node) => {
    const linked = (neighbors.get(node.id) ?? [])
      .map((id) => pos.get(id))
      .filter((point): point is { x: number; y: number } => Boolean(point));
    if (linked.length === 0) {
      const angle = hash(node.id) * Math.PI * 2;
      pos.set(node.id, { x: cx + Math.cos(angle) * 70, y: cy + Math.sin(angle) * 70 });
      return;
    }
    const x = linked.reduce((sum, point) => sum + point.x, 0) / linked.length;
    const y = linked.reduce((sum, point) => sum + point.y, 0) / linked.length;
    const angle = hash(node.id) * Math.PI * 2;
    const radius = 28 + hash(node.id + ":r") * 34;
    pos.set(node.id, { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius });
  });

  const movable = new Set(others.map((node) => node.id));
  for (let step = 0; step < 28; step += 1) {
    for (let i = 0; i < others.length; i += 1) {
      for (let j = i + 1; j < others.length; j += 1) {
        const a = pos.get(others[i].id)!;
        const b = pos.get(others[j].id)!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        if (dist > 42) continue;
        const push = (42 - dist) / dist;
        dx *= push * 0.35;
        dy *= push * 0.35;
        if (movable.has(others[i].id)) pos.set(others[i].id, { x: a.x + dx, y: a.y + dy });
        if (movable.has(others[j].id)) pos.set(others[j].id, { x: b.x - dx, y: b.y - dy });
      }
    }
  }

  for (const [id, point] of pos) {
    pos.set(id, {
      x: Math.min(width - 16, Math.max(16, point.x)),
      y: Math.min(height - 16, Math.max(16, point.y)),
    });
  }
  return pos;
}

export function NetworkGraph({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) {
  const positions = useMemo(() => layout(nodes, edges), [nodes, edges]);
  const [selected, setSelected] = useState<string | null>(null);
  const active = nodes.find((node) => node.id === selected) ?? null;
  const linked = edges.filter((edge) => edge.source === selected || edge.target === selected);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
      <div className="overflow-hidden rounded-3xl border border-line bg-[#071410] text-[#e7f0ec]">
        <svg viewBox="0 0 1000 680" className="h-[640px] w-full" role="img" aria-label="Transaction network">
          {edges.map((edge) => {
            const a = positions.get(edge.source);
            const b = positions.get(edge.target);
            if (!a || !b) return null;
            const hot = selected && (edge.source === selected || edge.target === selected);
            return (
              <line
                key={edge.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={hot ? "#8c2f39" : "#c8b89a"}
                strokeWidth={hot ? 1.6 : 0.7}
                strokeOpacity={hot ? 0.9 : 0.7}
              />
            );
          })}
          {nodes.map((node) => {
            const point = positions.get(node.id);
            if (!point) return null;
            const radius = node.kind === "customer" ? 8 : node.kind === "wallet" ? 3.5 : 6;
            const on = selected === node.id;
            return (
              <g key={node.id} onClick={() => setSelected(node.id)} style={{ cursor: "pointer" }}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={on ? radius + 3 : radius}
                  fill={COLORS[node.kind] ?? "#5c675f"}
                  stroke={on ? "#e7d3a4" : "transparent"}
                  strokeWidth={2}
                />
                {node.kind === "customer" ? (
                  <text
                    x={point.x + (point.x >= 500 ? 12 : -12)}
                    y={point.y + 4}
                    fontSize="12"
                    fill="currentColor"
                    textAnchor={point.x >= 500 ? "start" : "end"}
                  >
                    {(node.label ?? node.id).slice(0, 26)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <aside className="rounded-xl border border-line bg-card p-4">
        <h2 className="font-display text-xl text-spruce">Selection</h2>
        {active ? (
          <div className="mt-3 space-y-2 text-sm">
            <p className="font-semibold">{active.label ?? active.id}</p>
            <p className="text-muted">{active.kind.replaceAll("_", " ")}</p>
            {typeof active.customer_id === "number" ? (
              <a className="text-info underline" href={`/customers/${active.customer_id}`}>
                Open customer
              </a>
            ) : null}
            <p className="pt-2 text-xs uppercase tracking-wide text-muted">{linked.length} linked edges</p>
            <ul className="max-h-80 space-y-2 overflow-auto text-xs">
              {linked.slice(0, 12).map((edge) => (
                <li key={edge.id} className="rounded-md bg-line/50 px-2 py-1.5">
                  <span className="font-medium">{edge.relation ?? "link"}</span>
                  {edge.cad_value ? <span className="num"> · CAD {edge.cad_value.toLocaleString("en-CA")}</span> : null}
                  {edge.asset ? <span> · {edge.asset}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Click a node. Customers are spruce, wallets brass, beneficiaries clay, rails and third parties blue.
          </p>
        )}
      </aside>
    </div>
  );
}
