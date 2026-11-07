"use client";

import { useState } from "react";
import { money } from "@/lib/format";
import type { HeatDay } from "@/lib/incoming-heat";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function mondayIndex(weekday: number) {
  return (weekday + 6) % 7;
}

export function IncomingHeat({
  rows,
  start,
  end,
  max,
}: {
  rows: HeatDay[];
  start: string;
  end: string;
  max: number;
}) {
  const [selected, setSelected] = useState(end);
  const active = rows.find((row) => row.date === selected) ?? rows[rows.length - 1];
  const lead = rows.length ? mondayIndex(rows[0].weekday) : 0;
  const cells: (HeatDay | null)[] = [...Array(lead).fill(null), ...rows];

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted">
        {WEEKDAYS.map((day) => (
          <div key={day}>{day}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1" role="grid" aria-label={`Incoming value ${start} to ${end}`}>
        {cells.map((day, index) => {
          if (!day) return <div key={`pad-${index}`} className="aspect-square" />;
          const strength = max > 0 ? day.total / max : 0;
          const pressed = day.date === active?.date;
          return (
            <button
              key={day.date}
              type="button"
              role="gridcell"
              aria-pressed={pressed}
              aria-label={`${day.date}: ${money(day.total)}, ${day.count} incoming`}
              onClick={() => setSelected(day.date)}
              className="flex aspect-square flex-col items-center justify-center rounded-sm border text-[10px] leading-none"
              style={{
                background: `color-mix(in srgb, var(--color-info) ${Math.round(8 + strength * 82)}%, var(--color-card))`,
                borderColor: pressed ? "var(--color-accent)" : "var(--color-line)",
                color: strength > 0.72 ? "#fff" : "var(--color-ink)",
              }}
            >
              <span className="num">{day.date.slice(8)}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>Lower</span>
        <span className="inline-block h-2 w-24 rounded-sm" style={{ background: "linear-gradient(90deg, color-mix(in srgb, var(--color-info) 8%, var(--color-card)), var(--color-info))" }} />
        <span>Higher incoming CAD</span>
        <span className="num">max {money(max)}</span>
      </div>
      {active ? (
        <div className="chart-tip mt-3" role="status">
          <p className="text-sm font-semibold text-ink">{active.date}</p>
          <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted">Incoming</dt>
              <dd className="num font-semibold">{money(active.total)}</dd>
            </div>
            <div>
              <dt className="text-muted">Count</dt>
              <dd className="num font-semibold">{active.count}</dd>
            </div>
            <div>
              <dt className="text-muted">Cash / wires</dt>
              <dd className="num">{money(active.cash)} · {money(active.eft)}</dd>
            </div>
            <div>
              <dt className="text-muted">Virtual currency</dt>
              <dd className="num">{money(active.virtual)}</dd>
            </div>
          </dl>
          {active.count === 0 ? <p className="mt-2 text-xs text-muted">No incoming transaction on this date. The cell is zero, not a missing day.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
