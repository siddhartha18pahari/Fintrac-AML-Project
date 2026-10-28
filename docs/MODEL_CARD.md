# Model card — behavioural anomaly detection

| | |
|---|---|
| **Model** | `isolation_forest_customer_behaviour` |
| **Version** | 1.0 |
| **Type** | Unsupervised outlier detection (Isolation Forest, 200 estimators) |
| **Implementation** | [`app/services/anomaly.py`](../app/services/anomaly.py) |
| **Random state** | 20260811 (fixed — scores are reproducible) |

---

## Intended use

To rank customers by how unusual their recent behaviour is **relative to the
rest of the population in this deployment**, as one bounded input to a risk
score that a human then reviews.

## Not intended use

- **Determining that money laundering occurred.** It cannot. It has never been
  shown a confirmed case.
- **Firing an alert on its own.** It does not. Only rules raise alerts; the
  model contributes points to a score.
- **Automated action of any kind.** No case is opened, closed, escalated or
  filed on the basis of this score.
- **Cross-deployment comparison.** A score of 0.95 means "more unusual than 95%
  of *this* population", not an absolute measure.

---

## Why unsupervised

Credible "money laundering" labels are scarce and biased. The labels that exist
in a compliance book mostly record *what a previous system already caught*. A
supervised classifier trained on them learns to reproduce the old system's blind
spots while reporting high accuracy, because the cases the old system missed are
labelled negative.

So this layer answers a narrower and honest question — *how unusual is this
customer relative to the population?* — and leaves the question of suspicion to
the rules, the graph, and the investigator.

---

## Features (12)

| Feature | Meaning |
|---|---|
| `txn_count_24h`, `txn_count_7d` | activity volume |
| `value_24h_cad`, `value_7d_cad` | received value |
| `unique_senders_24h` | inbound counterparty breadth |
| `unique_receivers_24h` | outbound counterparty breadth |
| `avg_txn_cad` | typical receipt size in the window |
| `value_vs_baseline` | 24h value against the customer's prior 89-day daily average |
| `distinct_assets_7d` | asset switching |
| `outflow_ratio_24h` | how much of what came in went out |
| `new_wallet_value_share_24h` | share of value from addresses first seen within 7 days |
| `max_counterparty_risk` | highest external risk score among senders |

All features are log-scaled (`sign(x)·log1p(|x|)`) before fitting. Without it the
forest spends its splits separating two whales from everyone else and stops
noticing behaviour.

**No feature encodes a protected characteristic**, a name, a country of origin
or an occupation. Country risk is handled by an explicit, board-approvable rule
(`AML-VC-009`) where it can be reviewed, not buried in a model.

---

## Training and scoring

The forest is refit over the whole customer population on each run. That is
deliberate: the population *is* the reference distribution, and a frozen model
would drift silently as the book changes. Every score records the model version
it came from.

Raw scores are converted to a **percentile rank within the fitted population**,
so the number means "more unusual than N% of this population" — something an
investigator can reason about — rather than an uncalibrated forest score.

### Abstention

Below 12 customers the model returns 0.0 and records its version as
`1.0-abstained`. An outlier score computed from four data points is noise
wearing a decimal point.

---

## Explainability

Attributions are **single-feature ablations**: each feature in turn is replaced
with the population median and the model is re-scored. The drop in anomaly score
is that feature's contribution.

This is exact for the question *"what would happen if this feature were
typical?"* and it is model-agnostic and cheap.

**It is not SHAP.** It does not decompose feature interactions, and where two
features are correlated it can under-attribute both. This is stated in the UI
next to the attributions, not only here.

The reason for not using SHAP is availability, not principle: adding the `shap`
package and using `TreeExplainer` on the forest would be a strict improvement
and is the obvious next step.

---

## Contribution to the risk score

Bounded at `settings.anomaly_max_points` (default **12 of 100**). Even a
maximally anomalous customer cannot reach a HIGH tier on the model alone; that
requires corroborating rule findings.

The driver text shown to investigators reads:

> Unsupervised deviation from the population's normal activity profile; most
> influential features: …. This is an anomaly signal, not a determination of
> money laundering.

---

## Evaluation

**No precision, recall or PR-AUC of money laundering is reported, and that is a deliberate refusal.**

This deployment has no adjudicated outcome labels. The synthetic dataset carries
`scenario_type` tags. The workspace quality page reports recall of those planted
indicator ids, and it says so. That number measures whether the rule engine
rediscovered patterns the generator inserted. It is not a model claim about
laundering, and alerts outside the labels are shown as unlabelled, not as
false positives.

What is reported instead, on the dashboard:

- alerts per 1,000 transactions
- cases per 1,000 transactions
- high-risk share of cases

These are the numbers that determine whether an investigation team can absorb
the output, which is the operational constraint that actually binds.

If this were deployed against a real book, the evaluation to build would be:

- precision at the investigator-capacity limit (top-K, where K is daily review
  capacity)
- recall against confirmed STR filings, reported with the caveat that confirmed
  filings are themselves a biased sample
- alert-volume reduction against the incumbent system at matched recall
- a champion/challenger period before the score influences any queue ordering

---

## Known limitations

1. **Population-relative.** A book where most customers behave unusually has no
   outliers. The model cannot detect a systemic problem.
2. **Cold start.** A new customer has near-empty features and scores low.
   `AML-VC-014` and `AML-VC-015` cover part of that gap; the model does not.
3. **Refit drift.** Because it refits per run, a score is not comparable across
   runs. Scores are stamped with `computed_at` and should be read as a snapshot.
4. **No temporal structure.** Features are window aggregates. A sequence model
   (LSTM/Transformer) would capture ordering, at a real cost in explainability —
   which is why it was not used.
5. **Ablation attributions under-attribute correlated features.**
6. **Adversarial robustness is untested.** A customer who knew the feature set
   could keep every one of them near the median. The rule layer is the defence
   against that, and it is why the rule layer is not optional.

---

## Human oversight

- The model never acts. It contributes ≤12 points to a score.
- Every score is visible with its features and attributions (`/api/anomaly-scores`,
  and the Rule book page).
- A senior analyst or compliance officer can override any case score, with a
  mandatory substantive reason. The engine's own score is preserved alongside
  the override, so disagreement between humans and the engine is measurable.
- Overrides are audited: `CASE_RISK_OVERRIDDEN` records before, after, actor and
  reason.

---

## Retraining and change control

`model_version` is stamped on every score row. Changing features, the
contamination parameter, or the scaling means incrementing it — the version is
what makes an old score interpretable.

There is no scheduled retraining because there is no persisted model: each run
refits. For production, the change would be a scheduled job that fits, persists,
and versions a model artefact, with the score-serving path reading it rather
than refitting inline.
