"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CrossBorderMap } from "@/components/bank-sim/CrossBorderMap";
import { FlowCanvas } from "@/components/bank-sim/FlowCanvas";
import { PRESETS, SIM_DEFAULTS, injectPlant, scoreBook, simulateBook } from "@/lib/bank-sim/engine";
import type { SimBook, SimControls, SimHit, SimTxn } from "@/lib/bank-sim/types";
import { money, when } from "@/lib/format";
import { useReducedMotion } from "@/lib/motion";
import { saveSimCase } from "@/lib/sim-cases";

const INITIAL: SimControls = { ...SIM_DEFAULTS, ...PRESETS.find((preset) => preset.id === "full")!.controls };

const TOGGLES: { key: keyof SimControls; label: string }[] = [
  { key: "structuring", label: "Structuring" },
  { key: "mules", label: "Mules" },
  { key: "layering", label: "Layering" },
  { key: "trade", label: "Trade" },
  { key: "funnel", label: "Funnel" },
  { key: "rapid", label: "Rapid" },
  { key: "offramp", label: "Off-ramp" },
  { key: "roundTrip", label: "Round-trip" },
  { key: "professional", label: "Professional" },
  { key: "payroll", label: "Payroll" },
  { key: "rent", label: "Rent" },
];

const INJECT = [
  ["structuring", "Structuring"],
  ["mules", "Mule network"],
  ["layering", "Layering"],
  ["trade", "Trade invoice"],
  ["funnel", "Funnel"],
  ["rapid", "Rapid in/out"],
  ["offramp", "Crypto off-ramp"],
  ["round_trip", "Round-trip"],
  ["professional", "Professional network"],
] as const;

type WorkerResult = { id: number; book: SimBook };

export function BankSimulator() {
  const reduce = useReducedMotion();
  const [controls, setControls] = useState<SimControls>(INITIAL);
  const [presetId, setPresetId] = useState("full");
  const [book, setBook] = useState<SimBook | null>(null);
  const [playhead, setPlayhead] = useState("");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 4 | 16 | 64>(4);
  const [selected, setSelected] = useState<string>("");
  const [injectKind, setInjectKind] = useState<string>("structuring");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(true);
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef(0);
  const bookRef = useRef<SimBook | null>(null);

  useEffect(() => {
    bookRef.current = book;
  }, [book]);

  useEffect(() => {
    let worker: Worker | null = null;
    let cancelled = false;
    const id = requestRef.current + 1;
    requestRef.current = id;
    setBusy(true);
    setPlaying(false);
    setPlayhead("");
    setSelected("");
    try {
      worker = new Worker(new URL("../../workers/bank-sim.worker.ts", import.meta.url));
      worker.onmessage = (event: MessageEvent<WorkerResult>) => {
        if (cancelled || event.data.id !== requestRef.current) return;
        setBook(event.data.book);
        setBusy(false);
      };
      worker.onerror = () => {
        if (cancelled) return;
        workerRef.current = null;
        setBook(simulateBook(controls));
        setBusy(false);
      };
      workerRef.current = worker;
      worker.postMessage({ id, type: "simulate", controls });
    } catch {
      workerRef.current = null;
      setBook(simulateBook(controls));
      setBusy(false);
    }
    return () => {
      cancelled = true;
      worker?.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, [controls]);

  useEffect(() => {
    if (!playing || !book) return;
    const last = book.transactions.at(-1)?.at ?? "";
    if (playhead && last && playhead >= last) {
      setPlaying(false);
      return;
    }
    const minutes = reduce ? 60 * 18 : speed === 1 ? 40 : speed === 4 ? 160 : speed === 16 ? 60 * 10 : 60 * 24;
    const timer = window.setTimeout(() => {
      setPlayhead((current) => {
        const base = current || `${book.summary.windowStart}T00:00:00`;
        const next = new Date(Date.parse(`${base}Z`) + minutes * 60000).toISOString().slice(0, 19);
        return !last || next > last ? last : next;
      });
    }, reduce ? 480 : 90);
    return () => window.clearTimeout(timer);
  }, [playing, playhead, book, speed, reduce]);

  const view = useMemo(() => {
    if (!book) return null;
    const rows = book.transactions.filter((row) => playhead && row.at <= playhead);
    const ids = new Set(rows.map((row) => row.id));
    const hits = book.hits.filter((hit) => hit.txnIds.length > 0 && hit.txnIds.every((id) => ids.has(id)));
    return { rows, hits, evaluation: scoreBook(rows, hits) };
  }, [book, playhead]);

  const active = view?.hits.find((hit) => hitKey(hit) === selected) ?? null;
  const startMs = book ? Date.parse(`${book.summary.windowStart}T00:00:00Z`) : 0;
  const endMs = book?.transactions.at(-1) ? Date.parse(`${book.transactions.at(-1)!.at}Z`) : startMs;
  const headMs = playhead ? Date.parse(`${playhead}Z`) : startMs;

  function apply(partial: Partial<SimControls>) {
    setPresetId("");
    setControls((current) => ({ ...current, ...partial, preset: "" }));
  }

  function choosePreset(id: string) {
    const preset = PRESETS.find((item) => item.id === id);
    if (!preset) return;
    setPresetId(id);
    setControls({ ...SIM_DEFAULTS, ...preset.controls });
  }

  function inject() {
    const current = bookRef.current;
    if (!current) return;
    const at = playhead || current.transactions[0]?.at || `${current.summary.windowStart}T12:00:00`;
    const id = requestRef.current + 1;
    requestRef.current = id;
    setBusy(true);
    setNotice(`Injected ${injectKind.replaceAll("_", " ")} at ${when(at)}.`);
    if (workerRef.current) {
      workerRef.current.postMessage({ id, type: "inject", book: current, typology: injectKind, at });
      return;
    }
    setBook(injectPlant(current, injectKind, at));
    setBusy(false);
  }

  function send(hit: SimHit) {
    saveSimCase({
      title: hit.title,
      customer: hit.customer,
      ruleId: hit.ruleId,
      typology: hit.planted.filter((item) => item !== "retail").join(", ") || "benign",
      cad: hit.cad,
      truth: hit.truth,
      caught: hit.caught,
      txnCount: hit.txnIds.length,
    });
    setNotice(`${hit.ruleId} for ${hit.customer} is on the case desk in this browser.`);
  }

  return (
    <div className="space-y-5" data-testid="bank-simulator">
      <p className="max-w-3xl text-sm leading-relaxed text-muted">{book?.disclaimer ?? "Synthetic customers only. Planted labels score the rules. They are not a way to move value."}</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5" data-testid="sim-presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            aria-pressed={presetId === preset.id}
            onClick={() => choosePreset(preset.id)}
            className={`rounded-2xl border px-3 py-3 text-left ${presetId === preset.id ? "border-brass bg-brass-soft/40" : "border-line bg-card"}`}
          >
            <span className="block font-semibold">{preset.name}</span>
            <span className="mt-1 block text-xs leading-relaxed text-muted">{preset.blurb}</span>
          </button>
        ))}
      </div>

      <div className="panel glass flex flex-wrap items-center gap-3 p-3" data-testid="sim-transport">
        <button type="button" className="rounded-full bg-spruce px-4 py-2 text-sm font-semibold text-white" onClick={() => setPlaying((value) => !value)} data-testid="sim-play">
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" className="rounded-full border border-line px-3 py-2 text-sm" onClick={() => book && setPlayhead(book.transactions.at(-1)?.at ?? "")}>
          Jump to end
        </button>
        <div className="flex rounded-full border border-line p-0.5" role="group" aria-label="Playback speed">
          {([1, 4, 16, 64] as const).map((value) => (
            <button key={value} type="button" aria-pressed={speed === value} className={`rounded-full px-3 py-1.5 text-sm ${speed === value ? "bg-spruce text-white" : ""}`} onClick={() => setSpeed(value)}>
              {value}×
            </button>
          ))}
        </div>
        <label className="min-w-[220px] flex-1 text-xs font-semibold uppercase tracking-wider text-muted">
          Playhead <span className="num float-right normal-case">{playhead ? when(playhead) : "Not started"}</span>
          <input
            className="mt-1 w-full"
            type="range"
            min={startMs}
            max={Math.max(startMs + 1, endMs)}
            step={60000}
            value={Number.isFinite(headMs) ? headMs : startMs}
            onChange={(event) => {
              setPlaying(false);
              setPlayhead(new Date(Number(event.target.value)).toISOString().slice(0, 19));
            }}
            aria-label="Timeline"
          />
        </label>
        <label className="text-sm">
          <span className="mr-2 text-xs font-semibold uppercase tracking-wider text-muted">Inject</span>
          <select className="rounded-full border border-line bg-card px-2 py-1" value={injectKind} onChange={(event) => setInjectKind(event.target.value)} aria-label="Typology to inject">
            {INJECT.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <button type="button" className="rounded-full border border-line px-3 py-2 text-sm font-semibold" onClick={inject} disabled={!book || busy}>
          Inject at playhead
        </button>
      </div>
      {notice ? <p className="text-sm text-spruce" role="status">{notice}</p> : null}

      <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
        <aside className="space-y-3">
          <Slider label="Customers" min={6} max={48} step={1} value={controls.customers} onChange={(value) => apply({ customers: value })} />
          <Slider label="Days" min={7} max={60} step={1} value={controls.days} onChange={(value) => apply({ days: value })} />
          <Slider label="Seed" min={1} max={99} step={1} value={controls.seed} onChange={(value) => apply({ seed: value })} />
          <Slider label="Lognormal μ" min={4} max={8.5} step={0.1} value={controls.mu} onChange={(value) => apply({ mu: value })} />
          <Slider label="Lognormal σ" min={0.3} max={1.5} step={0.05} value={controls.sigma} onChange={(value) => apply({ sigma: value })} />
          <Slider label="Seasonality" min={0} max={1} step={0.05} value={controls.seasonality} onChange={(value) => apply({ seasonality: value })} />
          <Slider label="Night share" min={0} max={0.5} step={0.02} value={controls.nightShare} onChange={(value) => apply({ nightShare: value })} />
          <Slider label="FX volatility" min={0} max={0.12} step={0.005} value={controls.fxVol} onChange={(value) => apply({ fxVol: value })} />
          <Slider label="Typology intensity" min={0} max={1} step={0.05} value={controls.intensity} onChange={(value) => apply({ intensity: value })} />
          <Slider label="Camouflage" min={0} max={1} step={0.05} value={controls.camouflage} onChange={(value) => apply({ camouflage: value })} />
          <div className="flex flex-wrap gap-2">
            {TOGGLES.map((toggle) => (
              <button
                key={toggle.key}
                type="button"
                aria-pressed={Boolean(controls[toggle.key])}
                onClick={() => apply({ [toggle.key]: !controls[toggle.key] } as Partial<SimControls>)}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ${controls[toggle.key] ? "bg-spruce text-white" : "border border-line bg-card text-muted"}`}
              >
                {toggle.label}
              </button>
            ))}
          </div>
        </aside>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Revealed" value={busy ? "…" : String(view?.rows.length ?? 0)} />
            <Stat label="CAD in view" value={money(view?.rows.reduce((sum, row) => sum + row.cad, 0) ?? 0)} />
            <Stat label="Rule hits" value={String(view?.hits.length ?? 0)} />
            <Stat label="Recall" value={view ? percent(view.evaluation.recall) : "—"} />
          </div>
          <Ticker rows={view?.rows ?? []} />
          <div className="grid gap-4 xl:grid-cols-2">
            <FlowCanvas rows={view?.rows ?? []} reduce={reduce} />
            <CrossBorderMap rows={view?.rows ?? []} />
          </div>
          <RuleCounters hits={view?.hits ?? []} />
          <Metrics evaluation={view?.evaluation ?? null} />
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <AlertList hits={view?.hits ?? []} selected={selected} onSelect={setSelected} />
            <Explain hit={active} book={book} onSend={send} />
          </div>
          <ExportBar book={book} />
        </div>
      </div>
    </div>
  );
}

function hitKey(hit: SimHit) {
  return `${hit.ruleId}:${hit.customer}:${hit.txnIds[0] ?? ""}`;
}

function percent(value: number) {
  return `${Math.round(value * 1000) / 10}%`;
}

function Ticker({ rows }: { rows: SimTxn[] }) {
  const latest = [...rows].reverse().slice(0, 6);
  return (
    <article className="panel glass p-4" data-testid="sim-ticker">
      <h2 className="font-display text-2xl text-spruce">Live tape</h2>
      {latest.length === 0 ? <p className="mt-3 text-sm text-muted">The tape fills as the clock moves.</p> : null}
      <ul className="mt-3 space-y-2">
        {latest.map((row) => (
          <li key={row.id} className={`grid gap-1 rounded-xl border px-3 py-2 text-sm md:grid-cols-[9rem_1fr_auto] ${row.groundTruth === "suspicious" ? "border-high/50" : "border-line"}`}>
            <span className="num text-muted">{when(row.at)}</span>
            <span>
              <strong>{row.customer}</strong> {row.direction === "IN" ? "received" : "sent"} {money(row.cad)} via {row.channel.replaceAll("_", " ")}
              {row.mcc ? ` · MCC ${row.mcc}` : ""} · {row.counterparty || row.beneficiary || "internal"}
            </span>
            <span className="text-muted">{row.city} → {row.counterpartyCountry}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function RuleCounters({ hits }: { hits: SimHit[] }) {
  const counts = new Map<string, number>();
  for (const hit of hits) counts.set(hit.ruleId, (counts.get(hit.ruleId) ?? 0) + 1);
  const entries = [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0]));
  return (
    <article className="panel glass p-4" data-testid="sim-rules">
      <h2 className="font-display text-2xl text-spruce">Rules lighting up</h2>
      {entries.length === 0 ? <p className="mt-3 text-sm text-muted">No rule has the whole pattern in view yet.</p> : null}
      <ul className="mt-3 flex flex-wrap gap-2">
        {entries.map(([rule, count]) => (
          <li key={rule} className="rounded-full bg-spruce px-3 py-1.5 text-sm font-semibold text-white">
            {rule} <span className="num">{count}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function Metrics({ evaluation }: { evaluation: SimBook["evaluation"] | null }) {
  if (!evaluation) return null;
  const cells = [
    ["Suspicious, flagged", evaluation.tp],
    ["Suspicious, clear", evaluation.fn],
    ["Benign, flagged", evaluation.fp],
    ["Benign, clear", evaluation.tn],
  ];
  return (
    <article className="panel glass p-4" data-testid="sim-metrics">
      <h2 className="font-display text-2xl text-spruce">Against the planted labels</h2>
      <p className="text-sm text-muted">Precision {percent(evaluation.precision)} · recall {percent(evaluation.recall)} · F1 {percent(evaluation.f1)} · alert precision {percent(evaluation.alertPrecision)} · median time to detect {evaluation.medianHoursToDetect === null ? "—" : `${evaluation.medianHoursToDetect} h`}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-md">
        {cells.map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-line px-3 py-2">
            <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
            <p className="num text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <ul className="mt-4 space-y-2">
        {evaluation.byTypology.map((item) => (
          <li key={item.typology}>
            <div className="flex justify-between text-sm">
              <span>{item.typology.replaceAll("_", " ")}</span>
              <span className="num">{item.detected}/{item.plants} · {percent(item.rate)}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-line">
              <div className="h-2 rounded-full bg-brass" style={{ width: `${Math.round(item.rate * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </article>
  );
}

function AlertList({ hits, selected, onSelect }: { hits: SimHit[]; selected: string; onSelect: (id: string) => void }) {
  return (
    <article className="panel glass p-4">
      <h2 className="font-display text-2xl text-spruce">Alerts</h2>
      <ul className="mt-3 max-h-80 space-y-2 overflow-auto">
        {hits.length === 0 ? <li className="text-sm text-muted">Alerts appear when every transaction in the pattern has been revealed.</li> : null}
        {hits.map((hit) => {
          const id = hitKey(hit);
          return (
            <li key={id}>
              <button type="button" onClick={() => onSelect(id)} aria-pressed={selected === id} className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${selected === id ? "border-brass bg-brass-soft/30" : "border-line"}`}>
                <span className="font-semibold">{hit.ruleId}</span> <span className="text-muted">{hit.title}</span>
                <span className="mt-1 block text-muted">{hit.customer} · {money(hit.cad)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

function Explain({ hit, book, onSend }: { hit: SimHit | null; book: SimBook | null; onSend: (hit: SimHit) => void }) {
  const [sent, setSent] = useState(false);
  useEffect(() => {
    setSent(false);
  }, [hit]);
  if (!hit || !book) {
    return (
      <article className="panel glass p-4" data-testid="sim-explain">
        <h2 className="font-display text-2xl text-spruce">Explain this alert</h2>
        <p className="mt-3 text-sm text-muted">Choose an alert to compare the planted label with the transactions the rule actually used.</p>
      </article>
    );
  }
  const byId = new Map(book.transactions.map((row) => [row.id, row]));
  const caught = hit.txnIds.map((id) => byId.get(id)).filter((row): row is SimTxn => Boolean(row));
  const missed = hit.missedIds.map((id) => byId.get(id)).filter((row): row is SimTxn => Boolean(row));
  return (
    <article className="panel glass p-4" data-testid="sim-explain">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="font-display text-2xl text-spruce">{hit.ruleId}</h2>
        <button type="button" className="rounded-full bg-spruce px-3 py-1.5 text-sm font-semibold text-white" onClick={() => { onSend(hit); setSent(true); }}>
          {sent ? "On the case desk" : "Send to case desk"}
        </button>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-line p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Planted truth</p>
          <p className="mt-1">{hit.truth}</p>
        </div>
        <div className="rounded-xl border border-line p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">What the rule caught</p>
          <p className="mt-1">{hit.caught}</p>
        </div>
      </div>
      <table className="mt-3 w-full text-left text-sm">
        <caption className="sr-only">Transactions in the alert and the rest of the planted flow</caption>
        <thead className="text-xs uppercase tracking-wider text-muted">
          <tr>
            <th className="py-1">When</th>
            <th>Who</th>
            <th>CAD</th>
            <th>In the alert</th>
          </tr>
        </thead>
        <tbody>
          {caught.map((row) => (
            <tr key={row.id} className="border-t border-line">
              <td className="num py-1">{when(row.at)}</td>
              <td>{row.customer}</td>
              <td className="num">{money(row.cad)}</td>
              <td>Yes · {row.typology.replaceAll("_", " ")}</td>
            </tr>
          ))}
          {missed.map((row) => (
            <tr key={row.id} className="border-t border-line text-muted">
              <td className="num py-1">{when(row.at)}</td>
              <td>{row.customer}</td>
              <td className="num">{money(row.cad)}</td>
              <td>Same plant, not in this alert</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}

function ExportBar({ book }: { book: SimBook | null }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="rounded-full border border-line px-3 py-2 text-sm font-semibold" disabled={!book} onClick={() => book && download(`sentinel-book-${book.controls.seed}.json`, JSON.stringify(book, null, 2), "application/json")}>
        Export JSON
      </button>
      <button type="button" className="rounded-full border border-line px-3 py-2 text-sm font-semibold" disabled={!book} onClick={() => book && download(`sentinel-book-${book.controls.seed}.csv`, toCsv(book.transactions), "text/csv")}>
        Export CSV
      </button>
    </div>
  );
}

function toCsv(rows: SimTxn[]) {
  const headers = ["id", "at", "customer", "occupation", "incomeBand", "accountType", "accountNumber", "city", "province", "direction", "channel", "method", "disposition", "asset", "amountAsset", "fxRate", "cad", "mcc", "counterparty", "counterpartyCountry", "counterpartyBank", "purpose", "beneficiary", "thresholdIndicator", "typology", "groundTruth", "flowId"];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((key) => csv(String(row[key as keyof SimTxn] ?? ""))).join(","));
  }
  return lines.join("\n");
}

function csv(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function Slider({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void }) {
  const shown = Number.isInteger(step) ? String(value) : value.toFixed(2);
  return (
    <label className="block rounded-2xl border border-line bg-card px-3 py-2 text-sm">
      <span className="flex justify-between gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
        <span>{label}</span>
        <span className="num">{shown}</span>
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
