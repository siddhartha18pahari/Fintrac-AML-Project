/** Descriptive statistics for the synthetic book. A threshold is not suspicion. */

export function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function pstdev(values: number[]) {
  if (values.length < 2) return 0;
  const center = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / values.length);
}

export function quantile(sorted: number[], probability: number) {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * probability;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  const weight = index - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

export function zscores(values: number[]) {
  if (!values.length) return [];
  const center = mean(values);
  const spread = pstdev(values) || 1;
  return values.map((value) => (value - center) / spread);
}

export function iqrFences(values: number[]) {
  const ordered = [...values].sort((left, right) => left - right);
  const q1 = quantile(ordered, 0.25);
  const q3 = quantile(ordered, 0.75);
  const span = q3 - q1;
  const low = q1 - 1.5 * span;
  const high = q3 + 1.5 * span;
  const flags = values.map((value) => value < low || value > high);
  return { q1, q3, iqr: span, low, high, outlierCount: flags.filter(Boolean).length, flags };
}

function averagePath(size: number) {
  if (size <= 1) return 0;
  if (size === 2) return 1;
  return 2 * (Math.log(size - 1) + 0.5772156649) - (2 * (size - 1)) / size;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Tree = { kind: "leaf"; size: number } | { kind: "node"; feature: number; split: number; left: Tree; right: Tree };

export function isolationScores(rows: number[][], trees = 32, seed = 20260811) {
  if (!rows.length) return [];
  const width = rows[0].length;
  const count = rows.length;
  const rand = mulberry32(seed);
  const limit = Math.max(1, Math.ceil(Math.log2(Math.max(2, Math.min(count, 64)))));
  const depthSum = Array(count).fill(0);

  function build(indexes: number[], depth: number): Tree {
    if (depth >= limit || indexes.length <= 1) return { kind: "leaf", size: indexes.length };
    const feature = Math.floor(rand() * width);
    let low = Infinity;
    let high = -Infinity;
    for (const index of indexes) {
      low = Math.min(low, rows[index][feature]);
      high = Math.max(high, rows[index][feature]);
    }
    if (high === low) return { kind: "leaf", size: indexes.length };
    const split = low + rand() * (high - low);
    const left: number[] = [];
    const right: number[] = [];
    for (const index of indexes) {
      if (rows[index][feature] < split) left.push(index);
      else right.push(index);
    }
    if (!left.length || !right.length) return { kind: "leaf", size: indexes.length };
    return { kind: "node", feature, split, left: build(left, depth + 1), right: build(right, depth + 1) };
  }

  function drop(node: Tree, point: number[], depth: number): number {
    if (node.kind === "leaf") return depth + (node.size > 1 ? averagePath(node.size) : 0);
    return drop(point[node.feature] < node.split ? node.left : node.right, point, depth + 1);
  }

  const subsample = Math.min(64, count);
  for (let tree = 0; tree < trees; tree += 1) {
    const sample = rows.map((_, index) => index);
    if (count > subsample) {
      for (let index = sample.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(rand() * (index + 1));
        [sample[index], sample[swap]] = [sample[swap], sample[index]];
      }
      sample.length = subsample;
    }
    const built = build(sample, 0);
    rows.forEach((row, index) => {
      depthSum[index] += drop(built, row, 0);
    });
  }
  const normaliser = averagePath(count) || 1;
  return depthSum.map((depth) => 2 ** (-depth / trees / normaliser));
}

export function firstDigit(value: number) {
  let magnitude = Math.abs(value);
  if (!(magnitude > 0) || !Number.isFinite(magnitude)) return null;
  while (magnitude >= 10) magnitude /= 10;
  while (magnitude < 1) magnitude *= 10;
  const digit = Math.floor(magnitude);
  return digit >= 1 && digit <= 9 ? digit : null;
}

export function benfordTest(amounts: number[]) {
  const counts = Array(9).fill(0);
  let used = 0;
  for (const amount of amounts) {
    const digit = firstDigit(amount);
    if (!digit) continue;
    counts[digit - 1] += 1;
    used += 1;
  }
  const expected = Array.from({ length: 9 }, (_, index) => Math.log10(1 + 1 / (index + 1)));
  const observed = counts.map((count) => (used ? count / used : 0));
  let chiSquare = 0;
  if (used) {
    expected.forEach((probability, index) => {
      const exp = probability * used;
      chiSquare += (counts[index] - exp) ** 2 / exp;
    });
  }
  const mad = observed.reduce((sum, value, index) => sum + Math.abs(value - expected[index]), 0) / 9;
  const conformity = mad < 0.006 ? "close" : mad < 0.012 ? "acceptable" : mad < 0.015 ? "marginal" : "nonconforming";
  return { n: used, counts, observed, expected, chiSquare, df: 8, mad, conformity };
}

export function histogram(values: number[], bins = 16) {
  if (!values.length) return { lo: 0, hi: 0, width: 0, counts: [] as number[] };
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) hi = lo + 1;
  const width = (hi - lo) / bins;
  const counts = Array(bins).fill(0);
  for (const value of values) {
    const slot = Math.min(bins - 1, Math.max(0, Math.floor((value - lo) / width)));
    counts[slot] += 1;
  }
  return { lo, hi, width, counts };
}

export function gaussianKde(values: number[], points = 40) {
  if (values.length < 2) return { bandwidth: 0, grid: [] as number[], density: [] as number[] };
  const spread = pstdev(values) || 1;
  const bandwidth = Math.max(1e-6, 1.06 * spread * values.length ** -0.2);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.08 || 1;
  const span = hi - lo + 2 * pad;
  const grid = Array.from({ length: points }, (_, index) => lo - pad + (index * span) / (points - 1));
  const coefficient = 1 / (values.length * bandwidth * Math.sqrt(2 * Math.PI));
  const density = grid.map((point) => {
    let total = 0;
    for (const value of values) {
      const zed = (point - value) / bandwidth;
      total += Math.exp(-0.5 * zed * zed);
    }
    return coefficient * total;
  });
  return { bandwidth, grid, density };
}

export function pearson(left: number[], right: number[]) {
  if (left.length !== right.length || left.length < 2) return 0;
  const meanLeft = mean(left);
  const meanRight = mean(right);
  let numerator = 0;
  let leftScale = 0;
  let rightScale = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] - meanLeft;
    const b = right[index] - meanRight;
    numerator += a * b;
    leftScale += a * a;
    rightScale += b * b;
  }
  if (leftScale === 0 || rightScale === 0) return 0;
  return numerator / Math.sqrt(leftScale * rightScale);
}

export function correlationMatrix(columns: Record<string, number[]>) {
  const names = Object.keys(columns);
  const matrix = names.map((row) => names.map((column) => pearson(columns[row], columns[column])));
  return { names, matrix };
}

export function decompose(series: number[], period = 7) {
  const count = series.length;
  if (!count || period < 2) return { period, trend: [] as number[], seasonal: [] as number[], residual: [] as number[] };
  const half = Math.floor(period / 2);
  const trend = series.map((_, index) => {
    const start = Math.max(0, index - half);
    const stop = Math.min(count, index + half + 1);
    return mean(series.slice(start, stop));
  });
  const buckets: number[][] = Array.from({ length: period }, () => []);
  series.forEach((value, index) => buckets[index % period].push(value - trend[index]));
  let seasonalMeans = buckets.map((bucket) => (bucket.length ? mean(bucket) : 0));
  const shift = mean(seasonalMeans);
  seasonalMeans = seasonalMeans.map((value) => value - shift);
  const seasonal = series.map((_, index) => seasonalMeans[index % period]);
  const residual = series.map((value, index) => value - trend[index] - seasonal[index]);
  return { period, trend, seasonal, residual };
}

export type RocPoint = { threshold: number | null; tpr: number; fpr: number; precision: number; recall: number };

export function rocCurve(scores: number[], labels: number[]) {
  if (scores.length !== labels.length || !scores.length) {
    return { auc: 0, points: [] as RocPoint[], positives: 0, negatives: 0 };
  }
  const pairs = scores.map((score, index) => ({ score, label: labels[index] })).sort((left, right) => right.score - left.score);
  const positives = labels.reduce((sum, label) => sum + (label ? 1 : 0), 0);
  const negatives = labels.length - positives;
  let truePositives = 0;
  let falsePositives = 0;
  const points: RocPoint[] = [{ threshold: null, tpr: 0, fpr: 0, precision: 0, recall: 0 }];
  for (const pair of pairs) {
    if (pair.label) truePositives += 1;
    else falsePositives += 1;
    const recall = positives ? truePositives / positives : 0;
    const fpr = negatives ? falsePositives / negatives : 0;
    const precision = truePositives + falsePositives ? truePositives / (truePositives + falsePositives) : 0;
    points.push({ threshold: pair.score, tpr: recall, fpr, precision, recall });
  }
  let auc = 0;
  for (let index = 1; index < points.length; index += 1) {
    const width = points[index].fpr - points[index - 1].fpr;
    auc += (width * (points[index].tpr + points[index - 1].tpr)) / 2;
  }
  return { auc, points, positives, negatives };
}

export function metricsAtThreshold(scores: number[], labels: number[], threshold: number) {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  scores.forEach((score, index) => {
    const predicted = score >= threshold;
    const label = labels[index];
    if (predicted && label) tp += 1;
    else if (predicted && !label) fp += 1;
    else if (!predicted && label) fn += 1;
    else tn += 1;
  });
  return {
    threshold,
    precision: tp + fp ? tp / (tp + fp) : 0,
    recall: tp + fn ? tp / (tp + fn) : 0,
    falsePositiveRate: fp + tn ? fp / (fp + tn) : 0,
    tp,
    fp,
    tn,
    fn,
  };
}
