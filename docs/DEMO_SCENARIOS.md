# Demo scenarios

Every scenario below is planted deliberately by
[`scripts/generate_synthetic.py`](../scripts/generate_synthetic.py) with a known
expected outcome. All data is synthetic — see [PRIVACY.md](PRIVACY.md).

---

## The flagship walkthrough — Maple Digital Imports Ltd.

**Setup.** An entity customer importing consumer electronics, declaring
CAD 20,000 of monthly virtual-currency activity at onboarding. Six weeks of
modest baseline receipts (CAD 1,200–2,400, three per week, from three addresses
it uses repeatedly) establish what normal looks like for this subject.

**The day.**

| Time | Event | CAD |
|---|---|---|
| 09:05 | receipt, BTC, new address | 3,200 |
| 09:44 | receipt, BTC, new address | 2,400 |
| 10:19 | receipt, ETH, new address | 3,100 |
| 11:07 | receipt, ETH, new address | 2,500 |
| 13:32 | receipt, USDT, new address | 4,600 |
| 14:05 | *(an unrelated customer pays the same beneficiary)* | 3,400 |
| 15:14 | receipt, USDT, new address | 5,800 |
| 15:46 | **outgoing** to a wallet tagged `high_risk_exchange` (risk 88) | 10,100 |

All six receipts name the same beneficiary.

**What the system does, in order.**

1. **Valuation.** Each receipt is priced against a snapshotted rate with its
   methodology version. The CAD figures above are reproducible from those
   snapshots years later.
2. **Aggregation.** Two groupings cross the threshold: conductor
   (CAD 21,600 over six receipts) and beneficiary (CAD 24,999.99 over seven,
   including the unrelated customer's). Both are recorded; the earliest is
   reported, and the other is preserved in the report's `provenance` block.
   Filing due five working days later.
3. **Rules.** Seven indicators fire:

   | Rule | Finding |
   |---|---|
   | AML-VC-012 +25 | threshold reached by 24-hour aggregation on a shared beneficiary |
   | AML-VC-005 +22 | onward transfer to a wallet with risk score 88, tagged `high_risk_exchange` |
   | AML-VC-003 +20 | value sent onward within 3 hours of receipt |
   | AML-VC-002 +18 | an earlier window sat at 87% of the threshold |
   | AML-VC-010 +15 | six distinct sending wallets in 24 hours |
   | AML-VC-008 +14 | beneficiary shared with an unrelated customer |
   | AML-VC-013 +12 | three virtual currencies within six hours |
   | AML-VC-014 +10 | all value from addresses first seen within seven days |

4. **ML.** The Isolation Forest ranks the customer in the top percentile of the
   population and contributes +11 (bounded at 12), with its most influential
   features named.
5. **Risk.** Raw contributions total well over 100, capped at **100 — CRITICAL**,
   confidence **HIGH** (many distinct rules over many distinct transactions).
6. **Case.** Opened automatically, LVCTR required, STR review flagged, due date
   set from the day of receipt.
7. **Graph.** The console plots the six senders, the customer, the beneficiary
   and the high-risk destination — the shared beneficiary and the risky
   counterparty are visible without reading a table.
8. **Copilot.** Generates a cited narrative that passes the unsupported-claim
   verifier and flags what is still missing (the investigator's own rationale).
9. **Report.** The LVCTR builds and validates clean at all four local levels;
   readiness 100%.
10. **Controls.** Try to close the case unfiled — refused. Try to approve it as
    its own owner — refused. Submit it, then try again — refused.
11. **Audit.** Every step above appears in the chained trail, and
    `/api/audit/verify` confirms nothing has been altered.

**Try breaking it.** On the case page, use *Override score* to drop it to 20
with a reason. The engine's 100 stays visible beside your 20, and
`CASE_RISK_OVERRIDDEN` records both, who did it, and why. That is the point of
the control.

---

## The other planted scenarios

| Scenario | Planted | LVCTR expected | Indicators expected |
|---|---|:-:|---|
| `normal_retail` | irregular CAD 120–3,100 receipts from a customer's three habitual addresses | no | none — this is the background the rules must not fire on |
| `single_threshold` | one receipt of CAD 14,250.33 | **yes** | AML-VC-012 |
| `aggregation_24h` | six receipts totalling CAD 21,600 from six wallets in one day | **yes** | AML-VC-012, AML-VC-010 |
| `aggregation_beneficiary` | three customers each send CAD 4,200 to one beneficiary within 24h | **yes** | AML-VC-012, AML-VC-008 |
| `aggregation_third_party` | three receipts on behalf of one third party, CAD 11,200 | **yes** | AML-VC-012 |
| `near_threshold` | three receipts totalling CAD 9,850 — **98.5%** of the threshold | **no** | AML-VC-002 |
| `fan_in` | nine receipts from nine wallets in 45 minutes | no | AML-VC-001, AML-VC-010 |
| `rapid_pass_through` | CAD 11,800 in, 96% of it out 22 minutes later | **yes** | AML-VC-003, AML-VC-012 |
| `circular_flow` | value leaves, passes two addresses, returns within 7 hours | no | AML-VC-011 |
| `high_risk_counterparty` | receipt from an address tagged mixer / darknet / sanctioned | no | AML-VC-005 |
| `dormant_spike` | silent 150+ days, then CAD 9,200 | no | AML-VC-006 |
| `chain_hopping` | four different assets in 2.5 hours | no | AML-VC-013 |
| `shared_wallet` | one external address funds three unrelated customers | no | AML-VC-007 |
| `new_address_concentration` | all window value from addresses first seen a day earlier | no | AML-VC-014 |
| `high_risk_jurisdiction` | beneficiary resident in a listed jurisdiction | no | AML-VC-009 |

`near_threshold` is the one worth dwelling on: **CAD 9,850 is not a reporting
obligation.** The system says so, surfaces the proximity for holistic review,
and explicitly states that proximity is not evidence of structuring. A system
that reported it anyway would be over-reporting, which is its own kind of
failure.

---

## Cash, wires, and movement between rails

These customers are created in addition to the retail book. None of them is an
LVCTR: cash and electronic transfers are not virtual-currency receipts.

| Scenario | What is planted | What should fire |
|---|---|---|
| `lctr_single` | Helene Bouchard, one cash receipt of CAD 12,500 | `AML-FI-001`. No aggregation event. |
| `cash_structuring` | Harbour Cash Services Ltd., four cash receipts of CAD 9,200 / 8,800 / 9,500 / 8,700 in one day | `AML-FI-001` (the 24-hour total) and `AML-FI-003` (each piece stayed under the line). |
| `eftr_international` | Owen Lindqvist, CAD 18,500 outgoing wire to a German bank | `AML-FI-002`. A domestic wire of the same size does not fire. |
| `rapid_cross_rail` | Cedar Remit Co., CAD 18,000 cash in, then USDT out within two hours | `AML-FI-001` and `AML-FI-004`. The virtual-currency pass-through rule does not treat the cash as VC. |
| `smurf_ring` | Three customers, CAD 4,500 cash each, one beneficiary, one shared device | `AML-FI-005` on the third conductor. No single customer reaches the large-cash line. Link analysis clusters them. |

The workspace snapshot (`python -m scripts.export_snapshot`) includes these
scenarios. Harbour Cash Services and Maple Digital Imports are the two cases
the overview page points at.

---

## Things to try in the console

**Validation lab** (`#/validation`). The pre-loaded payload is deliberately
broken. Hit *Validate* and read the findings: a dangling `$ref` to a subject
that was never declared (L4), a CAD equivalent that does not reconcile with
amount × rate (L4), a missing `onBehalfOfs` block where the indicator is set
(L2), missing required schema fields (L3). Fix them one at a time and watch
readiness climb.

**Rule book** (`#/rules`). Two rules show a superseded version alongside the
current one. `AML-VC-004 v1.0` is retained precisely because it was wrong — it
compared against an all-days average and alerted on a third of the book. The
version history is the audit trail for a threshold change.

**Alerts** (`#/alerts`). Click any alert for its observed-versus-threshold
table. Every alert can answer "why did you fire, and what would have had to be
different?"

**Audit trail** (`#/audit`, as `a.petrov`). Re-verify the chain. Then, from a
Python shell, edit an `AuditEvent.reason` in the database and re-verify — it
will name the exact event where the chain breaks.

---

## Regenerating

```bash
python -m scripts.seed --customers 40 --days 45 --seed 20260811
```

Same seed, same dataset — including prices, since the valuation oracle is a pure
function of asset and hour. The scenario expectations are printed at the end of
the run and returned by `seed_everything()` for use in tests.
