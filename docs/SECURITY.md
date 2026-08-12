# Security

## Threat model, honestly stated

This is a **portfolio deployment holding synthetic data**. The controls below
are real and tested, but the authentication stack is deliberately simple so the
project runs with no crypto dependencies. Section 4 lists what a deployment
holding real compliance data would have to add before it went anywhere near
production.

---

## 1. Roles and permissions

Six roles, enforced at the route (`deps.require(...)`) and re-checked in the
service layer for the decisions that matter.

| Action | Analyst | Senior | Officer | Approver | Auditor | Admin |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| View cases and alerts | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Add notes | ✓ | ✓ | ✓ | ✓ | | ✓ |
| Triage / dismiss alerts | ✓ | ✓ | ✓ | | | ✓ |
| Escalate a case | ✓ | ✓ | ✓ | | | ✓ |
| Assign a case | | ✓ | ✓ | | | ✓ |
| Override a risk score | | ✓ | ✓ | | | ✓ |
| Record a filing decision | | ✓ | ✓ | | | ✓ |
| Approve for filing | | | ✓ | ✓ | | ✓ |
| Build a report | ✓ | ✓ | ✓ | | | ✓ |
| Submit a report | | | ✓ | ✓ | | ✓ |
| View the audit trail | | ✓ | ✓ | ✓ | ✓ | ✓ |
| Run the pipeline | | | ✓ | | | ✓ |
| Administration | | | | | | ✓ |

Source: `security.PERMISSIONS`. `GET /api/auth/me` returns the caller's
effective permissions, and the console hides what the caller cannot do — but the
server is the enforcement point, not the UI.

---

## 2. Enforced controls

Each of these is a test, not a comment.

| Control | Rationale |
|---|---|
| A case with an LVCTR obligation **cannot** be closed unfiled, or dispositioned `NO_FILING` / `STR`-only | The threshold test is arithmetic, not a judgement call. Closing one unfiled is a reporting breach |
| Four-eyes: the case owner **cannot** approve their own filing decision | Separation of the person who decides from the person who signs off |
| A filing decision requires a rationale of ≥20 characters | An undocumented decision is not a decision, it is a state change |
| A risk override requires a reason of ≥10 characters, and preserves the engine score | Model governance depends on measuring how often, and which way, humans disagree |
| An alert dismissal requires a reason; the alert is not deleted | Dismissals are evidence |
| A report cannot be submitted unless the case is approved *and* has a recorded approver *and* the report has zero validation errors | A system that lets an unvalidated, unapproved report leave the building is worse than no system: it creates a record saying the review happened |
| A submitted report cannot be rebuilt or resubmitted | Amendments must be explicit |
| `submission_endpoint` must be `mock`; anything else raises | This build cannot be pointed at an unknown host by configuration alone |
| Case status transitions follow an explicit state machine | No jumping from `NEW` to `FILED` |
| Settings are a frozen dataclass | A regulatory parameter cannot drift at runtime; changing one is a deployment event |
| Seeding refuses to run unless `SYNTHETIC_DATA_ONLY` is set | `--reset` drops tables |

---

## 3. What is implemented

**Passwords** — PBKDF2-HMAC-SHA256, 240,000 rounds, 16-byte random salt,
constant-time comparison. Never logged, never returned.

**Tokens** — HMAC-SHA256-signed compact JSON with `exp` and a random `jti`.
Signature verified with `hmac.compare_digest` before the payload is parsed.

**Login** — the same 401 whether the username is unknown or the password is
wrong, so the endpoint is not a username oracle.

**Audit** — append-only, `prev_hash`/`hash` chained. `GET /api/audit/verify`
re-derives every hash and reports the first divergence.
`test_tampering_with_history_breaks_the_chain` proves it detects an edit.

**Injection** — all database access is through SQLAlchemy Core/ORM constructs;
no string-built SQL anywhere.

**XSS** — the console builds DOM nodes via `ui.el()`, which uses
`document.createTextNode` for all content. `innerHTML` is used only with
literals. A customer name or a validation message cannot become markup.

**Input validation** — Pydantic models on every write route, with explicit
validators for enumerated values.

**Dependencies** — the frontend loads nothing from a third-party origin. No CDN,
no fonts, no icon packs, no analytics.

---

## 4. What a production deployment must add

The gap is stated plainly because a security document that implies more than the
code does is worse than none.

| Gap | What is needed |
|---|---|
| `SECRET_KEY` defaults to a dev value | Fail closed on the default; source from a secret manager; rotate |
| No TLS | Terminate TLS at a reverse proxy; HSTS; secure cookies if the token moves out of `localStorage` |
| Token in `localStorage` | XSS-readable. Move to an `HttpOnly`, `SameSite=Strict` cookie with CSRF protection |
| No token revocation | The `jti` is issued but not tracked. Add a revocation list, or shorten TTL and add refresh |
| No rate limiting | Login is brute-forceable. Add per-IP and per-account throttling with lockout |
| No MFA | Required for anyone who can approve or submit |
| No encryption at rest | Full-disk or column-level encryption for KYC fields |
| No CORS policy | Currently unset because the SPA is same-origin. Set an explicit allowlist if that changes |
| No security headers | CSP, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` |
| No session expiry in the UI | The token expires server-side (8h) but the console does not warn |
| Local accounts | Front with the organisation's IdP (SAML/OIDC); map groups to roles |
| No PII masking by role | An auditor sees full KYC. Roles should differ in field-level visibility |
| No migrations | Alembic before the first schema change against a persistent book |
| No backups or DR | Both, with a tested restore |

---

## 5. Never commit

```
FINTRAC credentials or API secrets
production database dumps
real customer information or KYC documents
private wallet-intelligence data
the value of SECRET_KEY
```

`.gitignore` excludes `data/`, `*.db` and `.env`. **`.gitignore` is not a
control** — it is a convenience. Rotate anything that reaches a remote.

---

## 6. Reporting a vulnerability

This is a demonstration project with no production users. If you find a
weakness worth writing down, open an issue describing it — there is no embargo
to observe here, and the finding is more useful in the open.
