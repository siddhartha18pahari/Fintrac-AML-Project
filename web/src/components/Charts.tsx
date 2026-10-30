"use client";

import { useEffect, useId, useState } from "react";
import { CHART } from "@/components/chartTheme";
import { money } from "@/lib/format";

type Point = { date: string; cash: number; eft: number; virtual_currency: number; total: number };

function useGrow() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setProgress(1);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 780);
      setProgress(1 - (1 - t) ** 3);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return progress;
}

export function VolumeChart({ series }: { series: Point[] }) {
  const [active, setActive] = useState<number | null>(null);
  const progress = useGrow();
  const gradientId = useId().replace(/:/g, "");
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
    <figure>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" className="h-56 w-full min-w-[640px]" aria-labelledby="volume-title">
        <title id="volume-title">Incoming value by day and payment rail</title>
        <defs>
          <linearGradient id={`${gradientId}-cash`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={CHART.cash} />
            <stop offset="100%" stopColor={CHART.cashSoft} />
          </linearGradient>
          <linearGradient id={`${gradientId}-eft`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={CHART.eft} />
            <stop offset="100%" stopColor={CHART.eftSoft} />
          </linearGradient>
          <linearGradient id={`${gradientId}-vc`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={CHART.vc} />
            <stop offset="100%" stopColor={CHART.vcSoft} />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((tick) => {
          const y = padY + innerH - tick * innerH;
          return <line key={tick} x1={padX} x2={width - padX} y1={y} y2={y} stroke={CHART.grid} strokeDasharray="3 5" />;
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
              <rect x={x} y={base - vcH - eftH - cashH} width={barW} height={Math.max(0, cashH)} fill={`url(#${gradientId}-cash)`} rx="1.5" />
              <rect x={x} y={base - vcH - eftH} width={barW} height={Math.max(0, eftH)} fill={`url(#${gradientId}-eft)`} />
              <rect x={x} y={base - vcH} width={barW} height={Math.max(0, vcH)} fill={`url(#${gradientId}-vc)`} rx="1.5" />
              {active === index ? <rect x={x - 1} y={padY} width={barW + 2} height={innerH} fill="none" stroke="#e2c48a" strokeWidth="1.2" rx="2" /> : null}
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
          <i className="inline-block h-2.5 w-2.5 rounded-sm bg-gradient-to-t from-[#1d684f] to-[#8ef0d2]" /> Virtual currency
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-sm bg-gradient-to-t from-[#9a5720] to-[#f0c09a]" /> Cash
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-sm bg-gradient-to-t from-[#1c4f78] to-[#b9d4ee]" /> Electronic transfer
        </span>
      </figcaption>
    </figure>
  );
}

export function RuleBars({ rules }: { rules: { rule_id: string; count: number }[] }) {
  const rows = rules.slice(0, 8);
  const max = Math.max(...rows.map((row) => row.count), 1);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.rule_id}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium">{row.rule_id}</span>
            <span className="num text-muted">{row.count}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-line">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-[#12352c] to-[#8ef0d2] transition-[width] duration-700 ease-out"
              style={{ width: ready ? `${(row.count / max) * 100}%` : "0%" }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function TierBars({ tiers, total }: { tiers: Record<string, number>; total: number }) {
  const order = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
  const colors: Record<string, string> = {
    CRITICAL: `linear-gradient(90deg, ${CHART.critical}, ${CHART.criticalSoft})`,
    HIGH: `linear-gradient(90deg, ${CHART.high}, ${CHART.highSoft})`,
    MEDIUM: `linear-gradient(90deg, ${CHART.medium}, ${CHART.mediumSoft})`,
    LOW: `linear-gradient(90deg, ${CHART.low}, ${CHART.lowSoft})`,
  };
  const population = total || 1;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <ul className="space-y-3">
      {order.map((tier) => {
        const count = tiers[tier] ?? 0;
        return (
          <li key={tier} className="grid grid-cols-[92px_1fr_32px] items-center gap-2 text-sm">
            <span>{tier[0] + tier.slice(1).toLowerCase()}</span>
            <div className="h-2.5 overflow-hidden rounded-full bg-line">
              <div
                className="h-2.5 rounded-full transition-[width] duration-700 ease-out"
                style={{ width: ready ? `${(count / population) * 100}%` : "0%", background: colors[tier] }}
              />
            </div>
            <span className="num text-right text-muted">{count}</span>
          </li>
        );
      })}
    </ul>
  );
}
