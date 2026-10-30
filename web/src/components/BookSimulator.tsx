"use client";

import { useMemo, useState } from "react";
import { money } from "@/lib/format";
import { SIM_DEFAULTS, simulateBook, type SimControls } from "@/lib/simulator-engine";

const FLAGS: { key: keyof SimControls; label: string }[] = [
  { key: "structuring", label: "Structuring" },
  { key: "layering", label: "Layering" },
  { key: "mules", label: "Mule network" },
  { key: "trade", label: "Trade invoice" },
  { key: "offramp", label: "Crypto off-ramp" },
  { key: "roundTrip", label: "Round-trip" },
  { key: "payroll", label: "Payroll" },
  { key: "rent", label: "Rent" },
];

export function BookSimulator() {
  const [controls, setControls] = useState<SimControls>(SIM_DEFAULTS);
  const book = useMemo(() => simulateBook(controls), [controls]);
  const maxHour = Math.max(1, ...book.summary.byHour);

  function setNumber<K extends keyof SimControls>(key: K, value: number) {
    setControls((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-sm leading-relaxed text-muted">{book.disclaimer}</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Slider label="Customers" min={6} max={24} step={1} value={controls.customers} onChange={(value) => setNumber("customers", value)} />
        <Slider label="Days" min={7} max={45} step={1} value={controls.days} onChange={(value) => setNumber("days", value)} />
        <Slider label="Lognormal μ" min={4} max={8.5} step={0.1} value={controls.mu} onChange={(value) => setNumber("mu", value)} />
        <Slider label="Lognormal σ" min={0.3} max={1.5} step={0.05} value={controls.sigma} onChange={(value) => setNumber("sigma", value)} />
        <Slider label="Seasonality" min={0} max={1} step={0.05} value={controls.seasonality} onChange={(value) => setNumber("seasonality", value)} />
        <Slider label="Night share" min={0} max={0.5} step={0.02} value={controls.nightShare} onChange={(value) => setNumber("nightShare", value)} />
        <Slider label="FX volatility" min={0} max={0.12} step={0.005} value={controls.fxVol} onChange={(value) => setNumber("fxVol", value)} />
        <Slider label="Seed" min={1} max={99} step={1} value={controls.seed} onChange={(value) => setNumber("seed", value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        {FLAGS.map((flag) => (
          <button
            key={flag.key}
            type="button"
            aria-pressed={Boolean(controls[flag.key])}
            onClick={() => setControls((current) => ({ ...current, [flag.key]: !current[flag.key] }))}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${controls[flag.key] ? "bg-spruce text-white" : "border border-line bg-card text-muted"}`}
          >
            {flag.label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Transactions" value={String(book.summary.transactions)} />
        <Stat label="CAD volume" value={money(book.summary.cadTotal)} />
        <Stat label="Rule hits" value={String(book.summary.hitCount)} />
        <Stat label="Window" value={book.summary.windowStart} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <article className="panel glass p-4">
          <h2 className="font-display text-2xl text-spruce">Hour of day</h2>
          <p className="text-sm text-muted">Retail sits in the business day. Planted typologies can use the night, scaled by the night-share control.</p>
          <div className="mt-4 flex h-36 items-end gap-1" aria-hidden="true">
            {book.summary.byHour.map((count, hour) => (
              <div key={hour} className="flex-1 rounded-t bg-brass" style={{ height: `${(count / maxHour) * 100}%`, opacity: hour < 6 ? 0.55 : 1 }} title={`${hour}:00 · ${count}`} />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-muted">
            <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
          </div>
        </article>
        <article className="panel glass p-4">
          <h2 className="font-display text-2xl text-spruce">Live rule hits</h2>
          <ul className="mt-3 max-h-64 space-y-2 overflow-auto text-sm">
            {book.hits.length === 0 ? <li className="text-muted">No indicator fired for this setting.</li> : null}
            {book.hits.map((hit) => (
              <li key={`${hit.ruleId}-${hit.customer}-${hit.txnIds[0]}`} className="rounded-xl border border-line px-3 py-2">
                <p className="font-semibold">{hit.ruleId} <span className="font-normal text-muted">{hit.title}</span></p>
                <p className="text-muted">{hit.customer} · {money(hit.cad)}</p>
                <p>{hit.detail}</p>
              </li>
            ))}
          </ul>
        </article>
      </div>
      <article className="panel glass p-4">
        <h2 className="font-display text-2xl text-spruce">Sample of the book</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-2 py-2">When</th>
                <th className="px-2 py-2">Customer</th>
                <th className="px-2 py-2">Channel</th>
                <th className="px-2 py-2">CAD</th>
                <th className="px-2 py-2">Where</th>
                <th className="px-2 py-2">Pattern</th>
              </tr>
            </thead>
            <tbody>
              {book.transactions.slice(0, 12).map((row) => (
                <tr key={row.id} className="border-t border-line">
                  <td className="px-2 py-2 num">{row.at.replace("T", " ").slice(0, 16)}</td>
                  <td className="px-2 py-2">{row.customer}</td>
                  <td className="px-2 py-2">{row.channel} {row.asset !== "CAD" ? row.asset : ""}</td>
                  <td className="px-2 py-2 num">{money(row.cad)}</td>
                  <td className="px-2 py-2">{row.city} → {row.counterpartyCountry}</td>
                  <td className="px-2 py-2">{row.typology.replaceAll("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

function Slider({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void }) {
  return (
    <label className="rounded-2xl border border-line bg-card px-3 py-2 text-sm">
      <span className="flex justify-between gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
        <span>{label}</span>
        <span className="num">{Number.isInteger(step) ? value : value.toFixed(2)}</span>
      </span>
      <input className="mt-2 w-full" type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-2xl border border-line bg-card px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className="num mt-1 text-2xl font-semibold text-spruce">{value}</p>
    </article>
  );
}
