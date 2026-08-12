# Deploying to Vercel

FINTRAC Sentinel runs on Vercel as a single Python serverless function serving
both the API and the investigator console. The deployment is production-shaped
but the data remains 100% synthetic and reports still go only to the built-in
mock receiver.

---

## Read this first: what serverless changes

Three platform constraints shape the deployment. None of them are blockers, but
ignoring any of them produces a demo that looks like it works and quietly does
not.

### 1. The filesystem is disposable

Only `/tmp` is writable, and it is wiped between cold starts. The default
SQLite database therefore **cannot** be used for anything you want to keep — a
system whose whole point is a durable, hash-chained audit trail cannot store
that trail in a file that evaporates.

**You need PostgreSQL.** The app already supports it; set `DATABASE_URL`.

The app refuses to start on a serverless host with non-durable storage rather
than pretending otherwise. If you genuinely want a throwaway demo where every
cold start resets the world, opt in explicitly with
`ALLOW_EPHEMERAL_STORAGE=1`.

### 2. Requests have a deadline

Vercel functions are capped at 10s (Hobby, default), 60s (configured in
`vercel.json`), or 300s (Pro). A full detection re-run over the demo dataset
takes minutes.

So **seeding and full pipeline runs happen from your machine**, pointed at the
deployed database — not from inside a request. `POST /api/pipeline/run` refuses
a full re-run above 250 transactions on a serverless host, because a run killed
part-way rolls back and looks like a silent failure. `POST /api/admin/seed`
returns `501` with the same explanation.

Incremental detection is unaffected: ingesting a transaction via
`POST /api/transactions` scores it inline in well under a second, which is the
realistic serverless workload.

### 3. There is a size budget

Functions are limited to 250MB unzipped. scikit-learn pulls in scipy and costs
roughly 150MB of that.

If you hit the ceiling, delete `scikit-learn` from `requirements.txt`. The
anomaly layer degrades cleanly: it reports model version `1.0-unavailable`,
contributes zero risk points, and every rule-based control keeps working.
`GET /api/health` reports `capabilities.anomaly_detection` so you can always
see which mode is live. This is a tested path, not a hope — see
`tests/test_deployment_modes.py`.

---

## Deploy

### 1. Provision a database

Any Postgres works. Vercel Postgres, Neon and Supabase all have free tiers.

Use a **pooled** connection string if the provider offers one (Neon's
`-pooler` host, Supabase's port 6543). Serverless scales out to many short-lived
instances, and a direct connection per instance exhausts the connection limit
quickly. The app already sets `poolclass=NullPool` on serverless so it holds no
pool of its own and defers to the provider's pooler.

Convert the URL to SQLAlchemy's psycopg-3 form:

```
postgresql+psycopg://USER:PASSWORD@HOST/DBNAME?sslmode=require
```

Note `postgresql+psycopg://`, not `postgres://`.

### 2. Set environment variables

In the Vercel project, under Settings → Environment Variables:

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL` | your pooled Postgres URL | required — otherwise storage is disposable |
| `SECRET_KEY` | a long random string | required — session tokens are signed with it |
| `AUTO_MIGRATE` | `0` *(after step 3)* | stops every cold start issuing DDL |
| `DEMO_PASSWORD` | something non-obvious | the seeded demo accounts share it |

Generate a key:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

`SECRET_KEY` is not optional. The app refuses to start on a serverless host
while it is still the development default, because anyone who has read this
source could otherwise mint a valid administrator token.

### 3. Provision the schema and seed the demo data

From your machine, pointed at the deployed database. Leave `AUTO_MIGRATE`
unset (or `1`) for this step, then set it to `0` afterwards.

```bash
pip install -r requirements-dev.txt
DATABASE_URL="postgresql+psycopg://..." DEMO_PASSWORD="..." python -m scripts.seed --customers 40 --days 45
```

This creates the tables, loads the rule catalogue, generates the synthetic
ledger and runs full detection over it. Expect two to four minutes — which is
exactly why it does not run inside a request.

To provision the schema without demo data:

```bash
DATABASE_URL="..." python -m scripts.provision
```

### 4. Deploy

```bash
npm i -g vercel
vercel --prod
```

Or connect the Git repository in the Vercel dashboard and push.

### 5. Verify

```bash
curl https://YOUR-APP.vercel.app/api/health
```

Check the response says what you expect:

```json
{
  "status": "ok",
  "storage": { "backend": "postgresql", "durable": true, "serverless": true },
  "capabilities": { "anomaly_detection": true }
}
```

`durable: false` means you are on disposable storage and the audit trail will
not survive. `anomaly_detection: false` means the slim build is live and the ML
layer is abstaining.

---

## What ships in the function

`.vercelignore` keeps the bundle to what serving a request needs. Excluded:

- `tests/`, `docs/`, `pytest.ini` — not needed at runtime
- `data/`, `*.db` — local state must never be uploaded
- `scripts/` — the generator and seeder are developer tools that run against
  the database directly, not through the app
- `run.py` — the local launcher

Static assets are served by the function rather than duplicated into `public/`,
so there is one source of truth in `app/static/`. `vercel.json` sets a one-day
edge cache on `/static/*`, so the CDN absorbs those requests after the first.

---

## Security notes for a public deployment

This is a demo carrying synthetic data, but it is a *public URL*, so:

- **Change `DEMO_PASSWORD`.** The default (`sentinel1234`) is documented in
  this repository. Anyone who finds the deployment can otherwise sign in as a
  compliance officer.
- **Keep `SYNTHETIC_DATA_ONLY=1`.** It gates the destructive seed endpoint and
  keeps the "synthetic data" banner up.
- **Never point `SUBMISSION_ENDPOINT` anywhere but `mock`.** The submission
  service refuses any other value; do not remove that guard.
- Do not load real customer data into this deployment. See `docs/PRIVACY.md`.

---

## Is Vercel the right host for this?

For a portfolio demo and the API, yes — it is free, fast and zero-maintenance.

For anything operational, no. This system wants a long-lived process: the
detection pipeline is a batch job, the graph engine rebuilds over a time
window, and the ML layer refits against the whole population. Those are jobs
for a container with a scheduler (Cloud Run, Fly.io, Render, ECS) and a real
Postgres, with the pipeline on a cron rather than an HTTP request. The code
does not need to change for that — only where you run it.
