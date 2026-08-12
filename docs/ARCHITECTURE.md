# Architecture

## The pipeline

```
canonical transaction
        │
        ▼
┌─────────────────┐   snapshots the rate used, with its source and
│  valuation      │   methodology version, so a threshold decision is
└────────┬────────┘   reproducible years later
         ▼
┌─────────────────┐   sliding 24-hour window per grouping relationship
│  aggregation    │   (conductor / beneficiary / third party), with
└────────┬────────┘   absorbing deduplication
         ▼
┌─────────────────┐   YAML-configured, versioned indicators; each firing
│  rules engine   │   returns observed-vs-threshold-vs-evidence
└────────┬────────┘
         ▼
┌─────────────────┐   additive, capped, ranked drivers; anomaly score
│  risk scoring   │   contributes a bounded number of points
└────────┬────────┘
         ▼
┌─────────────────┐   one open case per subject; lifecycle, RBAC,
│  case service   │   four-eyes approval, enforced controls
└────────┬────────┘
         ▼  ── human decision, with a documented rationale ──
         ▼
┌─────────────────┐   canonical report body, then a mapper to the
│ report builder  │   external schema
└────────┬────────┘
         ▼
┌─────────────────┐   L1 format · L2 business rules · L3 JSON Schema
│  validation     │   L4 cross-field · L5 the receiver's own verdict
└────────┬────────┘
         ▼
┌─────────────────┐   an independent second opinion; deterministic
│  mock receiver  │   accept/reject with itemised findings
└────────┬────────┘
         ▼
     audit trail (append-only, hash-chained, verifiable)
```

Every stage is a module in `app/services/`, independently importable and
independently tested. `pipeline.py` wires them together and owns the
transactional boundaries; nothing else does.

---

## Key decisions

### The database is not bound to FINTRAC's schema

Cases, transactions and subjects are stored in the system's own canonical shape.
`fintrac_mapper.py` is the only module that knows what the regulator's payload
looks like. When the external schema changes, one mapper changes.

Reports persist **both** the canonical body and the rendered payload, so a
filing from three schema versions ago can still be explained without
resurrecting the mapper that produced it.

### Rules are configuration, versioned by effective date

`app/rules/aml_rules.yaml` binds a stable rule id and version to an `evaluator`
function plus its thresholds. `RuleCatalogue.in_force(at)` picks at most one
version per rule id for a given instant, so re-running an old transaction
reproduces the assessment it originally received rather than applying today's
thresholds retroactively. The catalogue is also copied into `rule_versions` so
reproducibility does not depend on a YAML file staying put.

### Deduplication is absorbing, not suppressing

Two places would otherwise multiply the same finding:

- **Aggregation events.** A grouping keeps one open event whose
  `covered_txn_ids` is the authoritative set it reports on. A later receipt
  inside the live window extends that event. Three receipts crossing the
  threshold produce one candidate, not three.

  The open-event lookup is scoped by `group_key` **alone**, deliberately not by
  customer. For a beneficiary or third-party grouping the conductors differ by
  design — that is the entire point of the rule — so scoping by customer fails
  to find the open event and raises a second, overlapping candidate for the
  same beneficiary. `group_key` already encodes the customer for conductor
  groupings (`customer:N`), so nothing is lost.
- **Alerts.** Each rule declares a `dedupe` scope: `evidence` (exact evidence
  set) for discrete observations, or `daily` for window rules whose evidence set
  grows with every new receipt. On a match the existing alert absorbs the wider
  evidence and the higher score.

Without the second of these, the alert queue filled with near-duplicates: 373
alerts over 567 transactions, dropping to 72 once the scope was declared.

### The graph is rebuilt, not maintained

`graph_engine` builds a NetworkX multigraph on demand over a bounded time
window. At this scale (tens of thousands of edges) that is well under a second,
and it removes a whole class of staleness bugs. Node and edge shapes are
Neo4j-compatible (`kind`, `relation`, typed properties) so the migration is a
loader, not a rewrite.

For a production book, the migration path is: replace `build_graph` with a Neo4j
driver, keep `GraphView`'s interface, and move `find_cycles` / `shared_wallets`
into Cypher. The rule evaluators call those functions and nothing else.

### The frontend has no build step and no external requests

Vanilla ES modules, hand-rolled SVG force-directed layout, no CDN fonts, no icon
packs. A compliance console that blanks out on a locked-down network is not
usable. `ui.el()` builds nodes without `innerHTML`, so a customer name or a
validation message can never be interpreted as markup.

### Nothing is hard-deleted

Alerts are dismissed, not removed. Cases are closed, not deleted. Reports keep
every submission attempt. The audit trail is append-only and chained; editing a
historical row breaks the chain and `verify_chain` reports where.

---

## Boundaries and their reasons

| Boundary | Enforced how |
|---|---|
| Threshold arithmetic never happens in SQL | `util.cad()` quantises to cents in Python; SQL is used only for retrieval and display sums |
| Submission never leaves the deployment | `settings.submission_endpoint` is checked in `mock_fintrac.submit` and raises for anything but `mock` |
| Configuration cannot drift at runtime | `Settings` is a frozen dataclass; changing a parameter means a restart, which is a deployment event with a record |
| A model score is not a filing decision | `open_case_for` sets `str_candidate`, never a disposition; only `record_decision` sets one, and only for permitted roles |
| A reporting obligation cannot be waived | `transition` and `record_decision` both refuse `NO_FILING` on a case with `lvctr_required` |

---

## Scaling notes

The current shape is honest about its limits.

**What holds.** Ingestion, valuation, aggregation and the rule engine are all
per-transaction with bounded queries. Postgres is a `DATABASE_URL` change.

**What does not.** Three things are O(n) per transaction and would need work at
volume:

1. `find_cycles` and `shared_wallets` scan the window's transactions for every
   evaluation. At a real book size these belong in a graph database with an
   index on address, or in a precomputed adjacency table refreshed on a
   schedule.
2. `anomaly.run` refits the Isolation Forest over the whole population per run.
   That is deliberate — the population *is* the reference distribution — but it
   should move to a scheduled job writing scores, not an inline pipeline stage.
3. The pipeline is synchronous. The natural next step is
   `FastAPI → Celery → Redis → Postgres`, with the same service modules called
   from tasks. Nothing in `services/` assumes a request context.

Streaming (Kafka → Flink) would change the aggregation implementation but not
its semantics: `window_for` already takes an explicit end instant rather than
reading a clock, which is what makes it replayable.
