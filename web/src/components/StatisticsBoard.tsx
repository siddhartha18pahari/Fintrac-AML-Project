"use client";

import { useMemo, useState } from "react";
import { AssistNote, SourceNote } from "@/components/Assist";
import {
  benfordTest,
  correlationMatrix,
  decompose,
  gaussianKde,
  histogram,
  iqrFences,
  isolationScores,
  mean,
  metricsAtThreshold,
  rocCurve,
  zscores,
} from "@/lib/statistics";

export type StatCustomer = {
  id: number;
  name: string;
  group: string;
  residual: number;
  anomaly: number;
};

export type StatTxn = {
  customerId: number;
  customer: string;
  at: string;
  cad: number;
  scenario: string;
  instrument: string;
};

const BENIGN = new Set(["normal_retail", "demo_baseline", "casino_ordinary_play", "trade_within_tolerance", ""]);
const BASELINE = 0.6;
const LABELS: Record<string, string> = {
  count: "Txn count",
  total: "Total CAD",
  mean: "Mean CAD",
  instruments: "Rails",
  anomaly: "Anomaly",
  residual: "Residual",
};

export function StatisticsBoard({
  transactions,
  customers,
  series,
  plantedRecall,
  modelName,
  computedAt,
}: {
  transactions: StatTxn[];
  customers: StatCustomer[];
  series: { date: string; total: number }[];
  plantedRecall: number | null;
  modelName: string;
  computedAt: string;
}) {
  const amounts = useMemo(() => transactions.map((row) => row.cad).filter((value) => value > 0), [transactions]);
  const model = useMemo(() => {
    const logs = amounts.map((value) => Math.log10(value));
    const byCustomer = new Map<number, StatTxn[]>();
    for (const row of transactions) {
      const list = byCustomer.get(row.customerId) ?? [];
      list.push(row);
      byCustomer.set(row.customerId, list);
    }
    const columns = { count: [] as number[], total: [] as number[], mean: [] as number[], instruments: [] as number[], anomaly: [] as number[], residual: [] as number[] };
    const matrix: number[][] = [];
    const labels: number[] = [];
    const scores: number[] = [];
    const people: { id: number; name: string; score: number; label: number }[] = [];
    const peers: { name: string; group: string; value: number; ratio: number }[] = [];
    const groups = new Map<string, number[]>();
    for (const customer of customers) {
      const rows = byCustomer.get(customer.id) ?? [];
      const total = rows.reduce((sum, row) => sum + row.cad, 0);
      const values = groups.get(customer.group) ?? [];
      values.push(total);
      groups.set(customer.group, values);
    }
    for (const customer of customers) {
      const rows = byCustomer.get(customer.id) ?? [];
      if (!rows.length) continue;
      const total = rows.reduce((sum, row) => sum + row.cad, 0);
      const instruments = new Set(rows.map((row) => row.instrument)).size;
      columns.count.push(rows.length);
      columns.total.push(total);
      columns.mean.push(mean(rows.map((row) => row.cad)));
      columns.instruments.push(instruments);
      columns.anomaly.push(customer.anomaly);
      columns.residual.push(customer.residual);
      matrix.push([rows.length, total, mean(rows.map((row) => row.cad)), instruments, customer.anomaly]);
      const suspicious = rows.some((row) => row.scenario && !BENIGN.has(row.scenario));
      const label = suspicious ? 1 : 0;
      labels.push(label);
      scores.push(customer.anomaly);
      people.push({ id: customer.id, name: customer.name, score: customer.anomaly, label });
      const peerValues = (groups.get(customer.group) ?? []).slice().sort((left, right) => left - right);
      const mid = peerValues[Math.floor(peerValues.length / 2)] || 0;
      peers.push({ name: customer.name, group: customer.group, value: total, ratio: mid ? total / mid : 0 });
    }
    peers.sort((left, right) => right.ratio - left.ratio);
    const isolation = matrix.length ? isolationScores(matrix, 24, 20260811) : [];
    const ranked = isolation
      .map((score, index) => ({ name: customers.filter((customer) => (byCustomer.get(customer.id) ?? []).length)[index]?.name, score }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 5);
    const daily = series.map((point) => point.total);
    return {
      benford: benfordTest(amounts),
      fences: iqrFences(amounts),
      zOver: zscores(amounts).filter((score) => Math.abs(score) >= 3).length,
      histogram: histogram(logs, 14),
      kde: gaussianKde(logs, 32),
      correlation: correlationMatrix(columns),
      parts: decompose(daily, 7),
      dates: series.map((point) => point.date),
      observed: daily,
      roc: rocCurve(scores, labels),
      scores,
      labels,
      people,
      peers: peers.slice(0, 6),
      ranked,
      velocity: [...byCustomer.entries()]
        .map(([id, rows]) => {
          const ordered = [...rows].sort((left, right) => left.at.localeCompare(right.at));
          let best = 0;
          ordered.forEach((start, index) => {
            const startAt = Date.parse(start.at.endsWith("Z") ? start.at : `${start.at}Z`);
            let total = 0;
            for (const row of ordered.slice(index)) {
              const at = Date.parse(row.at.endsWith("Z") ? row.at : `${row.at}Z`);
              if (at - startAt > 24 * 3600_000) break;
              total += row.cad;
            }
            best = Math.max(best, total);
          });
          return { name: customers.find((customer) => customer.id === id)?.name ?? String(id), best };
        })
        .sort((left, right) => right.best - left.best)
        .slice(0, 5),
    };
  }, [amounts, customers, series, transactions]);

  const maxBar = Math.max(1, ...model.histogram.counts, ...model.benford.counts);

  return (
    <div className="space-y-5">
      <AssistNote title="What these charts are allowed to say">
        Benford, fences and the anomaly score describe the synthetic book. The tuner classifies customers against planted scenario labels. Move the score until the confusion counts change. A reporting threshold of CAD 10,000 is not on this slider and is not suspicion.
      </AssistNote>
      <p className="max-w-3xl text-sm leading-6 text-muted">
        Precision, recall and the ROC use planted scenario labels in this synthetic book. They are not a measure of money-laundering detection. A reporting threshold is not suspicion.
        {plantedRecall != null ? ` Planted-indicator recall on the quality page is ${(plantedRecall * 100).toFixed(0)}%.` : ""}
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Benford first digits" lede={`MAD ${model.benford.mad.toFixed(4)} · ${model.benford.conformity} · n=${model.benford.n}`}>
          <div className="flex h-40 items-end gap-2">
            {model.benford.counts.map((count, index) => (
              <div key={index} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-32 w-full items-end gap-0.5">
                  <div className="w-1/2 rounded-t bg-brass" style={{ height: `${(count / maxBar) * 100}%` }} title={`Digit ${index + 1}: ${count}`} />
                  <div className="w-1/2 rounded-t bg-info/50" style={{ height: `${(model.benford.expected[index] * model.benford.n / maxBar) * 100}%` }} />
                </div>
                <span className="num text-[10px] text-muted">{index + 1}</span>
              </div>
            ))}
          </div>
          <SourceNote>First significant digit of each positive cad_value in the snapshot ledger. Brass is the count. Blue is the Benford expectation for the same n. Conformity is a digit screen, not a finding.</SourceNote>
        </Panel>
        <Panel title="Amount distribution" lede={`${model.fences.outlierCount} IQR outliers · ${model.zOver} |z| ≥ 3`}>
          <svg viewBox="0 0 320 140" className="h-40 w-full" role="img" aria-label="Histogram of log10 CAD amounts">
            <text x="4" y="12" fontSize="10" fill="currentColor">count</text>
            <text x="250" y="136" fontSize="10" fill="currentColor">log10 CAD</text>
            {model.histogram.counts.map((count, index) => {
              const width = 320 / model.histogram.counts.length;
              const height = (count / maxBar) * 100;
              return <rect key={index} x={index * width + 1} y={118 - height} width={width - 2} height={height} fill="#8a5a12" />;
            })}
            <polyline
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              points={model.kde.density.map((density, index) => {
                const maxDensity = Math.max(...model.kde.density, 1e-9);
                const x = (index / Math.max(1, model.kde.density.length - 1)) * 320;
                const y = 118 - (density / maxDensity) * 100;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              }).join(" ")}
            />
          </svg>
          <SourceNote>Positive CAD amounts, log10. The line is a Gaussian kernel density on the same values. IQR fences are {model.fences.low.toFixed(0)} to {model.fences.high.toFixed(0)} CAD. Outgoing and incoming are both included. No amount is excluded for being large.</SourceNote>
        </Panel>
      </div>
      <ThresholdTuner
        people={model.people}
        roc={model.roc}
        modelName={modelName}
        computedAt={computedAt}
      />
      <CorrelationPanel matrix={model.correlation} />
      <Panel title="Daily incoming series, trend and weekday" lede="Additive decomposition, period 7, on days that have incoming value">
        <svg viewBox="0 0 640 160" className="h-40 w-full" role="img" aria-label="Observed incoming series and trend">
          <Series points={model.observed} color="#8a5a12" />
          <Series points={model.parts.trend} color="#1d4e89" />
        </svg>
        <SourceNote>
          The series is incoming CAD by day. Days with no incoming row are omitted here, so the weekday pattern is over observed days only ({model.dates[0]} to {model.dates.at(-1)}, n={model.observed.length}). Brass is the daily total. Blue is a centred moving average of period 7. Residual mean {mean(model.parts.residual).toFixed(1)} CAD.
        </SourceNote>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Isolation-style scores" lede="Short paths score higher. A browser illustration, not the stored model.">
          <ul className="space-y-2 text-sm">
            {model.ranked.map((row) => (
              <li key={row.name} className="flex justify-between gap-3">
                <span>{row.name}</span>
                <span className="num">{row.score.toFixed(3)}</span>
              </li>
            ))}
          </ul>
          <SourceNote>Recomputed in the browser from count, total CAD, mean CAD, rail count and the stored anomaly score. It is not the snapshot model named above.</SourceNote>
        </Panel>
        <Panel title="24-hour velocity" lede="Highest CAD inside any one-day window">
          <ul className="space-y-2 text-sm">
            {model.velocity.map((row) => (
              <li key={row.name} className="flex justify-between gap-3">
                <span>{row.name}</span>
                <span className="num">{Math.round(row.best).toLocaleString("en-CA")}</span>
              </li>
            ))}
          </ul>
          <SourceNote>For each customer, the maximum sum of cad_value inside any 24-hour span of that customer’s transactions. Both directions are included.</SourceNote>
        </Panel>
        <Panel title="Peer ratio" lede="Volume divided by the occupation median">
          <ul className="space-y-2 text-sm">
            {model.peers.map((row) => (
              <li key={row.name} className="flex justify-between gap-3">
                <span>{row.name}<span className="block text-xs text-muted">{row.group}</span></span>
                <span className="num">{row.ratio.toFixed(2)}×</span>
              </li>
            ))}
          </ul>
          <SourceNote>Group is the occupation or business on the customer. The ratio is that customer’s total CAD divided by the median total in the same group.</SourceNote>
        </Panel>
      </div>
    </div>
  );
}

function ThresholdTuner({
  people,
  roc,
  modelName,
  computedAt,
}: {
  people: { id: number; name: string; score: number; label: number }[];
  roc: ReturnType<typeof rocCurve>;
  modelName: string;
  computedAt: string;
}) {
  const [threshold, setThreshold] = useState(BASELINE);
  const [showAll, setShowAll] = useState(false);
  const scores = people.map((person) => person.score);
  const labels = people.map((person) => person.label);
  const ready = people.length > 0;
  const tuned = metricsAtThreshold(scores, labels, threshold);
  const baseline = metricsAtThreshold(scores, labels, BASELINE);
  const cuts = [...new Set(scores)].sort((left, right) => left - right);
  const nextUp = cuts.find((score) => score > threshold + 1e-9);
  const nextDown = [...cuts].reverse().find((score) => score < threshold - 1e-9);
  const changed = people.filter((person) => (person.score >= threshold) !== (person.score >= BASELINE));
  const rows = (showAll ? people : changed).slice().sort((left, right) => right.score - left.score);
  const marker = [...roc.points].reverse().find((point) => point.threshold != null && point.threshold >= threshold) ?? roc.points[roc.points.length - 1];

  return (
    <Panel title="Threshold tuner" lede={`${modelName} · computed ${computedAt.replace("T", " ").slice(0, 16)} UTC · AUC ${roc.auc.toFixed(2)} · planted positives ${roc.positives} of ${people.length}`}>
      <p className="text-sm leading-6 text-muted">
        The slider is the anomaly score, from 0 to 1. A customer is called positive when the stored score is greater than or equal to the line. The baseline shipped with the book is {BASELINE.toFixed(2)}. Labels are planted scenarios on the synthetic transactions, not production outcomes.
      </p>
      <label className="mt-3 block text-sm">
        <span className="mb-1 flex justify-between text-xs font-semibold uppercase tracking-wide text-muted">
          <span>Proposed score</span>
          <span className="num">{threshold.toFixed(2)}</span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={threshold}
          disabled={!ready}
          onChange={(event) => setThreshold(Number(event.target.value))}
          className="w-full"
        />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary" onClick={() => setThreshold(BASELINE)} disabled={!ready}>Reset to {BASELINE.toFixed(2)}</button>
        <button type="button" className="btn btn-secondary" disabled={nextDown == null} onClick={() => nextDown != null && setThreshold(Number(nextDown.toFixed(2)))}>Previous cut {nextDown?.toFixed(3) ?? "—"}</button>
        <button type="button" className="btn btn-secondary" disabled={nextUp == null} onClick={() => nextUp != null && setThreshold(Number(nextUp.toFixed(2)))}>Next cut {nextUp?.toFixed(3) ?? "—"}</button>
      </div>
      {!ready ? <p className="mt-3 text-sm text-muted">No scored customers in this snapshot. The tuner is disabled.</p> : null}
      <p className="mt-3 text-sm">
        <span className="num font-semibold">{tuned.tp + tuned.fp}</span> customers at or above the line
        {changed.length === 0 ? " — same classifications as the baseline." : ` — ${changed.length} classification${changed.length === 1 ? "" : "s"} differ from the baseline.`}
      </p>
      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_220px]">
        <div>
          <table className="w-full text-sm">
            <caption className="sr-only">Confusion matrix against planted labels</caption>
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-1" />
                <th className="py-1">Planted positive</th>
                <th className="py-1">Planted negative</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" className="py-1 pr-2 text-left font-medium">Score ≥ line</th>
                <td className="num">TP {tuned.tp} <Delta now={tuned.tp} base={baseline.tp} /></td>
                <td className="num">FP {tuned.fp} <Delta now={tuned.fp} base={baseline.fp} /></td>
              </tr>
              <tr>
                <th scope="row" className="py-1 pr-2 text-left font-medium">Score below</th>
                <td className="num">FN {tuned.fn} <Delta now={tuned.fn} base={baseline.fn} /></td>
                <td className="num">TN {tuned.tn} <Delta now={tuned.tn} base={baseline.tn} /></td>
              </tr>
            </tbody>
          </table>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <Metric label="Precision" value={tuned.precision} base={baseline.precision} />
            <Metric label="Recall" value={tuned.recall} base={baseline.recall} />
            <Metric label="False positive rate" value={tuned.falsePositiveRate} base={baseline.falsePositiveRate} />
          </dl>
          <p className="mt-2 text-xs leading-5 text-muted">
            Raising the line marks fewer customers. Recall and the false-positive rate usually fall. Precision can move either way. Rates are blank when a denominator is zero.
          </p>
        </div>
        <svg viewBox="0 0 220 160" className="h-40 w-full" role="img" aria-label="ROC curve with the proposed operating point">
          <text x="20" y="12" fontSize="10" fill="currentColor">TPR</text>
          <text x="168" y="154" fontSize="10" fill="currentColor">FPR</text>
          <line x1="20" y1="10" x2="20" y2="140" stroke="currentColor" opacity="0.35" />
          <line x1="20" y1="140" x2="200" y2="140" stroke="currentColor" opacity="0.35" />
          <line x1="20" y1="140" x2="200" y2="10" stroke="currentColor" opacity="0.2" />
          <polyline fill="none" stroke="#8a5a12" strokeWidth="1.6" points={roc.points.map((point) => `${20 + point.fpr * 180},${140 - point.tpr * 120}`).join(" ")} />
          {marker ? <circle cx={20 + marker.fpr * 180} cy={140 - marker.tpr * 120} r="4" fill="#1d4e89" /> : null}
        </svg>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Classifications</h3>
        <button type="button" className="btn btn-secondary" aria-pressed={showAll} onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Changed only" : "Show all scored customers"}
        </button>
      </div>
      {rows.length === 0 ? <p className="mt-2 text-sm text-muted">No customer changes class between {BASELINE.toFixed(2)} and {threshold.toFixed(2)}. Step to the next stored score.</p> : null}
      <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-sm">
        {rows.map((person) => {
          const proposed = person.score >= threshold;
          const base = person.score >= BASELINE;
          return (
            <li key={person.id} className="grid grid-cols-[1fr_auto_auto] gap-3 border-t border-line py-1">
              <span>{person.name}</span>
              <span className="num">{person.score.toFixed(3)} · planted {person.label ? "positive" : "negative"}</span>
              <span>{proposed === base ? (proposed ? "Above both lines" : "Below both lines") : proposed ? "Now above" : "Now below"}</span>
            </li>
          );
        })}
      </ul>
      <SourceNote>
        Scores and the computation time come from the snapshot anomaly rows ({modelName}). A planted positive is a customer with any transaction whose scenario is outside the benign set ({[...BENIGN].filter(Boolean).join(", ")}). The confusion matrix is recomputed in the browser with metricsAtThreshold. It is not a validated production model.
      </SourceNote>
    </Panel>
  );
}

function CorrelationPanel({
  matrix,
}: {
  matrix: { names: string[]; matrix: (number | null)[][]; n: number; method: "pearson" };
}) {
  const [cell, setCell] = useState<{ row: number; column: number } | null>(null);
  const picked = cell ? { row: matrix.names[cell.row], column: matrix.names[cell.column], value: matrix.matrix[cell.row][cell.column] } : null;
  return (
    <Panel title="Correlation" lede={`Pearson product-moment · n=${matrix.n} customers with at least one transaction · scale −1 to 1`}>
      <div className="overflow-x-auto">
        <div className="grid min-w-[28rem] gap-1" style={{ gridTemplateColumns: `88px repeat(${matrix.names.length}, minmax(0, 1fr))` }}>
          <span />
          {matrix.names.map((name) => (
            <span key={name} className="truncate text-center text-[10px] font-semibold uppercase text-muted" title={LABELS[name] ?? name}>{LABELS[name] ?? name}</span>
          ))}
          {matrix.matrix.flatMap((row, rowIndex) => [
            <span key={`label-${matrix.names[rowIndex]}`} className="self-center text-[10px] font-semibold uppercase text-muted">{LABELS[matrix.names[rowIndex]] ?? matrix.names[rowIndex]}</span>,
            ...row.map((value, columnIndex) => {
              const selected = cell?.row === rowIndex && cell?.column === columnIndex;
              return (
                <button
                  key={`${matrix.names[rowIndex]}-${matrix.names[columnIndex]}`}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setCell({ row: rowIndex, column: columnIndex })}
                  className="flex aspect-square items-center justify-center rounded-sm text-[10px] font-semibold"
                  style={{
                    background: heatColor(value),
                    color: value != null && Math.abs(value) > 0.72 ? "#fff" : "var(--color-ink)",
                    outline: selected ? "2px solid var(--color-accent)" : undefined,
                  }}
                >
                  {value == null ? "—" : value.toFixed(2)}
                </button>
              );
            }),
          ])}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>−1</span>
        <span className="inline-block h-2 w-28 rounded-sm" style={{ background: "linear-gradient(90deg, #8f2d2d, var(--color-card), #1d4e89)" }} />
        <span>+1</span>
        <span>— means undefined</span>
      </div>
      {picked ? (
        <div className="chart-tip mt-3 text-sm" role="status">
          <p className="font-semibold">{LABELS[picked.row] ?? picked.row} × {LABELS[picked.column] ?? picked.column}</p>
          <p className="mt-1">
            Pearson r {picked.value == null ? "undefined" : picked.value.toFixed(3)} on n={matrix.n}.{" "}
            {picked.value == null
              ? "At least one series is constant, shorter than two finite pairs, or the lengths differ. A constant series is not shown as zero."
              : picked.value > 0.2
                ? "Positive association in this sample."
                : picked.value < -0.2
                  ? "Negative association in this sample."
                  : "Little linear association in this sample."}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">Select a cell for the pair.</p>
      )}
      <SourceNote>
        Each column is one number per customer who has a transaction: count of rows, sum of cad_value, mean cad_value, count of distinct instruments, stored anomaly score, stored residual. Pearson uses every finite pair. A constant column, a column shorter than two points, or a non-finite value leaves the pair undefined. This is not a random matrix.
      </SourceNote>
    </Panel>
  );
}

function Series({ points, color }: { points: number[]; color: string }) {
  if (!points.length) return null;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = max - min || 1;
  const drawn = points.map((value, index) => {
    const x = (index / Math.max(1, points.length - 1)) * 640;
    const y = 150 - ((value - min) / span) * 140;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return <polyline fill="none" stroke={color} strokeWidth="1.6" points={drawn} />;
}

function heatColor(value: number | null) {
  if (value == null || Number.isNaN(value)) return "var(--color-line)";
  const amount = Math.min(1, Math.abs(value));
  if (value >= 0) return `rgba(29, 78, 137, ${0.12 + amount * 0.78})`;
  return `rgba(143, 45, 45, ${0.12 + amount * 0.78})`;
}

function Panel({ title, lede, children }: { title: string; lede: string; children: React.ReactNode }) {
  return (
    <article className="panel p-4">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <p className="mb-3 text-sm text-muted">{lede}</p>
      {children}
    </article>
  );
}

function Metric({ label, value, base }: { label: string; value: number; base: number }) {
  const delta = (value - base) * 100;
  return (
    <div className="rounded-md border border-line px-2 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="num text-xl">{(value * 100).toFixed(1)}%</p>
      <p className="num text-[11px] text-muted">{delta === 0 ? "same as baseline" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} pp vs ${BASELINE.toFixed(2)}`}</p>
    </div>
  );
}

function Delta({ now, base }: { now: number; base: number }) {
  const delta = now - base;
  if (delta === 0) return <span className="text-xs text-muted"> </span>;
  return <span className="text-xs text-muted">{delta > 0 ? `+${delta}` : delta}</span>;
}
