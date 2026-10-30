"""Descriptive statistics for a synthetic monitoring book.

These routines describe amounts, scores and planted labels. They do not decide
that money laundering occurred, and a threshold report is not a suspicion.
"""

from __future__ import annotations

import math
import random
from collections import defaultdict

_EULER = 0.5772156649


def quantile(sorted_values: list[float], probability: float) -> float:
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    index = (len(sorted_values) - 1) * probability
    low = math.floor(index)
    high = math.ceil(index)
    if low == high:
        return float(sorted_values[low])
    weight = index - low
    return float(sorted_values[low]) * (1 - weight) + float(sorted_values[high]) * weight


def mean(values: list[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def pstdev(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    center = mean(values)
    return math.sqrt(sum((value - center) ** 2 for value in values) / len(values))


def zscores(values: list[float]) -> list[float]:
    if not values:
        return []
    center = mean(values)
    spread = pstdev(values) or 1.0
    return [(value - center) / spread for value in values]


def iqr_fences(values: list[float]) -> dict:
    ordered = sorted(values)
    q1 = quantile(ordered, 0.25)
    q3 = quantile(ordered, 0.75)
    span = q3 - q1
    low = q1 - 1.5 * span
    high = q3 + 1.5 * span
    flags = [value < low or value > high for value in values]
    return {
        "q1": q1,
        "q3": q3,
        "iqr": span,
        "low": low,
        "high": high,
        "outlier_count": sum(1 for flag in flags if flag),
        "flags": flags,
    }


def _average_path(size: int) -> float:
    if size <= 1:
        return 0.0
    if size == 2:
        return 1.0
    return 2.0 * (math.log(size - 1) + _EULER) - 2.0 * (size - 1) / size


def isolation_scores(
    rows: list[list[float]],
    *,
    trees: int = 48,
    seed: int = 20260811,
    subsample: int = 64,
) -> list[float]:
    """Isolation-forest-style scores in ``(0, 1]``.

    Each tree splits a random feature between the subsample min and max until
    a point is alone or the depth cap is hit. Shorter paths score higher.
    This is a compact teaching implementation, not ``sklearn.ensemble.IsolationForest``.
    """
    if not rows:
        return []
    width = len(rows[0])
    if width == 0 or any(len(row) != width for row in rows):
        raise ValueError("isolation_scores expects a rectangular matrix")
    count = len(rows)
    rng = random.Random(seed)
    limit = max(1, math.ceil(math.log2(max(2, min(count, subsample)))))
    depth_sum = [0.0] * count

    def build(indexes: list[int], depth: int):
        if depth >= limit or len(indexes) <= 1:
            return ("leaf", len(indexes))
        feature = rng.randrange(width)
        column = [rows[index][feature] for index in indexes]
        low = min(column)
        high = max(column)
        if high == low:
            return ("leaf", len(indexes))
        split = rng.uniform(low, high)
        left = [index for index in indexes if rows[index][feature] < split]
        right = [index for index in indexes if rows[index][feature] >= split]
        if not left or not right:
            return ("leaf", len(indexes))
        return ("node", feature, split, build(left, depth + 1), build(right, depth + 1))

    def drop(node, point: list[float], depth: int) -> float:
        if node[0] == "leaf":
            size = node[1]
            return depth + (_average_path(size) if size > 1 else 0.0)
        _, feature, split, left, right = node
        if point[feature] < split:
            return drop(left, point, depth + 1)
        return drop(right, point, depth + 1)

    for _ in range(max(1, trees)):
        if count <= subsample:
            sample = list(range(count))
        else:
            sample = rng.sample(range(count), subsample)
        tree = build(sample, 0)
        for index, row in enumerate(rows):
            depth_sum[index] += drop(tree, row, 0)

    normaliser = _average_path(count) or 1.0
    return [2.0 ** (-(depth_sum[index] / trees) / normaliser) for index in range(count)]


def first_digit(value: float) -> int | None:
    magnitude = abs(value)
    if magnitude <= 0 or not math.isfinite(magnitude):
        return None
    while magnitude >= 10:
        magnitude /= 10
    while magnitude < 1:
        magnitude *= 10
    digit = int(magnitude)
    if digit < 1 or digit > 9:
        return None
    return digit


def benford_test(amounts: list[float]) -> dict:
    counts = [0] * 9
    used = 0
    for amount in amounts:
        digit = first_digit(amount)
        if digit is None:
            continue
        counts[digit - 1] += 1
        used += 1
    expected_p = [math.log10(1 + 1 / digit) for digit in range(1, 10)]
    observed_p = [(count / used) if used else 0.0 for count in counts]
    chi_square = 0.0
    if used:
        for count, probability in zip(counts, expected_p):
            expected = probability * used
            chi_square += (count - expected) ** 2 / expected
    mad = sum(abs(observed - expected) for observed, expected in zip(observed_p, expected_p)) / 9
    if mad < 0.006:
        conformity = "close"
    elif mad < 0.012:
        conformity = "acceptable"
    elif mad < 0.015:
        conformity = "marginal"
    else:
        conformity = "nonconforming"
    return {
        "n": used,
        "counts": counts,
        "observed": observed_p,
        "expected": expected_p,
        "chi_square": chi_square,
        "df": 8,
        "mad": mad,
        "conformity": conformity,
        "note": "Benford conformity is a screen for digit patterns, not evidence of laundering.",
    }


def histogram(values: list[float], bins: int = 16) -> dict:
    if not values:
        return {"lo": 0, "hi": 0, "width": 0, "counts": [], "edges": []}
    low = min(values)
    high = max(values)
    if low == high:
        high = low + 1
    width = (high - low) / bins
    counts = [0] * bins
    for value in values:
        slot = min(bins - 1, max(0, int((value - low) / width)))
        counts[slot] += 1
    edges = [low + index * width for index in range(bins + 1)]
    return {"lo": low, "hi": high, "width": width, "counts": counts, "edges": edges}


def gaussian_kde(values: list[float], points: int = 40) -> dict:
    if len(values) < 2:
        return {"bandwidth": 0, "grid": [], "density": []}
    spread = pstdev(values) or 1.0
    bandwidth = 1.06 * spread * (len(values) ** -0.2)
    bandwidth = max(bandwidth, 1e-6)
    low = min(values)
    high = max(values)
    pad = (high - low) * 0.08 or 1.0
    span = (high - low) + 2 * pad
    grid = [low - pad + index * span / (points - 1) for index in range(points)]
    coefficient = 1 / (len(values) * bandwidth * math.sqrt(2 * math.pi))
    density = []
    for point in grid:
        total = 0.0
        for value in values:
            zed = (point - value) / bandwidth
            total += math.exp(-0.5 * zed * zed)
        density.append(coefficient * total)
    return {"bandwidth": bandwidth, "grid": grid, "density": density}


def pearson(left: list[float], right: list[float]) -> float:
    if len(left) != len(right) or len(left) < 2:
        return 0.0
    mean_left = mean(left)
    mean_right = mean(right)
    numerator = sum((a - mean_left) * (b - mean_right) for a, b in zip(left, right))
    left_scale = math.sqrt(sum((a - mean_left) ** 2 for a in left))
    right_scale = math.sqrt(sum((b - mean_right) ** 2 for b in right))
    if left_scale == 0 or right_scale == 0:
        return 0.0
    return numerator / (left_scale * right_scale)


def correlation_matrix(columns: dict[str, list[float]]) -> dict:
    names = list(columns)
    matrix = []
    for row_name in names:
        matrix.append([pearson(columns[row_name], columns[column_name]) for column_name in names])
    return {"names": names, "matrix": matrix}


def decompose(series: list[float], period: int = 7) -> dict:
    """Additive moving-average trend, seasonal means, and residual."""
    count = len(series)
    if count == 0 or period < 2:
        return {"period": period, "trend": [], "seasonal": [], "residual": []}
    half = period // 2
    trend: list[float] = []
    for index in range(count):
        start = max(0, index - half)
        stop = min(count, index + half + 1)
        trend.append(sum(series[start:stop]) / (stop - start))
    buckets: list[list[float]] = [[] for _ in range(period)]
    for index, value in enumerate(series):
        buckets[index % period].append(value - trend[index])
    seasonal_means = [(sum(bucket) / len(bucket) if bucket else 0.0) for bucket in buckets]
    shift = sum(seasonal_means) / period
    seasonal_means = [value - shift for value in seasonal_means]
    seasonal = [seasonal_means[index % period] for index in range(count)]
    residual = [series[index] - trend[index] - seasonal[index] for index in range(count)]
    return {"period": period, "trend": trend, "seasonal": seasonal, "residual": residual}


def roc_curve(scores: list[float], labels: list[int]) -> dict:
    """Scores are ranked high-to-low. Labels are 1 for a planted positive."""
    if len(scores) != len(labels) or not scores:
        return {"auc": 0.0, "points": [], "positives": 0, "negatives": 0}
    pairs = sorted(zip(scores, labels), key=lambda item: item[0], reverse=True)
    positives = sum(1 for label in labels if label)
    negatives = len(labels) - positives
    true_positives = 0
    false_positives = 0
    points = [{"threshold": None, "tpr": 0.0, "fpr": 0.0, "precision": 0.0, "recall": 0.0}]
    for score, label in pairs:
        if label:
            true_positives += 1
        else:
            false_positives += 1
        recall = true_positives / positives if positives else 0.0
        false_rate = false_positives / negatives if negatives else 0.0
        precision = true_positives / (true_positives + false_positives) if (true_positives + false_positives) else 0.0
        points.append(
            {
                "threshold": score,
                "tpr": recall,
                "fpr": false_rate,
                "precision": precision,
                "recall": recall,
            }
        )
    auc = 0.0
    for index in range(1, len(points)):
        width = points[index]["fpr"] - points[index - 1]["fpr"]
        auc += width * (points[index]["tpr"] + points[index - 1]["tpr"]) / 2
    return {"auc": auc, "points": points, "positives": positives, "negatives": negatives}


def metrics_at_threshold(scores: list[float], labels: list[int], threshold: float) -> dict:
    true_positives = false_positives = true_negatives = false_negatives = 0
    for score, label in zip(scores, labels):
        predicted = score >= threshold
        if predicted and label:
            true_positives += 1
        elif predicted and not label:
            false_positives += 1
        elif not predicted and label:
            false_negatives += 1
        else:
            true_negatives += 1
    precision = true_positives / (true_positives + false_positives) if (true_positives + false_positives) else 0.0
    recall = true_positives / (true_positives + false_negatives) if (true_positives + false_negatives) else 0.0
    false_rate = false_positives / (false_positives + true_negatives) if (false_positives + true_negatives) else 0.0
    return {
        "threshold": threshold,
        "precision": precision,
        "recall": recall,
        "false_positive_rate": false_rate,
        "tp": true_positives,
        "fp": false_positives,
        "tn": true_negatives,
        "fn": false_negatives,
    }


def velocity(transactions: list[dict], *, window_hours: int = 24) -> list[dict]:
    """Max count and CAD inside a rolling window, per customer."""
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in transactions:
        grouped[str(row.get("customer") or row.get("customer_id") or "unknown")].append(row)
    findings = []
    for customer, rows in grouped.items():
        ordered = sorted(rows, key=lambda item: str(item.get("at") or ""))
        best_count = 0
        best_cad = 0.0
        for index, start in enumerate(ordered):
            start_at = str(start.get("at") or "")
            count = 0
            total = 0.0
            for row in ordered[index:]:
                if _hours_between(start_at, str(row.get("at") or "")) > window_hours:
                    break
                count += 1
                total += float(row.get("cad") or 0)
            best_count = max(best_count, count)
            best_cad = max(best_cad, total)
        findings.append(
            {
                "customer": customer,
                "txns": len(ordered),
                "max_count": best_count,
                "max_cad": round(best_cad, 2),
                "elevated": best_count >= 5 or best_cad >= 10000,
            }
        )
    findings.sort(key=lambda item: item["max_cad"], reverse=True)
    return findings


def _hours_between(start: str, stop: str) -> float:
    from datetime import datetime

    if not start or not stop:
        return 0.0
    left = datetime.fromisoformat(start.replace("Z", "+00:00"))
    right = datetime.fromisoformat(stop.replace("Z", "+00:00"))
    if left.tzinfo is not None and right.tzinfo is None:
        right = right.replace(tzinfo=left.tzinfo)
    if right.tzinfo is not None and left.tzinfo is None:
        left = left.replace(tzinfo=right.tzinfo)
    return abs((right - left).total_seconds()) / 3600


def peer_groups(members: list[dict]) -> list[dict]:
    """Compare each member's value with the median of its peer group."""
    groups: dict[str, list[dict]] = defaultdict(list)
    for member in members:
        groups[str(member.get("group") or "ungrouped")].append(member)
    rows = []
    for name, people in sorted(groups.items()):
        values = sorted(float(person.get("value") or 0) for person in people)
        midpoint = quantile(values, 0.5)
        for person in people:
            value = float(person.get("value") or 0)
            ratio = (value / midpoint) if midpoint else 0.0
            rows.append(
                {
                    "group": name,
                    "name": person.get("name"),
                    "value": value,
                    "peer_median": midpoint,
                    "ratio": ratio,
                    "peers": len(people),
                    "above_peer": ratio >= 2 and midpoint > 0,
                }
            )
    rows.sort(key=lambda item: item["ratio"], reverse=True)
    return rows
