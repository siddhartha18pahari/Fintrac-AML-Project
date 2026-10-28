"use client";

import { useMemo, useState } from "react";
import { money, num } from "@/lib/format";

export type TuningControl = {
  id: string;
  rule_id: string;
  label: string;
  parameter: string;
  unit: string;
  direction: string;
  default: number;
  min: number;
  max: number;
  step: number;
  help: string;
  observations: number[];
  baseline: number;
};

function project(observations: number[], threshold: number, direction: string) {
  if (direction === "lte") return observations.filter((value) => value <= threshold + 1e-9).length;
  return observations.filter((value) => value + 1e-9 >= threshold).length;
}

function formatThreshold(control: TuningControl, value: number) {
  if (control.unit === "CAD") return money(value);
  if (control.unit === "score" || control.unit === "ratio") return value.toFixed(2);
  return num(value);
}

export function Simulator({ controls, disclaimer }: { controls: TuningControl[]; disclaimer: string }) {
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(controls.map((control) => [control.id, control.default])),
  );
  const rows = useMemo(
    () =>
      controls.map((control) => {
        const threshold = values[control.id] ?? control.default;
        const projected = project(control.observations, threshold, control.direction);
        return { control, threshold, projected, delta: projected - control.baseline };
      }),
    [controls, values],
  );
  const baselineTotal = rows.reduce((sum, row) => sum + row.control.baseline, 0);
  const projectedTotal = rows.reduce((sum, row) => sum + row.projected, 0);

  return (
    <div>
      <p className="mb-4 max-w-3xl text-sm leading-relaxed text-muted">{disclaimer}</p>
      <p className="mb-4 text-sm" aria-live="polite">
        Catalogue settings would count {baselineTotal} observations. The sliders currently count {projectedTotal}.
      </p>
      <div className="space-y-4">
        {rows.map(({ control, threshold, projected, delta }) => {
          const width = control.observations.length ? Math.min(100, (projected / control.observations.length) * 100) : 0;
          const summary = `${control.label} at ${formatThreshold(control, threshold)}. ${projected} observations, ${delta === 0 ? "same as" : delta > 0 ? `${delta} more than` : `${Math.abs(delta)} fewer than`} the catalogue.`;
          return (
            <article key={control.id} className="rounded-2xl border border-line bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">
                  {control.label} <span className="text-xs font-normal text-muted">{control.rule_id}</span>
                </h2>
                <p className="num text-sm">
                  <span className="font-display text-2xl text-spruce">{projected}</span>
                  <span className="text-muted"> / {control.observations.length}</span>
                  <span className={`ml-2 ${delta === 0 ? "text-muted" : delta > 0 ? "text-critical" : "text-low"}`}>
                    {delta === 0 ? "no change" : delta > 0 ? `+${delta}` : delta}
                  </span>
                </p>
              </div>
              <p className="mt-1 text-sm text-muted">{control.help}</p>
              <label className="mt-3 block text-sm" htmlFor={control.id}>
                <span className="mb-1 flex justify-between gap-3 text-xs font-semibold uppercase tracking-wider text-muted">
                  <span>{control.parameter.replaceAll("_", " ")}</span>
                  <span className="num">{formatThreshold(control, threshold)}</span>
                </span>
                <input
                  id={control.id}
                  type="range"
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={threshold}
                  aria-valuetext={summary}
                  onChange={(event) => setValues((current) => ({ ...current, [control.id]: Number(event.target.value) }))}
                  className="w-full"
                />
              </label>
              <div className="mt-2 h-2 rounded-full bg-line" aria-hidden="true">
                <div className="h-2 rounded-full bg-brass" style={{ width: `${width}%` }} />
              </div>
              <p className="sr-only">{summary}</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
