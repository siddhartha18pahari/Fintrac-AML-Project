"use client";

import { useMemo, useState } from "react";
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

export function StatisticsBoard({
  transactions,
  customers,
  series,
  plantedRecall,
}: {
  transactions: StatTxn[];
  customers: StatCustomer[];
  series: { date: string; total: number }[];
  plantedRecall: number | null;
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
      labels.push(suspicious ? 1 : 0);
      scores.push(customer.anomaly);
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

  const scoreMin = model.scores.length ? Math.min(...model.scores) : 0;
  const scoreMax = model.scores.length ? Math.max(...model.scores) : 1;
  const [threshold, setThreshold] = useState(() => scoreMin + (scoreMax - scoreMin) * 0.55);
  const tuned = metricsAtThreshold(model.scores, model.labels, threshold);
  const maxBar = Math.max(1, ...model.histogram.counts, ...model.benford.counts);
  const heat = model.correlation;

  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-sm leading-relaxed text-muted">
        Precision, recall and the ROC use planted scenario labels in this synthetic book. They are not a measure of money-laundering detection. A reporting threshold is not suspicion.
        {plantedRecall != null ? ` Planted-indicator recall on the quality page is ${(plantedRecall * 100).toFixed(0)}%.` : ""}
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Benford first digits" lede={`MAD ${model.benford.mad.toFixed(4)} · ${model.benford.conformity} · n=${model.benford.n}`}>
          <div className="flex h-40 items-end gap-2">
            {model.benford.counts.map((count, index) => (
              <div key={index} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-32 w-full items-end gap-0.5">
                  <div className="w-1/2 rounded-t bg-brass" style={{ height: `${(count / maxBar) * 100}%` }} />
                  <div className="w-1/2 rounded-t bg-spruce/40" style={{ height: `${(model.benford.expected[index] * model.benford.n / maxBar) * 100}%` }} />
                </div>
                <span className="num text-[10px] text-muted">{index + 1}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Brass is observed. Spruce is the Benford expectation. Conformity is a digit screen, not a finding.</p>
        </Panel>
        <Panel title="Amount distribution" lede={`${model.fences.outlierCount} IQR outliers · ${model.zOver} |z| ≥ 3`}>
          <svg viewBox="0 0 320 140" className="h-40 w-full" role="img" aria-label="Histogram of log amounts with a density curve">
            {model.histogram.counts.map((count, index) => {
              const width = 320 / model.histogram.counts.length;
              const height = (count / maxBar) * 110;
              return <rect key={index} x={index * width + 1} y={120 - height} width={width - 2} height={height} fill="#9a7433" opacity="0.8" />;
            })}
            <polyline
              fill="none"
              stroke="#12352c"
              strokeWidth="2"
              points={model.kde.density.map((density, index) => {
                const maxDensity = Math.max(...model.kde.density, 1e-9);
                const x = (index / Math.max(1, model.kde.density.length - 1)) * 320;
                const y = 120 - (density / maxDensity) * 110;
                return `${x},${y}`;
              }).join(" ")}
            />
          </svg>
          <p className="text-xs text-muted">Log10 CAD. The line is a Gaussian kernel density. Fences are {model.fences.low.toFixed(0)} to {model.fences.high.toFixed(0)} CAD.</p>
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Panel title="Threshold tuner" lede={`AUC ${model.roc.auc.toFixed(2)} on planted labels · positives ${model.roc.positives}`}>
          <label className="block text-sm">
            <span className="mb-1 flex justify-between text-xs font-semibold uppercase tracking-wider text-muted">
              <span>Anomaly score</span>
              <span className="num">{threshold.toFixed(3)}</span>
            </span>
            <input type="range" min={scoreMin} max={scoreMax || 1} step={0.001} value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} className="w-full" />
          </label>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <Metric label="Precision" value={tuned.precision} />
            <Metric label="Recall" value={tuned.recall} />
            <Metric label="False positive rate" value={tuned.falsePositiveRate} />
          </dl>
          <svg viewBox="0 0 220 160" className="mt-3 h-40 w-full" role="img" aria-label="ROC curve">
            <line x1="20" y1="10" x2="20" y2="140" stroke="currentColor" opacity="0.3" />
            <line x1="20" y1="140" x2="200" y2="140" stroke="currentColor" opacity="0.3" />
            <line x1="20" y1="140" x2="200" y2="10" stroke="currentColor" opacity="0.2" />
            <polyline
              fill="none"
              stroke="#9a7433"
              strokeWidth="2"
              points={model.roc.points.map((point) => `${20 + point.fpr * 180},${140 - point.tpr * 130}`).join(" ")}
            />
          </svg>
        </Panel>
        <Panel title="Correlation" lede="Customer features, Pearson">
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${heat.names.length}, minmax(0, 1fr))` }}>
            {heat.matrix.flatMap((row, rowIndex) =>
              row.map((value, columnIndex) => (
                <div
                  key={`${heat.names[rowIndex]}-${heat.names[columnIndex]}`}
                  title={`${heat.names[rowIndex]} × ${heat.names[columnIndex]} ${value.toFixed(2)}`}
                  className="flex aspect-square items-center justify-center rounded-md text-[10px] font-semibold"
                  style={{ background: heatColor(value), color: Math.abs(value) > 0.55 ? "#071410" : "#14211c" }}
                >
                  {value.toFixed(1)}
                </div>
              )),
            )}
          </div>
          <p className="mt-2 text-xs text-muted">{heat.names.join(" · ")}</p>
        </Panel>
      </div>
      <Panel title="Daily book, trend and weekday season" lede="Additive decomposition, period 7">
        <svg viewBox="0 0 640 160" className="h-40 w-full" role="img" aria-label="Observed series, trend, and residual">
          <Series points={model.observed} color="#9a7433" />
          <Series points={model.parts.trend} color="#12352c" />
        </svg>
        <p className="text-xs text-muted">Brass is the daily total. Spruce is the moving-average trend. Residual mean {mean(model.parts.residual).toFixed(1)}.</p>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Isolation-style scores" lede="Short paths score higher. Not the production forest.">
          <ul className="space-y-2 text-sm">
            {model.ranked.map((row) => (
              <li key={row.name} className="flex justify-between gap-3">
                <span>{row.name}</span>
                <span className="num">{row.score.toFixed(3)}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="24-hour velocity" lede="Highest CAD inside any one-day window">
          <ul className="space-y-2 text-sm">
            {model.velocity.map((row) => (
              <li key={row.name} className="flex justify-between gap-3">
                <span>{row.name}</span>
                <span className="num">{Math.round(row.best).toLocaleString()}</span>
              </li>
            ))}
          </ul>
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
        </Panel>
      </div>
    </div>
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
    return `${x},${y}`;
  }).join(" ");
  return <polyline fill="none" stroke={color} strokeWidth="2" points={drawn} />;
}

function heatColor(value: number) {
  const amount = Math.min(1, Math.abs(value));
  if (value >= 0) return `rgba(61, 190, 160, ${0.15 + amount * 0.75})`;
  return `rgba(224, 107, 118, ${0.15 + amount * 0.75})`;
}

function Panel({ title, lede, children }: { title: string; lede: string; children: React.ReactNode }) {
  return (
    <article className="panel glass p-4">
      <h2 className="font-display text-2xl text-spruce">{title}</h2>
      <p className="mb-3 text-sm text-muted">{lede}</p>
      {children}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line px-2 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className="num text-xl">{(value * 100).toFixed(0)}%</p>
    </div>
  );
}
