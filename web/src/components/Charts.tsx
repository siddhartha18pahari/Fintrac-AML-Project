"use client";

import { useState } from "react";
import { CHART } from "@/components/chartTheme";
import { money } from "@/lib/format";

type Point = { date: string; cash: number; eft: number; virtual_currency: number; total: number };

export function VolumeChart({ series }: { series: Point[] }) {
  const [active, setActive] = useState<number | null>(null);
  const progress = 1;
  const max = Math.max(...series.map((row) => row.total), 1);
  const width = 720;
  const height = 220;
  const padX = 12;
  const padY = 18;
  const innerH = height - padY - 32;
  const gap = 4;
  const barW = series.length > 0 ? (width - padX * 2) / series.length - gap : 0;
  const selected = active != null ? series[active] : null;

  return (
    <figure className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" className="h-56 w-full min-w-[640px]" aria-labelledby="volume-title">
        <title id="volume-title">Incoming value by day and payment rail, CAD</title>
        {[0.25, 0.5, 0.75, 1].map((tick) => {
          const y = padY + innerH - tick * innerH;
          return (
            <g key={tick}>
              <line x1={padX} x2={width - padX} y1={y} y2={y} stroke={CHART.grid} />
              <text x={padX} y={y - 2} fontSize="10" fill="currentColor" opacity="0.7">{money(max * tick)}</text>
            </g>
          );
        })}
        {series.map((row, index) => {
          const x = padX + index * (barW + gap);
          const cashH = (row.cash / max) * innerH * progress;
          const eftH = (row.eft / max) * innerH * progress;
          const vcH = (row.virtual_currency / max) * innerH * progress;
          const base = padY + innerH;
          const label = `${row.date}: virtual currency ${money(row.virtual_currency)}, cash ${money(row.cash)}, wires ${money(row.eft)}`;
          return (
            <g
              key={row.date}
              className="cursor-pointer"
              tabIndex={0}
              role="button"
              aria-label={label}
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
            >
              <rect x={x} y={padY} width={barW} height={innerH} fill="transparent" />
              <rect x={x} y={base - vcH - eftH - cashH} width={barW} height={Math.max(0, cashH)} fill={CHART.cash} />
              <rect x={x} y={base - vcH - eftH} width={barW} height={Math.max(0, eftH)} fill={CHART.eft} />
              <rect x={x} y={base - vcH} width={barW} height={Math.max(0, vcH)} fill={CHART.vc} />
              {active === index ? <rect x={x - 1} y={padY} width={barW + 2} height={innerH} fill="none" stroke="currentColor" strokeWidth="1.2" /> : null}
              {index % 3 === 0 ? (
                <text x={x} y={height - 8} fill="currentColor" opacity="0.55" fontSize="10">
                  {row.date.slice(5)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {selected ? (
        <div className="chart-tip mt-3" role="status">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brass">{selected.date}</p>
          <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted">Virtual currency</dt>
              <dd className="num font-semibold">{money(selected.virtual_currency)}</dd>
            </div>
            <div>
              <dt className="text-muted">Cash</dt>
              <dd className="num font-semibold">{money(selected.cash)}</dd>
            </div>
            <div>
              <dt className="text-muted">Wires</dt>
              <dd className="num font-semibold">{money(selected.eft)}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">Focus or hover a day to read the three rails.</p>
      )}
      <figcaption className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CHART.vc }} /> Virtual currency
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CHART.cash }} /> Cash
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CHART.eft }} /> Electronic transfer
        </span>
      </figcaption>
    </figure>
  );
}

export function RuleBars({ rules }: { rules: { rule_id: string; count: number }[] }) {
  const rows = rules.slice(0, 8);
  const max = Math.max(...rows.map((row) => row.count), 1);
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.rule_id}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium">{row.rule_id}</span>
            <span className="num text-muted">{row.count}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-line">
            <div className="h-2 rounded-full bg-info" style={{ width: `${(row.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function TierBars({ tiers, total }: { tiers: Record<string, number>; total: number }) {
  const order = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
  const colors: Record<string, string> = {
    CRITICAL: CHART.critical,
    HIGH: CHART.high,
    MEDIUM: CHART.medium,
    LOW: CHART.low,
  };
  const population = total || 1;
  return (
    <ul className="space-y-3">
      {order.map((tier) => {
        const count = tiers[tier] ?? 0;
        return (
          <li key={tier} className="grid grid-cols-[92px_1fr_32px] items-center gap-2 text-sm">
            <span>{tier[0] + tier.slice(1).toLowerCase()}</span>
            <div className="h-2.5 overflow-hidden rounded-full bg-line">
              <div className="h-2.5 rounded-full" style={{ width: `${(count / population) * 100}%`, background: colors[tier] }} />
            </div>
            <span className="num text-right text-muted">{count}</span>
          </li>
        );
      })}
    </ul>
  );
}
