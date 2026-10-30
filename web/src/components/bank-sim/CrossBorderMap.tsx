"use client";

import { COUNTRY } from "@/lib/bank-sim/catalog";
import { money } from "@/lib/format";
import type { SimTxn } from "@/lib/bank-sim/types";

function project(lon: number, lat: number) {
  return [((lon + 180) / 360) * 640, ((90 - lat) / 180) * 320];
}

export function CrossBorderMap({ rows }: { rows: SimTxn[] }) {
  const totals = new Map<string, { cad: number; count: number }>();
  for (const row of rows) {
    if (!row.counterpartyCountry || row.counterpartyCountry === "CA") continue;
    const bucket = totals.get(row.counterpartyCountry) ?? { cad: 0, count: 0 };
    bucket.cad += row.cad;
    bucket.count += 1;
    totals.set(row.counterpartyCountry, bucket);
  }
  const home = project(-96, 56);
  const entries = [...totals.entries()].sort((left, right) => right[1].cad - left[1].cad);

  return (
    <article className="panel glass p-4" data-testid="sim-map">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-2xl text-spruce">Cross-border</h2>
        <p className="text-xs uppercase tracking-wider text-muted">{entries.length} corridors</p>
      </div>
      {entries.length === 0 ? (
        <p className="mt-8 text-sm text-muted">No foreign counterparty has appeared at the playhead yet.</p>
      ) : (
        <svg viewBox="0 0 640 320" className="mt-2 h-[320px] w-full" role="img" aria-label="Cross-border payment corridors">
          {[0, 1, 2, 3].map((index) => (
            <line key={index} x1="0" x2="640" y1={40 + index * 70} y2={40 + index * 70} stroke="currentColor" opacity="0.08" />
          ))}
          <circle cx={home[0]} cy={home[1]} r="6" fill="#12352c" />
          <text x={home[0] + 8} y={home[1] - 8} fill="currentColor" fontSize="12">Canada</text>
          {entries.map(([code, bucket]) => {
            const place = COUNTRY[code];
            if (!place) return null;
            const [x, y] = project(place.lon, place.lat);
            const midX = (home[0] + x) / 2;
            const midY = Math.min(home[1], y) - 30;
            return (
              <g key={code}>
                <path d={`M ${home[0]} ${home[1]} Q ${midX} ${midY} ${x} ${y}`} fill="none" stroke="#9a7433" strokeWidth={Math.min(8, 1 + bucket.cad / 20000)} className="flow-arc" opacity="0.85" />
                <circle cx={x} cy={y} r="4.5" fill="#9a5720" />
                <text x={x + 6} y={y - 6} fill="currentColor" fontSize="12">
                  {code} {money(bucket.cad)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </article>
  );
}
