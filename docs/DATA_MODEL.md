# Data model

Source of truth: [`app/models.py`](../app/models.py).

---

## Conventions

### Time is naive UTC, everywhere

SQLite cannot round-trip timezone information, and a 24-hour rule implemented
with a mixture of aware and naive datetimes is a compliance bug, not a style
issue. The whole system stores naive UTC and converts at the edges:
`util.utcnow()`, `util.parse_dt()`, `util.iso()`.

The FINTRAC payload uses `util.iso_local_naive()` — no zone designator, matching
the format the reference implementation's `arr_ZDT` fields expect.

### Money

| Column type | Storage | Used for |
|---|---|---|
| `CAD` = `Numeric(20, 2)` | real numeric | `cad_value`, totals, thresholds |
| `ASSET` / `RATE` = `DecimalText` | exact decimal string | `asset_amount`, `exchange_rate`, `price_cad` |

`DecimalText` exists because SQLite has no `DECIMAL`: SQLAlchemy's `Numeric`
round-trips through a float, so 0.83944829 BTC comes back as
`0.839448289999999986`. That is invisible on a dashboard and unacceptable in a
regulatory payload, where the amount *is* the thing being reported. Those
columns are never compared, ordered or summed in SQL — only `cad_value` is, and
at two decimal places float affinity is exact.

**Every threshold comparison happens in Python** on `util.cad()`-quantised
Decimals, never in SQL. Storage affinity cannot flip a reporting decision.

`util.token_amount()` strips column-scale padding and exponent notation before
an amount reaches a narrative or a payload.

---

## Tables

### Subjects

| Table | Purpose | Notable columns |
|---|---|---|
| `customers` | the reporting entity's own clients | `external_id` (feed key), `expected_monthly_volume_cad`, `kyc` (JSON — names, DOB, address, identifications, feeding the LVCTR builder) |
| `wallets` | addresses seen on either side | unique on `(address, blockchain)` — **an address string can exist on more than one chain**; `is_internal`, `external_risk_score`, `risk_tags` |
| `parties` | beneficiaries and third parties | `kind`; kept separate from customers because a beneficiary is frequently *not* a client, yet the 24-hour rule requires grouping on them |
| `users` | operators | `role`, PBKDF2 `password_hash` |

### Ledger

| Table | Purpose |
|---|---|
| `price_quotes` | immutable rate snapshot: asset, `price_cad`, `source`, `quoted_at`, `methodology_version` |
| `transactions` | the canonical ledger; `external_id` unique so replaying a feed cannot double every aggregate; `price_quote_id` points at the rate actually used; `instrument` is `VIRTUAL_CURRENCY` (the default), `CASH` or `EFT`; `synthetic_scenario` is populated only by the generator |

`transactions.context` carries ingestion metadata the report builder needs
(device type, IP, username, purpose, disposition code) without adding a column
per feed quirk.

### Detection

| Table | Purpose |
|---|---|
| `aggregation_events` | one 24-hour grouping that reached the threshold. `group_type` + `group_key` say *why* the receipts are grouped; `covered_txn_ids` is the authoritative set it reports on and is what makes deduplication possible. `customer_id` is the conductor whose receipt *opened* the event — on a beneficiary or third-party grouping the covered receipts may come from several conductors, so it is provenance, never a filter |
| `rule_versions` | persisted copy of the YAML catalogue, so a historical case stays reproducible if the file moves |
| `alerts` | one firing. `explanation` holds the full observed/threshold/evidence object; `dedupe_key` is derived from the rule's declared scope |
| `customer_baselines` | trailing profile. Holds both `avg_daily_cad` and `avg_active_day_cad` — see [AML_RULES.md](AML_RULES.md) for why the distinction matters |
| `anomaly_scores` | per-run model output with features and ablation attributions |

### Investigation

| Table | Purpose |
|---|---|
| `cases` | one open case per subject. Keeps `risk_score` **and** `overridden_score` side by side so model governance can measure disagreement |
| `case_notes` | attributable, append-only |
| `case_evidence` | unique on `(case_id, evidence_type, evidence_id)` |
| `reports` | both `canonical` and rendered `payload`, plus the `validation` result |
| `submissions` | every attempt, with the receiver's full response |
| `audit_events` | append-only, `prev_hash`/`hash` chained |

---

## Invariants

These are enforced in code and covered by tests:

1. **A transaction is unique on `external_id`.** Replaying a feed is a no-op.
2. **A CAD figure is reproducible.** `valuation.reproduce(quote_id, amount)`
   returns the stored `cad_value` for any transaction.
3. **A supplied CAD value never silently overrides the recomputed one.** A
   discrepancy is recorded in `context.cad_value_discrepancy` and the
   recomputed figure wins, because the difference can change a threshold
   outcome.
4. **One grouping has at most one open aggregation event** — including when
   the receipts under it were conducted by different customers.
5. **At most one version of a rule is in force at any instant.**
6. **A case with `lvctr_required` cannot reach `CLOSED_NO_FILING`,** and cannot
   be dispositioned `NO_FILING` or `STR`-only.
7. **The case owner cannot approve their own filing decision.**
8. **A submitted report cannot be rebuilt or resubmitted.**
9. **`risk_score` survives an override.** The override sits alongside it.
10. **The audit chain verifies.** Editing a historical row is detectable and
    `verify_chain` reports the first divergence.

---

## Enumerations that map to FINTRAC codes

| Internal | FINTRAC `twentyFourHourAggregationTypeCode` |
|---|---|
| `AggregationType.BENEFICIARY` | `1` |
| `AggregationType.CONDUCTOR` | `2` |
| `AggregationType.ON_BEHALF_OF` | `3` |
| `AggregationType.NOT_APPLICABLE` | `4` |

`Disposition` is internal only and models the LVCTR/STR distinction explicitly:

```
lvctr_required : bool     threshold-driven, arithmetic
str_candidate  : bool     "a human must consider whether suspicion exists"
disposition    : enum     NO_FILING | LVCTR | STR | LVCTR_AND_STR
```

The same activity can require both. Keeping them as separate fields rather than
one status is what stops a threshold obligation from being quietly satisfied by
a judgement about suspicion, or vice versa.

---

## Migrations

The project uses `Base.metadata.create_all` and ships no migration history,
because it is a portfolio deployment that regenerates its dataset. Adopting it
against a persistent book means adding Alembic before the first schema change —
`create_all` will not alter an existing table, and the failure is silent.
