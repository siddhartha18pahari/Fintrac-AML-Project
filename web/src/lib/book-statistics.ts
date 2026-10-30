import { data } from "@/lib/snapshot";
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
  pstdev,
  rocCurve,
  zscores,
} from "@/lib/statistics";

const BENIGN = new Set(["normal_retail", "demo_baseline", "casino_ordinary_play", "trade_within_tolerance", ""]);

export function bookStatistics() {
  const amounts = data.transactions.map((txn) => Number(txn.cad_value)).filter((value) => value > 0);
  const logs = amounts.map((value) => Math.log10(value));
  const benford = benfordTest(amounts);
  const fences = iqrFences(amounts);
  const scores = zscores(amounts);
  const daily = data.series.map((point) => point.total);
  const parts = decompose(daily, 7);
  const byCustomer = new Map<number, number[]>();
  const instruments = new Map<number, Set<string>>();
  const scenarios = new Map<number, Set<string>>();
  for (const txn of data.transactions) {
    const values = byCustomer.get(txn.customer_id) ?? [];
    values.push(Number(txn.cad_value));
    byCustomer.set(txn.customer_id, values);
    const set = instruments.get(txn.customer_id) ?? new Set<string>();
    set.add(txn.instrument);
    instruments.set(txn.customer_id, set);
    const kinds = scenarios.get(txn.customer_id) ?? new Set<string>();
    if (txn.scenario) kinds.add(txn.scenario);
    scenarios.set(txn.customer_id, kinds);
  }
  const anomaly = new Map(data.anomaly.map((row) => [row.customer_id, row.score]));
  const columns = { count: [] as number[], total: [] as number[], mean: [] as number[], max: [] as number[], instruments: [] as number[], anomaly: [] as number[], residual: [] as number[] };
  const matrix: number[][] = [];
  const labels: number[] = [];
  const modelScores: number[] = [];
  const ids = [...byCustomer.keys()];
  for (const id of ids) {
    const values = byCustomer.get(id) ?? [];
    const customer = data.customers.find((row) => row.id === id);
    const total = values.reduce((sum, value) => sum + value, 0);
    columns.count.push(values.length);
    columns.total.push(total);
    columns.mean.push(mean(values));
    columns.max.push(Math.max(...values));
    columns.instruments.push(instruments.get(id)?.size ?? 0);
    columns.anomaly.push(anomaly.get(id) ?? 0);
    columns.residual.push(customer?.risk.residual ?? 0);
    matrix.push([values.length, total, mean(values), Math.max(...values), instruments.get(id)?.size ?? 0]);
    labels.push([...(scenarios.get(id) ?? [])].some((scenario) => !BENIGN.has(scenario)) ? 1 : 0);
    modelScores.push(anomaly.get(id) ?? 0);
  }
  const isolation = matrix.length ? isolationScores(matrix, 24, 20260811) : [];
  const ranked = isolation
    .map((score, index) => ({ customer: data.customers.find((row) => row.id === ids[index])?.name, score }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
  const curve = rocCurve(modelScores, labels);
  return {
    disclaimer:
      "Precision, recall and the ROC use planted scenario labels in this synthetic book. They are not a measure of money-laundering detection. A reporting threshold is not suspicion.",
    transactions: amounts.length,
    customers: byCustomer.size,
    cad_total: Math.round(amounts.reduce((sum, value) => sum + value, 0) * 100) / 100,
    benford,
    iqr: { q1: fences.q1, q3: fences.q3, iqr: fences.iqr, low: fences.low, high: fences.high, outlier_count: fences.outlierCount },
    zscore_abs_over_3: scores.filter((score) => Math.abs(score) >= 3).length,
    histogram: histogram(logs, 14),
    kde: gaussianKde(logs, 28),
    decomposition: {
      period: parts.period,
      dates: data.series.map((point) => point.date),
      observed: daily,
      trend: parts.trend,
      seasonal: parts.seasonal,
      residual: parts.residual,
    },
    correlation: correlationMatrix(columns),
    anomaly_summary: { method: "isolation-forest-style", highest: ranked, mean_score: mean(isolation), spread: pstdev(isolation) },
    roc: { auc: curve.auc, positives: curve.positives, negatives: curve.negatives },
    threshold: metricsAtThreshold(modelScores, labels, 0.6),
    planted_recall: data.performance.recall,
  };
}
