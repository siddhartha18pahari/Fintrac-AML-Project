"use client";

import { useId } from "react";
import { CHART } from "@/components/chartTheme";

type Flow = { label: string; value: number; tone: string };

export function FundSankey({ incoming, outgoing }: { incoming: Flow[]; outgoing: Flow[] }) {
  const glowId = useId().replace(/:/g, "");
  const width = 720;
  const height = 280;
  const inTotal = incoming.reduce((sum, row) => sum + row.value, 0) || 1;
  const outTotal = outgoing.reduce((sum, row) => sum + row.value, 0) || 1;
  const gap = 10;
  const usable = height - 36 - gap * 2;

  function bands(rows: Flow[], total: number) {
    let cursor = 18;
    return rows.map((row) => {
      const h = Math.max(8, (row.value / total) * usable);
      const band = { ...row, y: cursor, h };
      cursor += h + gap;
      return band;
    });
  }
  const left = bands(incoming, inTotal);
  const right = bands(outgoing, outTotal);
  const midY = 18;
  const midH = usable;

  return (
    <figure>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" className="h-64 w-full" aria-labelledby="sankey-title">
        <title id="sankey-title">Value flowing in by rail and leaving by rail</title>
        <defs>
          <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <text x="8" y="14" fontSize="11" fill="currentColor" opacity="0.6">In</text>
        <text x={width - 28} y="14" fontSize="11" fill="currentColor" opacity="0.6">Out</text>
        {left.map((row) => (
          <path
            key={row.label}
            d={`M 92 ${row.y + row.h / 2} C 240 ${row.y + row.h / 2}, 250 ${midY + midH / 2}, 360 ${midY + midH / 2}`}
            stroke={row.tone}
            strokeWidth={Math.max(2, row.h * 0.45)}
            fill="none"
            opacity="0.55"
            filter={`url(#${glowId})`}
          />
        ))}
        {right.map((row) => (
          <path
            key={row.label}
            d={`M 360 ${midY + midH / 2} C 470 ${midY + midH / 2}, 480 ${row.y + row.h / 2}, 620 ${row.y + row.h / 2}`}
            stroke={row.tone}
            strokeWidth={Math.max(2, row.h * 0.45)}
            fill="none"
            opacity="0.55"
            filter={`url(#${glowId})`}
          />
        ))}
        {left.map((row) => (
          <g key={`l-${row.label}`}>
            <rect x="8" y={row.y} width="84" height={row.h} rx="8" fill={row.tone} />
            <text x="14" y={row.y + Math.min(row.h - 6, 16)} fontSize="11" fill="white">{row.label}</text>
          </g>
        ))}
        <rect x="332" y={midY} width="56" height={midH} rx="16" fill="#12352c" />
        <text x="360" y={midY + midH / 2} textAnchor="middle" fontSize="12" fill="white">Book</text>
        {right.map((row) => (
          <g key={`r-${row.label}`}>
            <rect x="628" y={row.y} width="84" height={row.h} rx="8" fill={row.tone} />
            <text x="634" y={row.y + Math.min(row.h - 6, 16)} fontSize="11" fill="white">{row.label}</text>
          </g>
        ))}
      </svg>
      <figcaption className="text-xs text-muted">Thickness follows Canadian-dollar value. Incoming and outgoing are not the same money.</figcaption>
    </figure>
  );
}

export function VolumeHeatmap({ days }: { days: { date: string; total: number }[] }) {
  const max = Math.max(...days.map((day) => day.total), 1);
  return (
    <div className="grid grid-cols-7 gap-1.5" role="img" aria-label="Daily incoming value">
      {days.map((day) => {
        const strength = day.total / max;
        return (
          <div
            key={day.date}
            title={`${day.date}: ${Math.round(day.total).toLocaleString("en-CA")}`}
            className="aspect-square rounded-md transition duration-200 hover:scale-110 hover:ring-2 hover:ring-brass"
            style={{ background: `linear-gradient(160deg, color-mix(in srgb, ${CHART.vcSoft} ${Math.round(20 + strength * 80)}%, transparent), color-mix(in srgb, var(--color-brass) ${Math.round(24 + strength * 76)}%, transparent))` }}
          />
        );
      })}
    </div>
  );
}

export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const fillId = useId().replace(/:/g, "");
  const width = 120;
  const height = 36;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((value, index) => {
    const x = index * step;
    const y = height - ((value - min) / span) * (height - 4) - 2;
    return [x, y] as const;
  });
  const d = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = points.length > 0 ? `${d} L${width.toFixed(1)} ${height} L0 ${height} Z` : "";
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-9 w-28" role="img" aria-label={label}>
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={CHART.mediumSoft} stopOpacity="0.7" />
          <stop offset="100%" stopColor={CHART.mediumSoft} stopOpacity="0" />
        </linearGradient>
      </defs>
      {area ? <path d={area} fill={`url(#${fillId})`} /> : null}
      <path d={d} fill="none" stroke={CHART.cash} strokeWidth="1.6" />
    </svg>
  );
}

export function RiskGauge({ score, label }: { score: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, score));
  const angle = -210 + (clamped / 100) * 240;
  const radians = (angle * Math.PI) / 180;
  const x = 60 + Math.cos(radians) * 42;
  const y = 64 + Math.sin(radians) * 42;
  return (
    <figure className="flex flex-col items-center">
      <svg viewBox="0 0 120 90" className="h-28 w-36" role="img" aria-label={`${label} ${clamped}`}>
        <path d="M18 70 A42 42 0 1 1 102 70" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="8" strokeLinecap="round" />
        <path d="M18 70 A42 42 0 1 1 102 70" fill="none" stroke="#9a7433" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(clamped / 100) * 176} 176`} />
        <circle cx={x} cy={y} r="4" fill="#12352c" />
        <text x="60" y="68" textAnchor="middle" fontSize="18" fill="currentColor" className="num">
          {clamped}
        </text>
      </svg>
      <figcaption className="text-xs uppercase tracking-wider text-muted">{label}</figcaption>
    </figure>
  );
}
