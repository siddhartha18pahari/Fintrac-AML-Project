# Privacy

## The policy

**Every customer, wallet, transaction, beneficiary and third party in this
repository is fabricated.**

There is no real personal information here, no KYC document, no production
database dump and no private wallet-intelligence data. AML systems are among the
most sensitive software an organisation runs; a public portfolio project has no
business holding any of it.

The banner at the top of every page in the console says so, and it is not
dismissible.

---

## How the synthetic data is produced

[`scripts/generate_synthetic.py`](../scripts/generate_synthetic.py) manufactures
the whole dataset from a seed:

- **Names** are drawn from fixed lists of given names, surnames and invented
  business-name pairs. Any resemblance to a real person or company is a
  collision, not a reference.
- **Addresses** are hashes of `(seed, chain, tag, sequence)` with a chain-typical
  prefix. They are not valid addresses on any network and hold no value.
- **Transaction hashes** are likewise derived, and correspond to nothing on any
  chain.
- **Email addresses** use `.invalid`, the reserved TLD guaranteed never to
  resolve.
- **Postal addresses** are generic street names in real Canadian cities with
  fabricated numbers and postal codes.
- **Prices** come from a deterministic offline oracle, not a market feed. No
  network request is made at any point.
- **Risk tags** (`mixer`, `darknet_market`, `sanctioned`, …) are assigned by the
  generator to fabricated addresses. They are not sourced from any real
  blockchain-analytics provider and carry no real-world claim.

Given the same `seed` and `end`, the output is identical. Nothing is sampled
from any external source.

---

## Labelling discipline

Scenarios are **never** labelled `laundering = true`.

A behavioural pattern is not a crime, and training or evaluating a system
against such a label teaches it to assert something it cannot know. Each planted
scenario instead carries:

```
scenario_type          what pattern was planted
lvctr_expected         whether a reporting obligation should arise
alert_expected         whether at least one indicator should fire
indicators_expected    which rule ids should be implicated
```

That is what the compliance regression tests assert against, and it is what the
transaction ledger records in `synthetic_scenario`.

---

## Handling real data, if this were adopted

Nothing here should be pointed at a real book without the following, and this
list is not exhaustive:

1. **Legal basis and retention.** Under PCMLTFA a reporting entity must retain
   prescribed records; that is a *requirement to keep*, not a licence to keep
   everything indefinitely. Define retention per record class and enforce
   deletion.
2. **Minimisation.** The system currently stores full KYC in
   `customers.kyc` because the LVCTR builder needs it at construction time.
   A real deployment should hold references and pull identity data at build
   time from the system of record, so the monitoring database is not a second
   copy of the KYC store.
3. **Field-level access control.** Roles here differ in what they can *do*, not
   in what they can *see*. An auditor currently sees full KYC. Real deployments
   need masking by role — an analyst rarely needs a date of birth to triage.
4. **Encryption.** At rest and in transit; see [SECURITY.md](SECURITY.md).
5. **Access logging.** The audit trail records *actions*. Reads of personal data
   should also be logged where the regulator or the privacy regime expects it.
6. **Tipping-off.** An STR and the fact of its filing are confidential. Any
   customer-facing surface built on top of this must not expose case status,
   alert existence, or the STR draft. There is no customer-facing surface here,
   and adding one would need that analysis first.
7. **Cross-border transfer.** Deployment region and any processor's region need
   to be assessed against the applicable privacy regime.

---

## The LLM boundary

The STR copilot bundled here is **deterministic and offline**. It composes from
templates over a structured fact dictionary, makes no network request, and sends
nothing anywhere.

That is a privacy property, not just an implementation detail: case evidence
never leaves the deployment.

If an LLM were substituted via the `NarrativeGenerator` interface, the following
would be required first:

- an organisational policy permitting it, and a data-handling configuration that
  matches (no training on submitted data, defined retention, defined region)
- PII redaction before the prompt is built — the fact dictionary already
  isolates exactly what would be sent, which is why it is a dictionary and not a
  free-form context dump
- the same `verify()` pass on the output, with the draft marked unsupported if
  it fails
- human review and approval before any filing decision, which the case workflow
  already requires

---

## What is not collected

No analytics, no telemetry, no error reporting to a third party, no fonts or
scripts from a CDN. The console makes requests to its own origin and nowhere
else.
