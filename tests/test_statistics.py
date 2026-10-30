"""Descriptive statistics used by the studio page and the studio API."""

from __future__ import annotations

import math

from app.services.statistics import (
    benford_test,
    correlation_matrix,
    decompose,
    iqr_fences,
    isolation_scores,
    metrics_at_threshold,
    peer_groups,
    roc_curve,
    velocity,
    zscores,
)


def test_benford_prefers_a_logarithmic_span():
    natural = [10 ** (index / 25) for index in range(1, 250)]
    flat = [digit * 111 for digit in range(1, 10) for _ in range(30)]
    natural_mad = benford_test(natural)["mad"]
    flat_mad = benford_test(flat)["mad"]
    assert natural_mad < flat_mad
    assert benford_test(flat)["conformity"] == "nonconforming"
    assert benford_test(natural)["n"] == 249


def test_iqr_and_zscore_flag_an_outlier():
    values = [10.0] * 20 + [500.0]
    fences = iqr_fences(values)
    assert fences["flags"][-1] is True
    assert fences["outlier_count"] == 1
    scores = zscores(values)
    assert abs(scores[-1]) == max(abs(score) for score in scores)
    assert abs(scores[-1]) > 3


def test_isolation_score_is_highest_for_the_outlier():
    rows = [[0.0, 0.2], [0.1, -0.1], [-0.2, 0.0], [0.05, 0.05], [-0.05, 0.1], [0.2, -0.2], [-0.1, -0.05]]
    rows.extend([[0.0, 0.0] for _ in range(12)])
    rows.append([14.0, -11.0])
    scores = isolation_scores(rows, trees=40, seed=3)
    assert scores[-1] == max(scores)
    assert scores[-1] > sum(scores[:-1]) / (len(scores) - 1)


def test_correlation_of_a_straight_line_is_one():
    matrix = correlation_matrix(
        {
            "a": [1, 2, 3, 4, 5],
            "b": [2, 4, 6, 8, 10],
            "c": [5, 4, 3, 2, 1],
        }
    )
    assert abs(matrix["matrix"][0][1] - 1) < 1e-9
    assert matrix["matrix"][0][2] < -0.99


def test_decomposition_separates_a_weekly_season():
    series = [10 + (index % 7) for index in range(28)]
    parts = decompose(series, period=7)
    assert len(parts["trend"]) == 28
    assert abs(sum(parts["residual"]) / len(parts["residual"])) < 0.5
    assert max(parts["seasonal"]) > min(parts["seasonal"])


def test_roc_ranks_a_separated_score():
    scores = [0.1, 0.2, 0.15, 0.9, 0.8, 0.95]
    labels = [0, 0, 0, 1, 1, 1]
    curve = roc_curve(scores, labels)
    assert curve["auc"] == 1
    tuned = metrics_at_threshold(scores, labels, 0.5)
    assert tuned["precision"] == 1
    assert tuned["recall"] == 1
    assert tuned["false_positive_rate"] == 0


def test_velocity_and_peers():
    rows = [
        {"customer": "A", "at": "2026-03-02T10:00:00", "cad": 4000},
        {"customer": "A", "at": "2026-03-02T12:00:00", "cad": 7000},
        {"customer": "B", "at": "2026-03-02T10:00:00", "cad": 100},
    ]
    found = velocity(rows)
    assert found[0]["customer"] == "A"
    assert found[0]["max_cad"] == 11000
    assert found[0]["elevated"] is True
    peers = peer_groups(
        [
            {"name": "A", "group": "shop", "value": 100},
            {"name": "B", "group": "shop", "value": 100},
            {"name": "C", "group": "shop", "value": 400},
        ]
    )
    standout = next(row for row in peers if row["name"] == "C")
    assert standout["above_peer"] is True
    assert math.isclose(standout["ratio"], 4.0)
