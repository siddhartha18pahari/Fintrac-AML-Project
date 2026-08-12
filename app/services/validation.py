"""Five-level report validation.

The reference implementation called out validation as its most important missing
feature: build the file, upload it, and only then discover which of hundreds of
rules it broke.  This module inverts that - everything that can be checked
locally is checked locally, with the failing path and a plain-English reason.

    Level 1  field format      types, lengths, patterns, code lists
    Level 2  business rules    conditional requirements between fields
    Level 3  JSON Schema       structural conformance to the report schema
    Level 4  cross-field       reference resolution and arithmetic consistency
    Level 5  submission        parsing and storing the endpoint's own verdict

Levels 1-4 run before anything leaves the building.  Level 5 records what came
back, so a rejection is evidence rather than a lost console message.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator

from ..util import cad
from . import fintrac_mapper as fm

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schemas_json" / "lvctr.schema.json"

ERROR = "ERROR"
WARNING = "WARNING"

_DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_AMOUNT_RE = re.compile(r"^-?\d+(\.\d+)?$")
_ALPHA2_RE = re.compile(r"^[A-Z]{2}$")
_ALPHA3_RE = re.compile(r"^[A-Z]{3}$")
# The reference implementation rejects special symbols in most free-text fields.
_SAFE_TEXT_RE = re.compile(r"^[\w \-'.,/()#&:@+]*$", re.UNICODE)


@dataclass
class Issue:
    level: int
    severity: str
    code: str
    path: str
    message: str
    field_name: str = ""

    def as_dict(self) -> dict:
        return {
            "level": self.level,
            "severity": self.severity,
            "code": self.code,
            "path": self.path,
            "field": self.field_name,
            "message": self.message,
        }


@dataclass
class ValidationResult:
    issues: list[Issue] = field(default_factory=list)
    levels_run: list[int] = field(default_factory=list)

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == ERROR]

    @property
    def warnings(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == WARNING]

    @property
    def valid(self) -> bool:
        return not self.errors

    @property
    def readiness(self) -> int:
        """A 0-100 "how close is this to submittable" figure for the UI.

        Errors are weighted an order of magnitude above warnings because a
        warning still submits.
        """
        penalty = len(self.errors) * 10 + len(self.warnings) * 2
        return max(0, 100 - min(100, penalty))

    def as_dict(self) -> dict:
        return {
            "valid": self.valid,
            "readiness": self.readiness,
            "error_count": len(self.errors),
            "warning_count": len(self.warnings),
            "levels_run": self.levels_run,
            "issues": [i.as_dict() for i in self.issues],
        }


# ---------------------------------------------------------------------------
# Level 1 - field format
# ---------------------------------------------------------------------------


def _walk(node: Any, path: str = ""):
    if isinstance(node, dict):
        for key, value in node.items():
            child = f"{path}.{key}" if path else key
            yield child, key, value
            yield from _walk(value, child)
    elif isinstance(node, list):
        for index, value in enumerate(node):
            child = f"{path}[{index}]"
            yield from _walk(value, child)


def validate_level1(payload: dict) -> list[Issue]:
    issues: list[Issue] = []

    def add(code: str, path: str, name: str, message: str, severity: str = ERROR) -> None:
        issues.append(Issue(level=1, severity=severity, code=code, path=path, message=message, field_name=name))

    for path, name, value in _walk(payload):
        if isinstance(value, (dict, list)) or value is None:
            continue

        if name in fm.BOOLEAN_FIELDS and not isinstance(value, bool):
            add("L1-BOOL", path, name, f"{name} must be a boolean, got {type(value).__name__}.")
            continue

        if name in fm.AMOUNT_FIELDS:
            if not isinstance(value, str) or not _AMOUNT_RE.match(value):
                add(
                    "L1-AMOUNT",
                    path,
                    name,
                    f"{name} must be a decimal string (floats lose precision in a filing), got {value!r}.",
                )
            continue

        if name in fm.DATETIME_FIELDS:
            if not isinstance(value, str) or not _DATETIME_RE.match(value):
                add("L1-DATETIME", path, name, f"{name} must be formatted YYYY-MM-DDThh:mm:ss, got {value!r}.")
            continue

        if name in fm.LOCAL_DATE_FIELDS:
            if not isinstance(value, str) or not _DATE_RE.match(value):
                add("L1-DATE", path, name, f"{name} must be formatted YYYY-MM-DD, got {value!r}.")
            continue

        if name in fm.ALPHA2_FIELDS and (not isinstance(value, str) or not _ALPHA2_RE.match(value)):
            add("L1-ALPHA2", path, name, f"{name} must be a two-letter uppercase code, got {value!r}.")
            continue

        if name in fm.ALPHA3_FIELDS and (not isinstance(value, str) or not _ALPHA3_RE.match(value)):
            add("L1-ALPHA3", path, name, f"{name} must be a three-letter currency code, got {value!r}.")
            continue

        if name in fm.INT_CODE_FIELDS:
            if not isinstance(value, str) or not value.isdigit():
                add("L1-CODE", path, name, f"{name} must be a numeric code string, got {value!r}.")
            elif name in fm.CODE_LISTS and value not in fm.CODE_LISTS[name]:
                allowed = ", ".join(sorted(fm.CODE_LISTS[name], key=int))
                add("L1-CODELIST", path, name, f"{value!r} is not a valid {name}. Allowed: {allowed}.")
            continue

        if isinstance(value, str):
            limit = fm.MAX_LENGTHS.get(name)
            if limit and len(value) > limit:
                add("L1-LENGTH", path, name, f"{name} exceeds its {limit}-character limit ({len(value)} used).")
            if limit and not _SAFE_TEXT_RE.match(value):
                add(
                    "L1-CHARSET",
                    path,
                    name,
                    f"{name} contains characters the report format rejects.",
                    severity=WARNING,
                )
    return issues


# ---------------------------------------------------------------------------
# Level 2 - business rules
# ---------------------------------------------------------------------------


def validate_level2(payload: dict) -> list[Issue]:
    issues: list[Issue] = []

    def add(code: str, path: str, message: str, severity: str = ERROR, name: str = "") -> None:
        issues.append(Issue(level=2, severity=severity, code=code, path=path, message=message, field_name=name))

    # "Other" codes require their free-text sibling.
    for path, name, value in _walk(payload):
        pair = fm.OTHER_CODE_PAIRS.get(name)
        if not pair:
            continue
        other_code, other_field = pair
        if value != other_code:
            continue
        parent_path = path.rsplit(".", 1)[0]
        parent = _resolve(payload, parent_path)
        if not isinstance(parent, dict) or not parent.get(other_field):
            add("L2-OTHER-REQUIRED", path, f"{name} is 'Other' ({other_code}), so {other_field} is required.", name=name)

    details = payload.get("details", {})
    aggregation_code = details.get("twentyFourHourAggregationTypeCode")
    if aggregation_code and aggregation_code != "4":
        if not details.get("twentyFourHourStartDateTime") or not details.get("twentyFourHourEndDateTime"):
            add(
                "L2-24H-WINDOW",
                "details",
                "A 24-hour aggregation type was declared, so both twentyFourHourStartDateTime "
                "and twentyFourHourEndDateTime are required.",
            )
        else:
            start = details["twentyFourHourStartDateTime"]
            end = details["twentyFourHourEndDateTime"]
            if start >= end:
                add("L2-24H-ORDER", "details", "The 24-hour window start must precede its end.")

    for t_index, txn in enumerate(payload.get("transactions", [])):
        base = f"transactions[{t_index}]"
        t_details = txn.get("details", {})

        if not txn.get("startingActions"):
            add("L2-NO-START", base, "A transaction must have at least one starting action.")
        if not txn.get("completingActions"):
            add("L2-NO-COMPLETE", base, "A transaction must have at least one completing action.")

        for s_index, action in enumerate(txn.get("startingActions", [])):
            s_path = f"{base}.startingActions[{s_index}]"
            s_details = action.get("details", {})

            if s_details.get("conductorIndicator") and not action.get("conductors"):
                add(
                    "L2-CONDUCTOR-REQUIRED",
                    s_path,
                    "conductorIndicator is true, so at least one conductor must be provided.",
                )
            if s_details.get("sourceOfVirtualCurrencyIndicator") and not action.get("sourcesOfVirtualCurrency"):
                add(
                    "L2-SOURCE-REQUIRED",
                    s_path,
                    "sourceOfVirtualCurrencyIndicator is true, so sourcesOfVirtualCurrency is required.",
                )
            if not s_details.get("sendingVirtualCurrencyAddresses"):
                add(
                    "L2-SENDING-ADDRESS",
                    s_path,
                    "No sending virtual-currency address was recorded for this receipt.",
                    severity=WARNING,
                )
            for c_index, conductor in enumerate(action.get("conductors", [])):
                c_path = f"{s_path}.conductors[{c_index}]"
                c_details = conductor.get("details", {})
                if c_details.get("onBehalfOfIndicator") and not conductor.get("onBehalfOfs"):
                    add(
                        "L2-ONBEHALF-REQUIRED",
                        c_path,
                        "onBehalfOfIndicator is true, so third-party details are required.",
                    )
                if not c_details.get("onBehalfOfIndicator") and conductor.get("onBehalfOfs"):
                    add(
                        "L2-ONBEHALF-FLAG",
                        c_path,
                        "Third-party details are present but onBehalfOfIndicator is not set.",
                    )

        for c_index, action in enumerate(txn.get("completingActions", [])):
            c_path = f"{base}.completingActions[{c_index}]"
            c_details = action.get("details", {})
            if c_details.get("beneficiaryIndicator") and not action.get("beneficiaries"):
                add(
                    "L2-BENEFICIARY-REQUIRED",
                    c_path,
                    "beneficiaryIndicator is true, so at least one beneficiary must be provided.",
                )
            if not c_details.get("beneficiaryIndicator") and action.get("beneficiaries"):
                add("L2-BENEFICIARY-FLAG", c_path, "Beneficiaries are present but beneficiaryIndicator is not set.")
            if c_details.get("involvementIndicator") and not action.get("involvements"):
                add(
                    "L2-INVOLVEMENT-REQUIRED",
                    c_path,
                    "involvementIndicator is true, so involvements are required.",
                )
            if c_details.get("accountTypeCode") and not c_details.get("accountNumber"):
                add(
                    "L2-ACCOUNT-NUMBER",
                    c_path,
                    "An account type was recorded without an account number.",
                    severity=WARNING,
                )

        if not t_details.get("transactionPurpose"):
            add(
                "L2-PURPOSE",
                base,
                "No transaction purpose recorded; FINTRAC expects the purpose where it is known.",
                severity=WARNING,
            )

    return issues


def _resolve(payload: Any, path: str) -> Any:
    node = payload
    if not path:
        return node
    for part in re.findall(r"[^.\[\]]+|\[\d+\]", path):
        if part.startswith("["):
            node = node[int(part[1:-1])]
        elif isinstance(node, dict):
            node = node.get(part)
        else:
            return None
        if node is None:
            return None
    return node


# ---------------------------------------------------------------------------
# Level 3 - JSON Schema
# ---------------------------------------------------------------------------

_schema_cache: dict | None = None


def load_schema() -> dict:
    global _schema_cache
    if _schema_cache is None:
        _schema_cache = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    return _schema_cache


def validate_level3(payload: dict) -> list[Issue]:
    validator = Draft7Validator(load_schema())
    issues = []
    for error in sorted(validator.iter_errors(payload), key=lambda e: list(e.absolute_path)):
        path = ".".join(str(p) for p in error.absolute_path) or "(root)"
        name = str(error.absolute_path[-1]) if error.absolute_path else ""
        issues.append(
            Issue(
                level=3,
                severity=ERROR,
                code="L3-SCHEMA",
                path=path,
                message=error.message,
                field_name=name if not str(name).isdigit() else "",
            )
        )
    return issues


# ---------------------------------------------------------------------------
# Level 4 - cross-field and reference integrity
# ---------------------------------------------------------------------------


def validate_level4(payload: dict, *, rate_tolerance: Decimal = Decimal("0.02")) -> list[Issue]:
    issues: list[Issue] = []

    def add(code: str, path: str, message: str, severity: str = ERROR) -> None:
        issues.append(Issue(level=4, severity=severity, code=code, path=path, message=message))

    index = fm.index_references(payload)
    for ref, path in index.used:
        if ref not in index.declared:
            add(
                "L4-DANGLING-REF",
                path,
                f'Referenced subject "{ref}" does not exist in definitions.',
            )
    unused = set(index.declared) - {ref for ref, _ in index.used}
    for ref in sorted(unused):
        add(
            "L4-UNUSED-SUBJECT",
            "definitions",
            f'Subject "{ref}" is declared but never referenced by a transaction.',
            severity=WARNING,
        )

    seen_refs: set[str] = set()
    for definition in payload.get("definitions", []):
        for body in definition.values():
            subject_id = body.get("$id")
            if subject_id in seen_refs:
                add("L4-DUPLICATE-ID", "definitions", f'Duplicate subject id "{subject_id}".')
            seen_refs.add(subject_id)

    references: set[str] = set()
    for t_index, txn in enumerate(payload.get("transactions", [])):
        base = f"transactions[{t_index}]"
        reference = txn.get("details", {}).get("transactionReference")
        if reference in references:
            add("L4-DUPLICATE-TXN-REF", base, f'Duplicate transactionReference "{reference}".')
        references.add(reference)

        for s_index, action in enumerate(txn.get("startingActions", [])):
            s_details = action.get("details", {})
            completing = txn.get("completingActions", [])
            if s_index >= len(completing):
                continue
            c_details = completing[s_index].get("details", {})
            try:
                amount = Decimal(s_details.get("virtualCurrencyAmount", "0"))
                rate = Decimal(s_details.get("canadianExchangeRate", "0"))
                declared = Decimal(c_details.get("canadianEquivalentAmount", "0"))
            except (InvalidOperation, TypeError):
                continue
            expected = cad(amount * rate)
            if declared and expected and abs(declared - expected) > (expected * rate_tolerance):
                add(
                    "L4-CAD-MISMATCH",
                    f"{base}.completingActions[{s_index}].details.canadianEquivalentAmount",
                    (
                        f"Declared CAD equivalent {declared} does not reconcile with "
                        f"{amount} x {rate} = {expected}."
                    ),
                )

            start_asset = s_details.get("virtualCurrencyTypeCode")
            end_asset = c_details.get("virtualCurrencyTypeCode")
            if start_asset and end_asset and start_asset != end_asset:
                add(
                    "L4-ASSET-MISMATCH",
                    f"{base}.completingActions[{s_index}]",
                    f"Starting action is in {start_asset} but the completing action is in {end_asset}. "
                    "If this is a conversion, record it as a separate disposition.",
                    severity=WARNING,
                )

    details = payload.get("details", {})
    window_start = details.get("twentyFourHourStartDateTime")
    window_end = details.get("twentyFourHourEndDateTime")
    if window_start and window_end:
        for t_index, txn in enumerate(payload.get("transactions", [])):
            when = txn.get("details", {}).get("transactionDateTime")
            if when and not (window_start <= when <= window_end):
                add(
                    "L4-OUTSIDE-WINDOW",
                    f"transactions[{t_index}].details.transactionDateTime",
                    f"Transaction at {when} falls outside the declared 24-hour window "
                    f"{window_start} - {window_end}.",
                )
    return issues


# ---------------------------------------------------------------------------
# Level 5 - submission response
# ---------------------------------------------------------------------------


def validate_level5(response: dict) -> list[Issue]:
    """Turn an endpoint's verdict into the same issue vocabulary as levels 1-4."""
    issues: list[Issue] = []
    status = str(response.get("status", "")).lower()
    if status == "accepted":
        return issues
    if not status:
        issues.append(
            Issue(level=5, severity=ERROR, code="L5-NO-STATUS", path="(response)", message="Response carried no status.")
        )
        return issues
    for message in response.get("validation_messages", []) or []:
        issues.append(
            Issue(
                level=5,
                severity=ERROR if status == "rejected" else WARNING,
                code=message.get("code", "L5-REMOTE"),
                path=message.get("field", "(response)"),
                message=message.get("message", ""),
            )
        )
    if status == "rejected" and not issues:
        issues.append(
            Issue(
                level=5,
                severity=ERROR,
                code="L5-REJECTED",
                path="(response)",
                message="The endpoint rejected the report without itemising a reason.",
            )
        )
    return issues


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def validate(payload: dict, *, levels: tuple[int, ...] = (1, 2, 3, 4)) -> ValidationResult:
    result = ValidationResult()
    runners = {1: validate_level1, 2: validate_level2, 3: validate_level3, 4: validate_level4}
    for level in levels:
        runner = runners.get(level)
        if runner is None:
            continue
        result.issues.extend(runner(payload))
        result.levels_run.append(level)
    return result
