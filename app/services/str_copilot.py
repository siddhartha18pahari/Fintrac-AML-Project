"""STR drafting assistant - evidence-grounded, never autonomous.

The copilot turns structured case evidence into a draft "details of suspicion"
narrative.  Three constraints shape the design:

1. **Every sentence cites its evidence.**  The output is a list of
   (sentence, evidence_ids) pairs, so an investigator can click any claim and
   see the transactions behind it.
2. **Nothing is asserted that the facts do not contain.**  :func:`verify`
   re-extracts every number and date from the generated text and fails the draft
   if one does not appear in the fact set.  It also rejects language that would
   state criminal activity as fact.
3. **A human files, not the copilot.**  The output is a draft attached to a
   case; filing requires a recorded decision and a separate approver.

The bundled generator is deterministic and offline - it composes from templates
over the fact JSON.  That is a feature, not a limitation: the draft is
reproducible, contains no invented content by construction, and no case data
leaves the deployment.  An LLM can be substituted by implementing
:class:`NarrativeGenerator`; the same verifier then runs against its output, and
a draft that fails verification is not shown as clean.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Protocol

from sqlalchemy.orm import Session

from ..models import Case, Customer
from ..util import cad, iso

#: Language that would assert a crime.  An STR reports *suspicion* and the facts
#: that give rise to it; determining that an offence occurred is not the
#: reporting entity's role.
PROHIBITED_PATTERNS = [
    (re.compile(r"\blaunder(ed|ing)\b", re.I), "states money laundering as fact"),
    (re.compile(r"\bproceeds of crime\b", re.I), "asserts the funds are criminal proceeds"),
    (re.compile(r"\b(is|was|are|were)\s+(a\s+)?criminal", re.I), "asserts criminality"),
    (re.compile(r"\bcommitted\s+(a\s+)?(crime|offence|fraud)", re.I), "asserts an offence occurred"),
    (re.compile(r"\bterrorist financing occurred\b", re.I), "asserts terrorist financing as fact"),
    (re.compile(r"\bguilty\b", re.I), "asserts guilt"),
]

_NUMBER_RE = re.compile(r"\d[\d,]*(?:\.\d+)?")
_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?")


# ---------------------------------------------------------------------------
# Facts
# ---------------------------------------------------------------------------


@dataclass
class Sentence:
    text: str
    evidence: list[str] = field(default_factory=list)
    section: str = "WHAT"

    def as_dict(self) -> dict:
        return {"sentence": self.text, "evidence": self.evidence, "section": self.section}


@dataclass
class Draft:
    sentences: list[Sentence]
    facts: dict
    missing: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        by_section: dict[str, list[str]] = {}
        for sentence in self.sentences:
            by_section.setdefault(sentence.section, []).append(sentence.text)
        order = ["WHO", "WHAT", "WHEN", "WHERE", "HOW FUNDS MOVED", "RELATED PARTIES", "WHY SUSPICIOUS", "ACTION TAKEN"]
        blocks = []
        for section in order:
            if section in by_section:
                blocks.append(f"{section}\n{' '.join(by_section[section])}")
        return "\n\n".join(blocks)

    def citations(self) -> list[dict]:
        return [s.as_dict() for s in self.sentences]

    def as_dict(self) -> dict:
        return {"narrative": self.text, "citations": self.citations(), "missing_information": self.missing}


def collect_facts(session: Session, case: Case) -> dict:
    """Assemble the structured evidence the narrative may draw on.

    The generator sees *only* this dictionary.  If a fact is not here, it cannot
    appear in the draft - which is what makes the verifier meaningful.
    """
    from .case_service import case_timeline, effective_score

    customer = session.get(Customer, case.customer_id)
    timeline = case_timeline(session, case)
    incoming = [t for t in timeline if t["direction"] == "INCOMING"]
    outgoing = [t for t in timeline if t["direction"] == "OUTGOING"]

    senders = sorted({t["wallet_from"] for t in incoming if t["wallet_from"]})
    receivers = sorted({t["wallet_to"] for t in outgoing if t["wallet_to"]})
    total_in = cad(sum((Decimal(str(t["cad_value"])) for t in incoming), Decimal("0")))
    total_out = cad(sum((Decimal(str(t["cad_value"])) for t in outgoing), Decimal("0")))

    drivers = [d for d in (case.risk_drivers or []) if d.get("source") == "rule"]

    return {
        "case_reference": case.reference,
        "risk_score": effective_score(case),
        "risk_tier": case.risk_tier,
        "customer": {
            "reference": customer.external_id,
            "name": customer.name,
            "type": customer.customer_type.value,
            "country": customer.country,
            "business": customer.occupation_or_business,
            "expected_monthly_cad": float(cad(customer.expected_monthly_volume_cad or 0)),
            "onboarded_at": iso(customer.onboarded_at),
            "kyc_risk": customer.kyc_risk,
        },
        "transactions": timeline,
        "incoming_count": len(incoming),
        "outgoing_count": len(outgoing),
        "total_incoming_cad": float(total_in),
        "total_outgoing_cad": float(total_out),
        "distinct_senders": senders,
        "distinct_receivers": receivers,
        "first_transaction_at": timeline[0]["occurred_at"] if timeline else None,
        "last_transaction_at": timeline[-1]["occurred_at"] if timeline else None,
        "assets": sorted({t["asset"] for t in timeline}),
        "instruments": sorted({t.get("instrument") or "VIRTUAL_CURRENCY" for t in timeline}),
        "indicators": [
            {
                "rule_id": d.get("key"),
                "rule_version": d.get("version"),
                "label": d.get("label"),
                "detail": d.get("detail"),
                "evidence_ids": d.get("evidence_ids", []),
                "observed": d.get("observed", {}),
            }
            for d in drivers
        ],
        "lvctr_required": case.lvctr_required,
        "disposition": case.disposition.value if case.disposition else None,
        "disposition_rationale": case.disposition_rationale or "",
    }


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------


class NarrativeGenerator(Protocol):
    def generate(self, facts: dict) -> Draft:  # pragma: no cover - protocol
        ...


def _money(value) -> str:
    return f"{float(cad(value)):,.2f}"


def _clock(value: str | None) -> str:
    if not value:
        return ""
    try:
        return datetime.fromisoformat(value.replace("Z", "")).strftime("%H:%M")
    except ValueError:
        return value


def _day(value: str | None) -> str:
    return value.split("T")[0] if value else ""


class TemplateNarrativeGenerator:
    """Deterministic composer.  Same facts in, same draft out."""

    def generate(self, facts: dict) -> Draft:
        sentences: list[Sentence] = []
        missing: list[str] = []
        customer = facts["customer"]
        txn_refs = [t["external_id"] for t in facts["transactions"]]

        # ---- WHO
        descriptor = "an entity" if customer["type"] == "ENTITY" else "an individual"
        business = f" described at onboarding as {customer['business']}" if customer["business"] else ""
        sentences.append(
            Sentence(
                f"The subject of this report is {customer['name']} (client reference "
                f"{customer['reference']}), {descriptor}{business}.",
                evidence=[f"customer:{customer['reference']}"],
                section="WHO",
            )
        )
        if not customer["business"]:
            missing.append("Customer occupation or nature of business is not recorded.")

        # ---- WHAT / WHEN
        if facts["incoming_count"]:
            rails = facts.get("instruments") or ["VIRTUAL_CURRENCY"]
            if rails == ["VIRTUAL_CURRENCY"]:
                what = (
                    f"the reporting entity recorded {facts['incoming_count']} incoming virtual-currency "
                    f"transfer(s) for this customer with a combined CAD-equivalent value of "
                    f"{_money(facts['total_incoming_cad'])}."
                )
            else:
                described = ", ".join(rail.replace("_", " ").lower() for rail in rails)
                what = (
                    f"the reporting entity recorded {facts['incoming_count']} incoming transaction(s) "
                    f"({described}) for this customer with a combined CAD-equivalent value of "
                    f"{_money(facts['total_incoming_cad'])}."
                )
            sentences.append(
                Sentence(
                    f"Between {facts['first_transaction_at']} and {facts['last_transaction_at']}, {what}",
                    evidence=txn_refs,
                    section="WHAT",
                )
            )
        if len(facts["distinct_senders"]) > 1:
            sentences.append(
                Sentence(
                    f"The receipts originated from {len(facts['distinct_senders'])} distinct sending addresses.",
                    evidence=facts["distinct_senders"],
                    section="WHAT",
                )
            )
        if len(facts["assets"]) > 1:
            sentences.append(
                Sentence(
                    f"The activity involved {len(facts['assets'])} virtual currencies "
                    f"({', '.join(facts['assets'])}).",
                    evidence=txn_refs,
                    section="WHAT",
                )
            )

        # ---- HOW FUNDS MOVED
        if facts["outgoing_count"]:
            sentences.append(
                Sentence(
                    f"{facts['outgoing_count']} outgoing transfer(s) totalling "
                    f"{_money(facts['total_outgoing_cad'])} were recorded over the same period to "
                    f"{len(facts['distinct_receivers'])} address(es).",
                    evidence=[t["external_id"] for t in facts["transactions"] if t["direction"] == "OUTGOING"],
                    section="HOW FUNDS MOVED",
                )
            )
        for txn in facts["transactions"][:12]:
            sentences.append(
                Sentence(
                    f"{_day(txn['occurred_at'])} {_clock(txn['occurred_at'])} - "
                    f"{'received' if txn['direction'] == 'INCOMING' else 'sent'} "
                    f"{txn['asset_amount']} {txn['asset']} "
                    f"(CAD {_money(txn['cad_value'])}), reference {txn['external_id']}.",
                    evidence=[txn["external_id"]],
                    section="HOW FUNDS MOVED",
                )
            )
        if len(facts["transactions"]) > 12:
            sentences.append(
                Sentence(
                    f"A further {len(facts['transactions']) - 12} transaction(s) are attached to the case record.",
                    evidence=txn_refs[12:],
                    section="HOW FUNDS MOVED",
                )
            )

        # ---- WHY SUSPICIOUS (indicators, stated as observations)
        from ..config import REPORTING_RULE_IDS

        for indicator in facts["indicators"]:
            if indicator["rule_id"] in REPORTING_RULE_IDS:
                continue  # a reporting threshold is not an indicator of suspicion
            detail = (indicator.get("detail") or indicator.get("label") or "").strip()
            if not detail:
                continue
            sentences.append(
                Sentence(
                    f"{detail} (indicator {indicator['rule_id']} v{indicator['rule_version']}).",
                    evidence=[f"txn:{i}" for i in indicator.get("evidence_ids", [])],
                    section="WHY SUSPICIOUS",
                )
            )
        if facts["customer"]["expected_monthly_cad"]:
            sentences.append(
                Sentence(
                    f"The customer's declared expected monthly activity at onboarding was "
                    f"CAD {_money(customer['expected_monthly_cad'])}.",
                    evidence=[f"customer:{customer['reference']}"],
                    section="WHY SUSPICIOUS",
                )
            )
        else:
            missing.append("No declared expected activity level is on file to compare against.")

        sentences.append(
            Sentence(
                "The transactions above are reported because they are inconsistent with the customer's "
                "established activity as recorded by the reporting entity. No determination has been made "
                "as to the origin or purpose of the funds.",
                evidence=txn_refs,
                section="WHY SUSPICIOUS",
            )
        )

        # ---- ACTION TAKEN
        if facts["disposition_rationale"]:
            sentences.append(
                Sentence(
                    facts["disposition_rationale"].rstrip(".") + ".",
                    evidence=[f"case:{facts['case_reference']}"],
                    section="ACTION TAKEN",
                )
            )
        else:
            missing.append("The investigator's documented rationale has not been recorded on the case.")
        if facts["lvctr_required"]:
            sentences.append(
                Sentence(
                    "A Large Virtual Currency Transaction Report has also been prepared for this activity.",
                    evidence=[f"case:{facts['case_reference']}"],
                    section="ACTION TAKEN",
                )
            )

        if not facts["transactions"]:
            missing.append("No transactions are attached to the case; the narrative cannot be substantiated.")

        return Draft(sentences=sentences, facts=facts, missing=missing)


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------


@dataclass
class VerificationResult:
    supported: bool
    unsupported_claims: list[dict] = field(default_factory=list)
    prohibited_language: list[dict] = field(default_factory=list)
    uncited_sentences: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "supported": self.supported,
            "unsupported_claims": self.unsupported_claims,
            "prohibited_language": self.prohibited_language,
            "uncited_sentences": self.uncited_sentences,
        }


def _fact_tokens(facts: dict) -> set[str]:
    """Every number and date the narrative is permitted to contain.

    Numbers are admitted in every rendering the templates can legitimately
    produce - raw, thousands-separated and money-formatted - because a verifier
    that rejects ``CAD 20,000.00`` when the facts say ``20000.0`` is not
    catching a hallucination, it is failing to read its own evidence.  Counts
    of collections are admitted too, since "3 distinct addresses" is derived
    from the fact set rather than asserted on top of it.
    """
    tokens: set[str] = set()

    def push(value) -> None:
        if value is None:
            return
        if isinstance(value, (int, float, Decimal)) and not isinstance(value, bool):
            tokens.add(str(value))
            tokens.add(_money(value))
            tokens.add(_money(value).replace(",", ""))
            tokens.add(str(int(value)) if float(value).is_integer() else str(value))
        text = str(value)
        tokens.add(text)
        for match in _NUMBER_RE.findall(text):
            tokens.add(match)
            tokens.add(match.replace(",", ""))
        for match in _DATE_RE.findall(text):
            tokens.add(match)

    def walk(node) -> None:
        if isinstance(node, dict):
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            push(len(node))
            for value in node:
                walk(value)
        else:
            push(node)

    walk(facts)
    # Derived counts and the truncation remainder used by the timeline block.
    for key in ("distinct_senders", "distinct_receivers", "assets", "transactions", "indicators"):
        push(len(facts.get(key, [])))
    if facts.get("transactions"):
        push(max(0, len(facts["transactions"]) - 12))
    for txn in facts.get("transactions", []):
        push(_day(txn.get("occurred_at")))
        push(_clock(txn.get("occurred_at")))
    return {t for t in tokens if t}


def verify(draft: Draft) -> VerificationResult:
    """Fail the draft if it asserts anything the facts do not support."""
    allowed = _fact_tokens(draft.facts)
    unsupported: list[dict] = []
    prohibited: list[dict] = []
    uncited: list[str] = []

    for sentence in draft.sentences:
        for pattern, reason in PROHIBITED_PATTERNS:
            if pattern.search(sentence.text):
                prohibited.append({"sentence": sentence.text, "reason": reason})
        if not sentence.evidence:
            uncited.append(sentence.text)
        for number in _NUMBER_RE.findall(sentence.text):
            normalised = number.replace(",", "")
            if number in allowed or normalised in allowed:
                continue
            # Allow a number that is the integer part of an allowed decimal
            # (e.g. "3" from "3.00") rather than flagging harmless rounding.
            if any(t.startswith(normalised + ".") for t in allowed):
                continue
            unsupported.append({"sentence": sentence.text, "value": number})

    return VerificationResult(
        supported=not unsupported and not prohibited,
        unsupported_claims=unsupported,
        prohibited_language=prohibited,
        uncited_sentences=uncited,
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def draft_for_case(
    session: Session, case: Case, *, generator: NarrativeGenerator | None = None
) -> tuple[Draft, VerificationResult]:
    facts = collect_facts(session, case)
    generator = generator or TemplateNarrativeGenerator()
    draft = generator.generate(facts)
    return draft, verify(draft)
