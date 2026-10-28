"use client";

import { useState } from "react";
import { money } from "@/lib/format";

type Point = { date: string; cash: number; eft: number; virtual_currency: number; total: number };

export function VolumeChart({ series }: { series: Point[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...series.map((row) => row.total), 1);
  const width = 720;
  const height = 200;
  const padX = 8;
  const padY = 16;
  const innerH = height - padY - 28;
  const gap = 3;
  const barW = (width - padX * 2) / series.length - gap;

  return (
    <figure className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" className="h-52 w-full min-w-[640px]" aria-labelledby="volume-title">
        <title id="volume-title">Incoming value by day and payment rail</title>
        {series.map((row, index) => {
          const x = padX + index * (barW + gap);
          const cashH = (row.cash / max) * innerH;
          const eftH = (row.eft / max) * innerH;
          const vcH = (row.virtual_currency / max) * innerH;
          const base = padY + innerH;
          return (
            <g key={row.date} onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)} className="cursor-pointer">
              <rect x={x} y={base - vcH - eftH - cashH} width={barW} height={cashH} fill="#9a5720" rx="1">
                <title>{`${row.date} cash ${money(row.cash)}`}</title>
              </rect>
              <rect x={x} y={base - vcH - eftH} width={barW} height={eftH} fill="#1c4f78">
                <title>{`${row.date} EFT ${money(row.eft)}`}</title>
              </rect>
              <rect x={x} y={base - vcH} width={barW} height={vcH} fill="#1d684f">
                <title>{`${row.date} virtual currency ${money(row.virtual_currency)}`}</title>
              </rect>
              {index % 3 === 0 ? (
                <text x={x} y={height - 6} fill="#5c675f" fontSize="10">
                  {row.date.slice(5)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {active != null && series[active] ? (
        <p className="mt-2 text-sm" aria-live="polite">
          {series[active].date}: virtual currency {money(series[active].virtual_currency)}, cash {money(series[active].cash)}, wires {money(series[active].eft)}.
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted">Hover a day to read the three rails.</p>
      )}
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 bg-[#1d684f]" /> Virtual currency</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 bg-[#9a5720]" /> Cash</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 bg-[#1c4f78]" /> Electronic transfer</span>
      </figcaption>
    </figure>
  );
}

export function RuleBars({ rules }: { rules: { rule_id: string; count: number }[] }) {
  const rows = rules.slice(0, 8);
  const max = Math.max(...rows.map((row) => row.count), 1);
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.rule_id}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium">{row.rule_id}</span>
            <span className="num text-muted">{row.count}</span>
          </div>
          <div className="h-2 rounded-full bg-line">
            <div className="h-2 rounded-full bg-spruce" style={{ width: `${(row.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function TierBars({ tiers, total }: { tiers: Record<string, number>; total: number }) {
  const order = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
  const colors: Record<string, string> = {
    CRITICAL: "#8c2f39",
    HIGH: "#9a5720",
    MEDIUM: "#c4a15a",
    LOW: "#1d684f",
  };
  const population = total || 1;
  return (
    <ul className="space-y-2">
      {order.map((tier) => {
        const count = tiers[tier] ?? 0;
        return (
          <li key={tier} className="grid grid-cols-[92px_1fr_32px] items-center gap-2 text-sm">
            <span>{tier[0] + tier.slice(1).toLowerCase()}</span>
            <div className="h-2 rounded-full bg-line">
              <div className="h-2 rounded-full" style={{ width: `${(count / population) * 100}%`, background: colors[tier] }} />
            </div>
            <span className="num text-right text-muted">{count}</span>
          </li>
        );
      })}
    </ul>
  );
}
