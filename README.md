# FINTRAC Sentinel

**Explainable AML monitoring and regulatory reporting for virtual-currency transactions.**

`Detect → Investigate → Explain → Report`

- 24-hour FINTRAC aggregation with deduplicated candidates
- configurable, versioned AML rule engine (15 indicators, 17 rule versions)
- explainable risk scoring with ranked drivers — never a bare number
- transaction-graph analytics: fan-in, fan-out, circular flow, shared wallets
- investigator case management with four-eyes approval and enforced controls
- evidence-grounded STR drafting with an unsupported-claim verifier
- LVCTR generation with five-level validation and JSON export
- hash-chained, append-only audit trail

> **All data in this project is synthetic.** Reports are submitted to a local
> mock receiver. This system is not connected to FINTRAC and must not be used to
> file anything. See [PRIVACY.md](docs/PRIVACY.md).

---

## Why it exists

[`8KSS/FINTRAC-LVCTR`](https://github.com/8KSS/FINTRAC-LVCTR) is a single HTML
page that builds a JSON-LD Large Virtual Currency Transaction Report. It is a
genuinely useful artefact — it is where the field names, nesting and code lists
in this project were reconciled from — but it starts at the *end* of the
compliance process:

```
Human already knows the transaction is reportable  →  fill in the form
```

The hard problems are all upstream of that:

```
Thousands of transactions
        ↓  which ones matter?
        ↓  which ones aggregate, and on what relationship?
        ↓  who controls the related wallets?
        ↓  what indicators are present, and how strong?
        ↓  does a compliance officer need to investigate?
        ↓  what did the human decide, and why?
        ↓  which report(s), and does the payload actually validate?
```

Sentinel implements that pipeline and keeps the report builder at the end of it,
where it belongs. [docs/LEGACY_REPO_ANALYSIS.md](docs/LEGACY_REPO_ANALYSIS.md)
documents exactly what was carried over and what was deliberately left behind.

---

## Quick start

No database server, no Node toolchain, no network access required.

```bash
pip install -r requirements.txt
```

```bash
python run.py
```

That seeds a synthetic ledger on first run, then serves the console at
<http://127.0.0.1:8099/> with API docs at `/docs`.

Sign in as `l.chen` / `sentinel1234` (compliance officer). Other demo accounts
exercise different halves of the RBAC matrix:

| Account | Role | Can |
|---|---|---|
| `j.okafor` | Analyst | triage alerts, add notes, escalate |
| `s.rahman` | Senior analyst | + record filing decisions, override scores |
| `l.chen` | Compliance officer | + run the pipeline, build reports |
| `d.vasquez` | Approver | + approve a case and submit reports |
| `a.petrov` | Auditor | read-only, including the audit trail |

Password for all of them: `sentinel1234`. It is set by `DEMO_PASSWORD` — change
it for any deployment with a public URL, since this file documents the default.

To regenerate the dataset:

```bash
python -m scripts.seed --customers 40 --days 45
```

Run the tests:

```bash
pip install -r requirements-dev.txt
```

```bash
python -m pytest
```

---

## Deploying

The app runs on Vercel as a single Python serverless function serving both the
API and the console — see **[docs/DEPLOY_VERCEL.md](docs/DEPLOY_VERCEL.md)**.

Three things are worth knowing before you start, because each one produces a
demo that looks like it works and quietly does not:

- **Serverless filesystems are disposable.** SQLite will not survive a cold
  start, so a hosted deployment needs PostgreSQL (`DATABASE_URL`). The app
  refuses to start on a serverless host with non-durable storage rather than
  pretending, unless you opt in with `ALLOW_EPHEMERAL_STORAGE=1`.
- **Requests have a deadline.** Seeding and full pipeline re-runs take minutes,
  so they run from your machine against the deployed database, never inside a
  request. Incremental detection on newly ingested transactions is inline and
  unaffected.
- **Functions have a size budget.** If the 250MB limit bites, drop
  `scikit-learn` from `requirements.txt`; the anomaly layer abstains cleanly,
  labels itself `1.0-unavailable`, and every rule-based control keeps working.

`GET /api/health` reports which mode is live:

```json
{ "storage": { "durable": true }, "capabilities": { "anomaly_detection": true } }
```

Provision a database without demo data:

```bash
DATABASE_URL="postgresql+psycopg://..." python -m scripts.provision
```

For anything operational rather than demonstrative, prefer a container with a
scheduler (Cloud Run, Fly.io, Render) over serverless: the detection pipeline is
a batch job, and it belongs on a cron rather than an HTTP request. No code
changes are needed — only where you run it.

---

## The demo walkthrough

Sign in and open the case for **Maple Digital Imports Ltd.**

The company declared CAD 20,000 of monthly crypto activity at onboarding. Over
one day it receives CAD 21,600 from six distinct wallets, moves CAD 10,100
straight back out to a wallet tagged as a high-risk exchange, and shares a
beneficiary with an unrelated customer.

Every layer has something to say about it:

| Layer | Finding |
|---|---|
| 24-hour rule | receipts aggregate to CAD 24,999.99 on a shared beneficiary → LVCTR obligation, due in 5 working days |
| Rules | fan-in, near-threshold accumulation, baseline deviation, rapid pass-through, high-risk counterparty, shared beneficiary, chain hopping |
| ML | behavioural anomaly in the top percentile of the population, with feature attributions |
| Graph | the network, the high-risk counterparty and the shared beneficiary, plotted |
| Copilot | a cited STR narrative that passes the unsupported-claim verifier |
| Report | an LVCTR payload that validates clean at all four local levels |
| Controls | the case cannot be closed unfiled, the owner cannot self-approve, and the submitted report cannot be rebuilt |

Full script: [docs/DEMO_SCENARIOS.md](docs/DEMO_SCENARIOS.md).

---

## Architecture

```
   ingestion ──► CAD valuation ──► 24-hour aggregation ──► rules engine
                 (snapshotted)      (deduplicated)          (versioned)
                                                                │
      audit ◄── mock receiver ◄── validation ◄── LVCTR builder  │
        ▲                                            ▲          ▼
        └──────── case management ◄── human review ◄──── risk score
                                                      (+ graph, + anomaly)
```

- **Backend** FastAPI · SQLAlchemy 2.0 · Pydantic v2 · SQLite (Postgres-ready via `DATABASE_URL`)
- **Analytics** NetworkX · scikit-learn (Isolation Forest) · NumPy
- **Frontend** vanilla ES modules, no build step, no external requests — including a hand-rolled force-directed SVG graph
- **Validation** hand-written JSON Schema + four local rule levels + the receiver's verdict

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## What it does not do

These are deliberate, and each one is enforced or documented rather than assumed:

- **It does not file anything.** `submission_endpoint` is hard-guarded to `mock`; anything else raises.
- **It does not decide that money laundering occurred.** Rules produce *indicators*. The STR copilot's verifier rejects any sentence asserting criminality.
- **It does not claim a FINTRAC STR schema mapping.** That schema was not available to reconcile against, so the STR path produces a canonical body and a narrative, and says so.
- **It does not report precision or recall.** There are no adjudicated outcome labels in this deployment; reporting them against synthetic scenario tags would overstate what the system knows. Volume metrics are reported instead.
- **It does not treat a threshold as suspicion.** An LVCTR obligation is arithmetic. An STR is a judgement, and only a person makes it.

---

## Repository layout

```
fintrac-sentinel/
├── app/
│   ├── config.py            regulatory parameters and deployment settings
│   ├── models.py            ORM: customers, wallets, transactions, cases, reports, audit
│   ├── security.py          password hashing, tokens, the RBAC matrix
│   ├── audit.py             append-only hash-chained trail
│   ├── rules/               aml_rules.yaml — the rule catalogue
│   ├── schemas_json/        lvctr.schema.json
│   ├── services/            one module per pipeline stage (see services/__init__.py)
│   ├── routers/             the HTTP API
│   └── static/              the investigator console (no build step)
├── scripts/
│   ├── generate_synthetic.py   scenario-driven dataset generator
│   └── seed.py                 seed + full detection run
├── tests/                   111 tests, compliance regressions first
└── docs/
```

---

## Documentation

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | pipeline stages, boundaries, scaling notes |
| [DATA_MODEL.md](docs/DATA_MODEL.md) | tables, invariants, decimal and time conventions |
| [AML_RULES.md](docs/AML_RULES.md) | every rule, its parameters, and its tuning history |
| [FINTRAC_MAPPING.md](docs/FINTRAC_MAPPING.md) | canonical model → LVCTR JSON-LD, field by field |
| [LEGACY_REPO_ANALYSIS.md](docs/LEGACY_REPO_ANALYSIS.md) | what was reused from the reference repo, and what was not |
| [MODEL_CARD.md](docs/MODEL_CARD.md) | the anomaly model: intended use, limitations, governance |
| [SECURITY.md](docs/SECURITY.md) | RBAC matrix, controls, what a real deployment must add |
| [PRIVACY.md](docs/PRIVACY.md) | synthetic-data policy and PII handling |
| [DEMO_SCENARIOS.md](docs/DEMO_SCENARIOS.md) | every planted scenario and what should fire |

---

## Regulatory references

Always verify current requirements before implementing regulatory logic. The
logic here was written against:

- [Reporting large virtual currency transactions](https://fintrac-canafe.canada.ca/guidance-directives/transaction-operation/lvctr/lvctr-eng)
- [Reporting transactions: 24-hour rule](https://fintrac-canafe.canada.ca/guidance-directives/transaction-operation/24hour/1-eng)
- [Reporting suspicious transactions](https://fintrac-canafe.canada.ca/guidance-directives/transaction-operation/str-dod/str-dod-eng)
- [Virtual currency ML/TF indicators](https://fintrac-canafe.canada.ca/guidance-directives/transaction-operation/indicators-indicateurs/vc_mltf-eng)
- [API report submission](https://fintrac-canafe.canada.ca/reporting-declaration/info/api/api-eng)

The payload format follows the 2021 JSON-LD structure encoded in the reference
repository. **A reporting entity must reconcile every field against FINTRAC's
current technical documentation before filing anything.**

---

## License

The reference repository `8KSS/FINTRAC-LVCTR` is separately licensed; consult it
directly. This project is an independent implementation that used it as a field
mapping reference.
