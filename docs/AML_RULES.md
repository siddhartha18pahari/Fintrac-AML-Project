# AML rules

Catalogue: [`app/rules/aml_rules.yaml`](../app/rules/aml_rules.yaml).
Evaluators: [`app/services/rules_engine.py`](../app/services/rules_engine.py).

> These are AML/TF **indicators**. An indicator is a red flag that can
> contribute to a suspicion. It is not proof that money laundering occurred, and
> no rule here decides on its own that a report must be filed.

---

## How a rule is defined

```yaml
- id: AML-VC-001
  version: "2.1"
  name: Rapid inbound activity from multiple distinct wallets
  category: velocity
  severity: medium
  evaluator: rapid_multi_wallet_inbound   # a registered function
  dedupe: daily                            # see "Deduplication scope"
  effective_from: "2026-06-01T00:00:00"
  effective_to: null
  inputs:                                  # what the evaluator reads
    window_minutes: 60
    min_unique_senders: 5
    min_transactions: 5
  score:
    base: 18
```

Changing a threshold means publishing a **new version with a new
`effective_from`**, not editing the old one. `RuleCatalogue.in_force(at)`
selects at most one version per rule id for a given instant, so a case assessed
in February is reproducible with February's parameters.

---

## The catalogue

| Id | Rule | Category | Sev | Pts | Fires when |
|---|---|---|---|---|---|
| **AML-VC-012** | 24-hour aggregated receipts reached the reporting threshold | threshold | reporting | 25 | an aggregation event met CAD 10,000 |
| **AML-VC-002** | Repeated receipts accumulating just below the threshold | transaction size | medium | 18 | ≥3 receipts reaching ≥85% of the threshold without crossing it |
| **AML-VC-004** | Receipt volume far above the customer's own baseline | behavioural | high | 18 | 24h total ≥5× the active-day average, ≥CAD 5,000, ≥3 active baseline days |
| **AML-VC-015** | Activity inconsistent with stated expected volume | customer inconsistency | medium | 14 | rolling 30-day receipts ≥3× the declared monthly expectation |
| **AML-VC-006** | Dormant relationship suddenly active | behavioural | medium | 12 | ≥90 days silent, then a receipt ≥CAD 5,000 |
| **AML-VC-001** | Rapid inbound from multiple distinct wallets | velocity | medium | 18 | ≥5 receipts from ≥5 distinct senders within 60 minutes |
| **AML-VC-003** | Rapid pass-through of received virtual currency | velocity | high | 20 | ≥80% of the value received in 3h is sent onward within 3h |
| **AML-VC-013** | Rapid switching between virtual currencies | obfuscation | medium | 12 | ≥3 distinct assets within 6 hours |
| **AML-VC-005** | Exposure to a high-risk counterparty wallet | counterparty | high | 22 | counterparty risk ≥70, or tagged mixer / darknet / sanctioned / ransomware / high-risk exchange |
| **AML-VC-010** | Fan-in — many distinct wallets funding one customer | network | medium | 15 | ≥6 distinct senders in 24 hours |
| **AML-VC-011** | Circular movement of funds | network | high | 20 | value leaves and returns within ≤4 hops and 72 hours |
| **AML-VC-007** | One wallet used by multiple customers | third party | high | 16 | one external address transacts with ≥2 customers in 30 days |
| **AML-VC-008** | Beneficiary shared across unrelated customers | third party | medium | 14 | ≥2 customers direct value to one beneficiary within 7 days |
| **AML-VC-014** | Receipts concentrated in newly observed addresses | obfuscation | low | 10 | ≥50% of 24h value from addresses first seen within 7 days |
| **AML-VC-009** | Counterparty exposure to a higher-risk jurisdiction | geography | medium | 12 | a party or login geography is on the configured list |
| **AML-FI-001** | Large cash receipts reached the reporting threshold | threshold | reporting | 25 | cash received for one conductor, single or 24-hour total, ≥ CAD 10,000 |
| **AML-FI-002** | International EFTs reached the reporting threshold | threshold | reporting | 25 | international EFT in one direction, single or 24-hour total, ≥ CAD 10,000 |
| **AML-FI-003** | Cash receipts structured below the large-cash line | structuring | high | 22 | ≥3 cash receipts each in [CAD 2,000, 10,000) totalling ≥ CAD 10,000 within 48 hours |
| **AML-FI-004** | Rapid movement of funds from one rail to another | velocity | high | 20 | ≥70% of value received on one rail leaves on another within 6 hours, inflow ≥ CAD 5,000 |
| **AML-FI-005** | Several customers place sub-threshold cash with one beneficiary | structuring | high | 20 | ≥3 customers, each cash receipt under CAD 10,000, combined ≥ CAD 10,000 within 24 hours |

Superseded versions retained for reproducibility: `AML-VC-001 v1.0`,
`AML-VC-004 v1.0`.

`AML-FI-001` and `AML-FI-002` are reporting observations, in the same sense as
`AML-VC-012`. They are excluded from the STR copilot's suspicion section and
they do not, by themselves, set `str_candidate`. They do open a case, because
a reporting duty is work even when nobody is suspicious. Cash and wires never
enter the LVCTR aggregation.

`AML-VC-003` (virtual-currency pass-through) measures the virtual-currency rail
only. Cash that leaves as virtual currency is `AML-FI-004`, not a second copy
of the VC rule.

---

## Deduplication scope

Detection runs per transaction. Window rules therefore re-fire on every new
receipt with a slightly larger evidence set, which without intervention fills
the queue with near-duplicates of the same finding.

Each rule declares how its firings collapse:

| Scope | Identity | Applied to |
|---|---|---|
| `evidence` | rule + version + customer + exact evidence set | discrete observations: a specific counterparty, a specific round trip, a specific dormancy gap — `003`, `005`, `006`, `007`, `008`, `009`, `011` |
| `daily` | rule + version + customer + calendar day | window rules: `001`, `002`, `004`, `010`, `012`, `013`, `014`, `015` |

On a match the surviving alert **absorbs** the new finding — taking the wider
evidence set and the higher score — rather than sitting stale beside a
duplicate.

Measured effect on the demo dataset: **373 alerts over 567 transactions before
scopes were declared, 72 after.**

---

## Tuning history

Two rules were retuned after measuring their behaviour on the synthetic
population. Both old versions are retained with `effective_to` set.

### AML-VC-001 v1.0 → v2.1

Sender count tightened from 8 to 5, transaction count from 8 to 5. The original
thresholds caught only the most extreme fan-in and missed the structured cases
the rule exists for.

### AML-VC-004 v1.0 → v2.0 — the important one

v1.0 compared a 24-hour total against `total / lookback_days`: an average over
**every calendar day**, including every quiet one.

For a customer who deposits twice a month, that comparator is near zero. Six
receipts of CAD 500 over 90 days gives an average of CAD 33/day, so a perfectly
ordinary CAD 900 deposit scores as a **27× deviation**. The rule fired on 116 of
567 transactions — roughly a third of the book — and each alert said "far above
baseline" about behaviour that was entirely normal for that subject.

That is worse than a rule that does not exist: it manufactures a high-volume
queue of findings that all look serious and none are, and it trains an
investigator to dismiss the rule's output on sight.

v2.0 compares against the average over days the customer was **actually
active**, requires at least 3 such days before the comparator is considered
meaningful, and raises the absolute floor from CAD 2,000 to CAD 5,000. It also
reports the customer's previous busiest day alongside the multiple, so a
reviewer can see whether the activity is genuinely unprecedented for this
subject rather than just above an average.

Firings dropped from 116 to 8, and the ones that remain are cases where the
customer really did do something they had never done before.

---

## Threshold proximity

`WindowResult.proximity` is `aggregate / threshold`: CAD 9,880 of a CAD 10,000
threshold is 0.988.

It is surfaced by `AML-VC-002` and on the candidate view, and it is described in
both places as one input within a holistic review. **Proximity to a threshold is
not evidence of structuring.** Customers transact in round numbers, invoices
come in at the sizes they come in at, and a rule that treated 0.98 as proof
would generate findings that no investigator could substantiate.

---

## What every finding must carry

Enforced by `test_every_finding_carries_evidence_and_a_threshold`:

```json
{
  "rule_id": "AML-VC-001",
  "rule_version": "2.1",
  "score_contribution": 18,
  "observed":  { "unique_senders": 8, "transaction_count": 9, "window_minutes": 42 },
  "threshold": { "min_unique_senders": 5, "min_transactions": 5, "window_minutes": 60 },
  "evidence_ids": [104, 105, 106, 107, 108, 109, 110, 111, 112],
  "detail": "9 receipts from 8 distinct wallets within 42 minutes."
}
```

A rule that produces a score without evidence, without a threshold to compare
against, or without a human-readable `detail` fails the test suite.

---

## Composite scoring

```
score = min(100, Σ highest firing per rule + bounded anomaly contribution)
```

Two properties matter:

- **Repeated firings of one rule do not stack.** One indicator repeated is still
  one indicator; without this, a single noisy rule could reach 100 on its own.
- **Confidence is reported separately from score.** A 60 built from one rule is
  a weaker signal than a 60 built from four unrelated ones, and the investigator
  is told which they are looking at (`LOW` / `MEDIUM` / `HIGH`, from the count of
  distinct rules and distinct evidence).

---

## Adding a rule

1. Write an evaluator in `rules_engine.py` decorated with `@evaluator("name")`.
   It receives a `RuleContext` and a `Rule`, and returns `Finding` objects.
2. Add the YAML entry with `effective_from`, `inputs`, `score.base` and a
   `dedupe` scope.
3. Add a test that fires it and a test that does **not** — a rule with no
   negative test is a rule nobody has checked the specificity of.

`test_every_rule_binds_to_a_registered_evaluator` will fail if step 1 is
forgotten.
