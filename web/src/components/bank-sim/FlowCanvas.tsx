"use client";

import { money } from "@/lib/format";
import type { SimTxn } from "@/lib/bank-sim/types";

export function FlowCanvas({ rows, reduce }: { rows: SimTxn[]; reduce: boolean }) {
  const recent = rows.slice(-36);
  const volume = new Map<string, number>();
  for (const row of recent) {
    volume.set(row.customer, (volume.get(row.customer) ?? 0) + row.cad);
    volume.set(row.counterparty || row.beneficiary || "Counterparty", (volume.get(row.counterparty || row.beneficiary || "Counterparty") ?? 0) + row.cad);
  }
  const customers = [...new Set(recent.map((row) => row.customer))].sort((left, right) => (volume.get(right) ?? 0) - (volume.get(left) ?? 0)).slice(0, 7);
  const others = [...new Set(recent.map((row) => row.counterparty || row.beneficiary || "Counterparty"))]
    .filter((name) => !customers.includes(name))
    .sort((left, right) => (volume.get(right) ?? 0) - (volume.get(left) ?? 0))
    .slice(0, 7);
  const left = new Map(customers.map((name, index) => [name, 36 + index * (320 / Math.max(1, customers.length))]));
  const right = new Map(others.map((name, index) => [name, 36 + index * (320 / Math.max(1, others.length))]));
  const edges = new Map<string, { from: string; to: string; cad: number; suspicious: boolean; latest: string }>();
  for (const row of recent) {
    const to = row.counterparty || row.beneficiary || "Counterparty";
    if (!left.has(row.customer) || !right.has(to)) continue;
    const key = `${row.customer}>${to}`;
    const current = edges.get(key);
    edges.set(key, {
      from: row.customer,
      to,
      cad: (current?.cad ?? 0) + row.cad,
      suspicious: Boolean(current?.suspicious) || row.groundTruth === "suspicious",
      latest: row.at,
    });
  }
  const drawn = [...edges.values()].sort((leftEdge, rightEdge) => leftEdge.latest.localeCompare(rightEdge.latest));
  const newest = drawn.at(-1);

  return (
    <article className="panel glass p-4" data-testid="sim-flow">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-2xl text-spruce">Money in motion</h2>
        <p className="text-xs uppercase tracking-wider text-muted">Last {recent.length} revealed</p>
      </div>
      {recent.length === 0 ? (
        <p className="mt-8 text-sm text-muted">Press play. Edges appear as each transaction is revealed.</p>
      ) : (
        <svg viewBox="0 0 640 380" className="mt-2 h-[380px] w-full" role="img" aria-label="Flows between customers and counterparties">
          {drawn.map((edge) => {
            const y1 = left.get(edge.from) ?? 40;
            const y2 = right.get(edge.to) ?? 40;
            const live = edge === newest && !reduce;
            return (
              <g key={`${edge.from}-${edge.to}`}>
                <path
                  d={`M 168 ${y1} C 320 ${y1}, 320 ${y2}, 470 ${y2}`}
                  fill="none"
                  stroke={edge.suspicious ? "#9a5720" : "#1d684f"}
                  strokeWidth={Math.min(7, 1.2 + edge.cad / 8000)}
                  className={live ? "flow-arc" : undefined}
                  opacity={edge.suspicious ? 0.95 : 0.55}
                />
                {live ? <circle r="4.5" fill="#9a7433"><animateMotion dur="1.4s" repeatCount="indefinite" path={`M 168 ${y1} C 320 ${y1}, 320 ${y2}, 470 ${y2}`} /></circle> : null}
              </g>
            );
          })}
          {customers.map((name) => (
            <g key={name}>
              <circle cx="150" cy={left.get(name)} r="7" fill="#12352c" />
              <text x="138" y={(left.get(name) ?? 0) + 4} textAnchor="end" fill="currentColor" fontSize="12">
                {name}
              </text>
            </g>
          ))}
          {others.map((name) => (
            <g key={name}>
              <circle cx="488" cy={right.get(name)} r="7" fill="#9a7433" />
              <text x="502" y={(right.get(name) ?? 0) + 4} fill="currentColor" fontSize="12">
                {name.length > 26 ? `${name.slice(0, 24)}…` : name}
              </text>
            </g>
          ))}
        </svg>
      )}
      {newest ? <p className="text-sm text-muted">Latest edge {money(newest.cad)} · {newest.from} → {newest.to}</p> : null}
    </article>
  );
}
