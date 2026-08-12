# Legacy repository analysis — `8KSS/FINTRAC-LVCTR`

*Phase 0 deliverable. What the reference implementation provides, what was
reused, and what was deliberately not carried forward.*

---

## 1. What the reference repository is

A single 227 KB HTML file (`LVCTR_FORM2.HTML`) plus a README, published by
Joseph Iuso, CAMS, in 2021 to help Canadian dealers in virtual currency meet the
1 June 2021 LVCTR deadline. It runs stand-alone in a browser, transmits nothing,
and emits a JSON-LD payload for upload into F2R.

Its own README is candid about the state of the code: written in under two
weeks, not refactored, not user-friendly, and explicitly asking the community
for help with validation, blockchain sender auto-fill, JSON download, and more
test-data cases.

**It is a good artefact for what it is**, and it is the authoritative record
available to this project of the 2021 field structure.

---

## 2. What was extracted from it

### 2.1 The field map

314 distinct form field ids were extracted from the HTML and used to reconstruct
the payload hierarchy:

```
LvctrForm
├── reportingEntityNumber, reportReference
├── details (LvctrFormDetails)
│     activitySectorCode, contactNumber, ministerialDirectiveCode,
│     twentyFourHourAggregationTypeCode, twentyFourHour{Start,End}DateTime
├── definitions[]                        ← subjects, each with a $id
│     LvctrPersonDetails | LvctrEntityDetails | LvctrPersonName | LvctrEntityName
│     └── address, identifications, authorizedPersons
└── transactions[] (LvctrTransaction)
      ├── details (LvctrTransactionDetails)
      ├── startingActions[] (LvctrStartingAction)
      │     ├── details: virtualCurrencyTypeCode/Amount, canadianExchangeRate,
      │     │            sendingVirtualCurrencyAddresses[], indicators
      │     ├── conductors[] → subject.$ref, onBehalfOfs[]
      │     └── sourcesOfVirtualCurrency[] → name.$ref
      └── completingActions[] (LvctrCompletingAction)
            ├── details: dispositionTypeCode, canadianEquivalentAmount, account…
            ├── beneficiaries[] → subject.$ref
            ├── involvements[]  → name.$ref
            └── accountHolders[] → name.$ref
```

Implemented in [`app/services/fintrac_mapper.py`](../app/services/fintrac_mapper.py).

### 2.2 The `$id` / `$ref` mechanism

The README flags this as something it was unsure about: subjects are declared
once in `definitions[]` with a `$id`, then referenced from transactions by
`$ref`. That reading is implemented, and **Level 4 validation enforces it** —
every `$ref` must resolve to a declared `$id`, and a declared subject that is
never referenced raises a warning. This is one of the failure modes the original
README anticipated (`"Beneficiary reference does not exist."`).

### 2.3 Eight code lists

Extracted verbatim from the form's `<select>` options:
`activitySectorCode` (19), `twentyFourHourAggregationTypeCode` (4),
`transactionMethodTypeCode` (4), `dispositionTypeCode` (22),
`accountTypeCode` (5), `deviceTypeCode` (4), `relationshipTypeCode` (13),
`identificationTypeCode` (16).

Level 1 validation rejects any value outside these lists, and Level 2 enforces
the "Other" pairs — selecting code `7` for `transactionMethodTypeCode` makes
`transactionMethodTypeOther` mandatory, and so on for all six pairs.

### 2.4 Field type and length constraints

The form's `MyValidation()` function encodes the constraint table in seven
arrays. All of it was carried into `fintrac_mapper.MAX_LENGTHS` and the type
sets:

| Constraint | Fields |
|---|---|
| ≤ 10 chars | `telephoneExtension`, `ministerialDirectiveCode`, `unitNumber`, `buildingNumber` |
| ≤ 20 chars | `telephoneNumber`, `postalCode`, `transactionReference`, `locationReference` |
| ≤ 32 chars | `$id`, `$ref` |
| ≤ 50 chars | `accountNumber`, `identificationNumber`, `clientNumber`, … |
| ≤ 100 chars | `surname`, `givenName`, `legalName`, `virtualCurrencyTypeCode`, … |
| ≤ 200 chars | `occupation`, `email`, `transactionPurpose`, sending/receiving addresses, … |
| ≤ 500 chars | `unstructuredAddressDetails` |
| alpha-2 | all country and province codes |
| alpha-3 | `currencyTypeCode`, `accountCurrencyTypeCode` |
| decimal | `virtualCurrencyAmount`, `canadianEquivalentAmount`, `canadianExchangeRate` |
| boolean | the eight `*Indicator` fields |

That table is why `transactionReference` in this project is `T<digits>-<seq>`
compressed to 20 characters rather than the full case reference.

### 2.5 The three F2R identifiers the README explains

`reportingEntityNumber`, `contactNumber` and `locationReference` come from the
reporting entity's own F2R organisation record and cannot be derived by any
system. They are configuration here
([`ReportingEntityProfile`](../app/config.py)), not data.

---

## 3. What was deliberately not carried forward

| Legacy characteristic | Why not, and what replaced it |
|---|---|
| **Everything in one HTML file** | The README asks for this to be preserved, and for its purpose that is right. It is the wrong shape for a monitoring platform: there is nowhere to put a 24-hour window, a case, or an audit trail. The report builder here is one module at the end of a pipeline. |
| **Manual field entry** | Reports are constructed from case evidence. A human never retypes a wallet address that the ledger already holds. |
| **Validation only at upload** | Five levels, four of them local. The README notes there were 516 validation rules and that discovering them by upload was "very cumbersome". |
| **Select-all-and-copy output** | `GET /api/reports/{id}/download` returns the payload as a file — one of the README's explicitly requested features. |
| **One hard-coded "FILL TEST DATA" case** | A scenario-driven generator with 15 labelled patterns, requested in the README as a dropdown of use cases. |
| **F2R-era submission assumption** | FINTRAC now supports the Web Reporting System and API submission. This project does not assume the 2021 file-upload workflow is the only mechanism; it submits to a mock receiver behind a swappable interface. |
| **The 2021 `@context` as authoritative** | It is retained because it is what the reference targets, and flagged in the mapper, the payload viewer and this document as requiring reconciliation against FINTRAC's current technical documentation before any real use. |

---

## 4. The README's wish list, and where each item landed

| Requested in the legacy README | Status here |
|---|---|
| Auto-pull blockchain sender data | **Partly.** Sending addresses come from the ingested ledger rather than a block explorer. No explorer client is included — a portfolio project should not ship an unauthenticated third-party API dependency. |
| Two-level validation before upload | **Exceeded.** Five levels; see [FINTRAC_MAPPING.md](FINTRAC_MAPPING.md). |
| Copy button / downloadable JSON | **Done.** `/api/reports/{id}/download`, and the payload is rendered in the console. |
| Expand test data to more use cases | **Done.** 15 labelled scenarios in `scripts/generate_synthetic.py`. |
| Make it more user-friendly | **Done.** A full investigator console, still with no build step and no external requests. |
| Refactoring | **Superseded.** This is a reimplementation, not a refactor of the HTML. |

---

## 5. Assessment

The correct use of `8KSS/FINTRAC-LVCTR` is as a **legacy reference
implementation, a field-mapping reference, and a UI/JSON prototype**.

It is not a current FINTRAC schema, and it should not be treated as one. Its own
README does not claim otherwise: *"The source is free and not endorsed by
FINTRAC or others."*

Everything derived from it in this project is confined to
`app/services/fintrac_mapper.py` and `app/schemas_json/lvctr.schema.json`, so a
schema update touches two files rather than the whole system. That containment
is the single most important architectural decision inherited from studying it.
