# FINTRAC mapping and validation

> The payload format here follows the 2021 JSON-LD structure reconstructed from
> [`8KSS/FINTRAC-LVCTR`](https://github.com/8KSS/FINTRAC-LVCTR). It is **not** an
> official FINTRAC artefact. A reporting entity must reconcile every field
> against FINTRAC's current technical documentation before filing anything, and
> this project only ever submits to its own mock receiver.

---

## The two-model rule

```
   database  ──►  canonical report body  ──►  mapper  ──►  FINTRAC payload
   (ours)          (ours, persisted)         (one file)     (theirs)
```

The database is never bound to the external schema.
`app/services/fintrac_mapper.py` is the only module that knows FINTRAC's field
names. Reports persist both the canonical body and the rendered payload, so a
filing from an older schema version stays explicable.

---

## Canonical → LVCTR JSON-LD

### Report root

| Canonical | FINTRAC | Source |
|---|---|---|
| — | `@context` | `http://fintrac-canafe.gc.ca/reporting/api/lvctr/2021` |
| — | `@type` | `LvctrForm` |
| `reporting_entity.reporting_entity_number` | `reportingEntityNumber` | configuration (F2R → Organization → My Organization) |
| `report_reference` | `reportReference` | `{prefix}-{case reference}` |
| `reporting_entity.activity_sector_code` | `details.activitySectorCode` | configuration; `11` = money services business |
| `reporting_entity.contact_number` | `details.contactNumber` | configuration (F2R → Organization → Users) |
| `aggregation.type_code` | `details.twentyFourHourAggregationTypeCode` | from the aggregation event's `group_type` |
| `aggregation.start` / `.end` | `details.twentyFourHour{Start,End}DateTime` | the event's window; omitted for a single-receipt report |

### Subjects → `definitions[]`

Each subject is declared once with a `$id` and referenced by `$ref`.

| Canonical subject | FINTRAC node | Key fields |
|---|---|---|
| `kind: person` | `LvctrPersonDetails` | `surname`, `givenName`, `birthDate`, `occupation`, `employerName`, `residenceCountryCode`, `address.LvctrStructuredAddress`, `LvctrPersonIdentificationDetails[]` |
| `kind: entity` | `LvctrEntityDetails` | `legalName`, `businessNature`, `registrationIndicator`, `registrationNumber`, `registrationJurisdiction*`, `authorizedPersons[]`, `LvctrEntityIdentificationDetails[]` |

Reference prefixes: `C{id}` customer, `B{id}` beneficiary, `T{id}` third party.
All are within the 32-character `$id` limit.

Subjects are registered **lazily**, as each receipt names the parties it
actually involves. Registering the case's customer up front would declare an
unused subject on a beneficiary-grouped report where they happen not to be one
of the conductors — which Level 4 would then flag.

### One receipt → one `LvctrTransaction`

| Canonical | FINTRAC |
|---|---|
| `reference` | `details.transactionReference` (≤20 chars — the case number is compressed to fit) |
| `occurred_at` | `details.transactionDateTime` |
| `location_reference` | `details.locationReference` (configuration; F2R → Organization → Location) |
| `method_code` | `details.transactionMethodTypeCode` (`8` = online) |
| `threshold_indicator` | `details.thresholdIndicator` — true only for a single receipt at or above the threshold |
| `identifiers` | `details.transactionIdentifiers[]` — the blockchain hash |

**Starting action** (`LvctrStartingAction`) — the receipt as it arrived:

| Canonical | FINTRAC |
|---|---|
| `asset` | `details.virtualCurrencyTypeCode` |
| `asset_amount` | `details.virtualCurrencyAmount` (decimal **string**) |
| `exchange_rate` | `details.canadianExchangeRate` |
| `sending_addresses` | `details.sendingVirtualCurrencyAddresses[]` |
| `conductor_ref` | `conductors[0].subject.$ref` — **each receipt names its own conductor.** A beneficiary or third-party aggregation exists precisely because the conductors differ, so a single report can and does carry several |
| device / IP / username | `conductors[0].details.device*`, `username`, `email` |
| `on_behalf_of[]` | `conductors[0].onBehalfOfs[]` with `relationshipTypeCode` |

**Completing action** (`LvctrCompletingAction`) — what the entity did with it:

| Canonical | FINTRAC |
|---|---|
| `disposition_type_code` | `details.dispositionTypeCode` (`17` = added to virtual currency wallet) |
| `cad_value` | `details.canadianEquivalentAmount` |
| — | `details.currencyTypeCode` = `CAD` |
| `receiving_addresses` | `details.receivingVirtualCurrencyAddresses[]` |
| `account_number`, `account_type_code` | `details.accountNumber`, `accountTypeCode` |
| `beneficiary` | `beneficiaries[0].subject.$ref` + `beneficiaryIndicator` |

### Amounts are strings

`virtualCurrencyAmount`, `canadianEquivalentAmount` and `canadianExchangeRate`
are emitted as decimal strings via `util.token_amount()`, never as JSON numbers.
Emitting a float is how `0.1 + 0.2` ends up in a regulatory filing, and
`token_amount` also strips the storage-scale padding that would otherwise report
0.03 BTC as `0.030000000000000000`.

---

## Code lists

Extracted verbatim from the reference implementation's `<select>` options and
enforced at Level 1:

`activitySectorCode` (19) · `twentyFourHourAggregationTypeCode` (4) ·
`transactionMethodTypeCode` (4) · `dispositionTypeCode` (22) ·
`accountTypeCode` (5) · `deviceTypeCode` (4) · `relationshipTypeCode` (13) ·
`identificationTypeCode` (16)

Six "Other" pairs are enforced at Level 2 — selecting the Other code makes the
free-text sibling mandatory:

| Code field | Other value | Required sibling |
|---|---|---|
| `transactionMethodTypeCode` | `7` | `transactionMethodTypeOther` |
| `dispositionTypeCode` | `11` | `dispositionTypeOther` |
| `accountTypeCode` | `4` | `accountTypeOther` |
| `deviceTypeCode` | `4` | `deviceTypeOther` |
| `relationshipTypeCode` | `9` | `relationshipTypeOther` |
| `identificationTypeCode` | `3` | `identificationTypeOther` |

---

## The five validation levels

The reference README called validation its most important missing feature: build
the file, upload it, and only then discover which of 516 rules it broke.
Everything checkable locally is checked locally, with the failing path and a
plain-English reason.

### Level 1 — field format

Types, lengths, patterns and code lists, from the constraint table in the
reference implementation's `MyValidation()`.

| Code | Catches |
|---|---|
| `L1-BOOL` | an indicator that is not a boolean |
| `L1-AMOUNT` | an amount emitted as a float |
| `L1-DATETIME` / `L1-DATE` | a mis-formatted date-time or date |
| `L1-ALPHA2` / `L1-ALPHA3` | a bad country, province or currency code |
| `L1-CODELIST` | a value outside the published code list |
| `L1-LENGTH` | a field over its documented limit |
| `L1-CHARSET` | characters the report format rejects (warning) |

### Level 2 — business rules

Conditional requirements between fields.

| Code | Catches |
|---|---|
| `L2-OTHER-REQUIRED` | an "Other" code without its free-text sibling |
| `L2-CONDUCTOR-REQUIRED` | `conductorIndicator` true with no conductor |
| `L2-ONBEHALF-REQUIRED` / `L2-ONBEHALF-FLAG` | the third-party indicator and the third-party block disagreeing, in either direction |
| `L2-BENEFICIARY-REQUIRED` / `L2-BENEFICIARY-FLAG` | the same for beneficiaries |
| `L2-SOURCE-REQUIRED`, `L2-INVOLVEMENT-REQUIRED` | indicators without their blocks |
| `L2-24H-WINDOW` / `L2-24H-ORDER` | an aggregation type declared without a complete, ordered window |
| `L2-SENDING-ADDRESS`, `L2-PURPOSE`, `L2-ACCOUNT-NUMBER` | missing but non-blocking detail (warnings) |

### Level 3 — JSON Schema

[`app/schemas_json/lvctr.schema.json`](../app/schemas_json/lvctr.schema.json),
Draft-07, `additionalProperties: false` throughout so a typo'd field name is an
error rather than silently ignored.

### Level 4 — cross-field and reference integrity

| Code | Catches |
|---|---|
| `L4-DANGLING-REF` | a `$ref` with no matching `$id` — the failure the reference README anticipated |
| `L4-UNUSED-SUBJECT` | a declared subject nothing references (warning) |
| `L4-DUPLICATE-ID` / `L4-DUPLICATE-TXN-REF` | duplicate identifiers |
| `L4-CAD-MISMATCH` | `canadianEquivalentAmount` that does not reconcile with amount × rate (2% tolerance) |
| `L4-ASSET-MISMATCH` | starting and completing actions in different assets (warning) |
| `L4-OUTSIDE-WINDOW` | a transaction outside the declared 24-hour window |

### Level 5 — submission response

The receiver's own verdict, parsed into the same issue vocabulary and folded
back into the report's validation record, so a rejection appears in the same
place as a local error rather than only in a response blob.

**Readiness** is `100 − (10 × errors + 2 × warnings)`, floored at 0. Errors are
weighted an order of magnitude above warnings because a warning still submits.

---

## The mock receiver

`POST /api/mock-fintrac/reports/lvctr` and `.../str`.

It applies its **own** rules with its own codes (`VAL-1xx`) — deliberately not
the same code as the local validator, so it is a genuine second opinion rather
than a mirror. It is deterministic: identical input always produces an identical
verdict, so demos replay.

| Code | Rejection |
|---|---|
| `VAL-101` | reporting entity number missing or not numeric |
| `VAL-102` / `VAL-103` | report reference missing, or already accepted |
| `VAL-104` / `VAL-105` | contact number, activity sector |
| `VAL-106` | aggregation type without a complete window |
| `VAL-107` | referenced subject does not exist |
| `VAL-108` | no transactions |
| `VAL-109` | location reference missing |
| `VAL-110` / `VAL-111` | transaction date-time in the future, or unparsable |
| `VAL-112` | no sending virtual-currency address |
| `VAL-113` | exchange rate not a positive decimal |
| `VAL-114` | unrecognised disposition type code |
| `VAL-115` | Canadian equivalent amount not a positive decimal |

Submission is blocked locally unless the case is approved with a recorded
approver, the report has zero validation errors, it has not already been
submitted, and `settings.submission_endpoint` is `mock`.

---

## STR: what is and is not claimed

The STR path produces a **canonical body** (subject, indicators, timeline,
narrative, citations, action taken) and validates it for completeness.

It does **not** claim a FINTRAC STR schema mapping. That schema was not
available to reconcile against, and inventing a plausible-looking one would be
worse than declaring the gap: a payload that looks official and is wrong is more
dangerous than an obviously internal one.

To add it: implement `to_fintrac_str(canonical)` alongside `to_fintrac_lvctr`,
add its schema to `schemas_json/`, and extend `report_builder.build_report`. The
canonical body already carries every field such a mapping would need.
