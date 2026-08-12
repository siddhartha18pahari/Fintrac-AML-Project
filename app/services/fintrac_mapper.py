"""Canonical report model -> FINTRAC LVCTR JSON-LD.

The database is deliberately *not* bound to FINTRAC's external schema.  Cases,
transactions and subjects are stored in the system's own canonical shape, and
this module is the only place that knows what the regulator's payload looks
like.  When the schema changes, one mapper changes; historical cases stay
reproducible because the report row keeps both the canonical body and the
rendered payload it produced.

Field names, nesting, code lists and the length/type constraints below were
reconciled against the reference implementation at
https://github.com/8KSS/FINTRAC-LVCTR (``LVCTR_FORM2.HTML``), which encodes the
2021 F2R upload format.  See docs/FINTRAC_MAPPING.md and
docs/LEGACY_REPO_ANALYSIS.md.

WARNING: the 2021 context URI is what the reference implementation targets.  A
reporting entity must reconcile every field against FINTRAC's *current*
technical documentation before submitting anything anywhere real.  This project
only ever submits to its own mock endpoint.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..config import settings
from ..util import iso_local_naive, token_amount

SCHEMA_ID = "http://json-schema.org/draft-07/schema#"
CONTEXT_2021 = "http://fintrac-canafe.gc.ca/reporting/api/lvctr/2021"
SCHEMA_VERSION = "lvctr-2021"


# ---------------------------------------------------------------------------
# Code lists (from the reference implementation's select options)
# ---------------------------------------------------------------------------

ACTIVITY_SECTOR = {
    "1": "Accountant",
    "2": "Bank",
    "3": "Caisse populaire",
    "4": "Crown agent",
    "5": "Casino",
    "6": "Co-op credit society",
    "9": "Life insurance broker or agent",
    "10": "Life insurance company",
    "11": "Money services business",
    "12": "Provincial savings office",
    "13": "Real estate",
    "14": "Credit union",
    "15": "Securities dealer",
    "16": "Trust and/or loan company",
    "17": "British Columbia notary",
    "18": "Dealer in precious metals and stones",
    "19": "Credit union central",
    "20": "Financial services cooperative",
    "21": "Foreign money services business",
}

TWENTY_FOUR_HOUR_AGGREGATION = {
    "1": "Beneficiary",
    "2": "Conductor",
    "3": "On behalf of (third party)",
    "4": "Not applicable",
}

TRANSACTION_METHOD = {"1": "In person", "7": "Other", "8": "Online", "9": "Virtual currency ATM"}

DISPOSITION = {
    "1": "Deposit to an account",
    "3": "Conducted currency exchange",
    "4": "Purchase of casino chips",
    "5": "Purchase of bank draft",
    "6": "Purchase of money order",
    "7": "Life insurance policy purchase/deposit",
    "8": "Securities purchase/deposit",
    "9": "Real estate purchase/deposit",
    "10": "Cash out",
    "11": "Other",
    "14": "Purchase jewellery",
    "15": "Purchase precious metals",
    "17": "Added to virtual currency wallet",
    "18": "Exchange to virtual currency",
    "19": "Outgoing virtual currency transfer",
    "20": "Outgoing email money transfer",
    "21": "Holding funds",
    "22": "Purchase of precious stones",
    "23": "Issued cheque",
    "24": "Outgoing domestic funds transfer",
    "25": "Outgoing international funds transfer",
    "26": "Purchase of prepaid payment product/card",
}

ACCOUNT_TYPE = {"1": "Personal", "2": "Business", "3": "Trust", "4": "Other", "5": "Casino"}

DEVICE_TYPE = {"1": "Computer/Laptop", "2": "Mobile phone", "3": "Tablet", "4": "Other"}

RELATIONSHIP_TYPE = {
    "1": "Accountant",
    "2": "Agent",
    "3": "Borrower",
    "4": "Broker",
    "5": "Customer",
    "6": "Employee",
    "7": "Friend",
    "8": "Relative",
    "9": "Other",
    "10": "Legal counsel",
    "11": "Employer",
    "12": "Joint/Secondary owner",
    "13": "Power of attorney",
}

IDENTIFICATION_TYPE = {
    "1": "Birth certificate",
    "2": "Passport",
    "3": "Other",
    "4": "Driver's licence",
    "5": "Provincial health card",
    "14": "Citizenship card",
    "15": "Indian status card",
    "32": "Permanent resident card",
    "33": "Record of landing",
    "34": "Credit file",
    "35": "Government issued identification",
    "36": "Insurance documents",
    "37": "Provincial or territorial identity card",
    "38": "Record of employment",
    "39": "Travel visa",
    "40": "Utility statement",
}

#: Codes whose "Other" free-text sibling becomes mandatory.
OTHER_CODE_PAIRS = {
    "transactionMethodTypeCode": ("7", "transactionMethodTypeOther"),
    "dispositionTypeCode": ("11", "dispositionTypeOther"),
    "accountTypeCode": ("4", "accountTypeOther"),
    "deviceTypeCode": ("4", "deviceTypeOther"),
    "relationshipTypeCode": ("9", "relationshipTypeOther"),
    "identificationTypeCode": ("3", "identificationTypeOther"),
}


# ---------------------------------------------------------------------------
# Field constraints (mirrors MyValidation() in the reference implementation)
# ---------------------------------------------------------------------------

MAX_LENGTHS: dict[str, int] = {}
for _length, _fields in {
    10: ["telephoneExtension", "ministerialDirectiveCode", "unitNumber", "buildingNumber"],
    20: ["telephoneNumber", "postalCode", "transactionReference", "locationReference"],
    32: ["$id", "$ref"],
    50: [
        "registrationNumber",
        "identificationNumber",
        "financialInstitutionNumber",
        "branchNumber",
        "accountNumber",
        "policyNumber",
        "identifyingNumber",
        "clientNumber",
    ],
    100: [
        "registrationJurisdictionProvinceOther",
        "legalName",
        "employerName",
        "alias",
        "surname",
        "other",
        "givenName",
        "locality",
        "provinceOther",
        "district",
        "city",
        "streetAddress",
        "identificationJurisdictionProvinceOther",
        "accountVirtualCurrencyTypeCode",
        "virtualCurrencyTypeCode",
    ],
    200: [
        "businessNature",
        "occupation",
        "residenceCountryCode",
        "identificationTypeOther",
        "relationshipTypeOther",
        "deviceTypeOther",
        "deviceIpAddress",
        "deviceIdentificationNumber",
        "email",
        "username",
        "obtained",
        "referenceNumber",
        "otherRelatedNumber",
        "accountTypeOther",
        "accountVirtualCurrencyTypeOther",
        "dispositionTypeOther",
        "virtualCurrencyTypeOther",
        "transactionMethodTypeOther",
        "transactionPurpose",
        "reportReference",
    ],
    500: ["unstructuredAddressDetails"],
}.items():
    for _field in _fields:
        MAX_LENGTHS[_field] = _length

ALPHA2_FIELDS = {
    "registrationJurisdictionCountryCode",
    "registrationJurisdictionProvinceCode",
    "unstructuredCountryCode",
    "provinceCode",
    "countryCode",
    "identificationJurisdictionCountryCode",
    "identificationJurisdictionProvinceCode",
}
ALPHA3_FIELDS = {"currencyTypeCode", "accountCurrencyTypeCode"}
INT_CODE_FIELDS = {
    "identificationTypeCode",
    "relationshipTypeCode",
    "deviceTypeCode",
    "twentyFourHourAggregationTypeCode",
    "activitySectorCode",
    "accountTypeCode",
    "dispositionTypeCode",
    "transactionMethodTypeCode",
}
AMOUNT_FIELDS = {"canadianEquivalentAmount", "virtualCurrencyAmount", "canadianExchangeRate"}
LOCAL_DATE_FIELDS = {"birthDate", "accountOpenDate"}
DATETIME_FIELDS = {"requestDateTime", "twentyFourHourStartDateTime", "twentyFourHourEndDateTime", "transactionDateTime"}
BOOLEAN_FIELDS = {
    "registrationIndicator",
    "onBehalfOfIndicator",
    "conductorIndicator",
    "sourceOfVirtualCurrencyIndicator",
    "involvementIndicator",
    "beneficiaryIndicator",
    "thresholdIndicator",
    "clientIndicator",
}

CODE_LISTS: dict[str, dict[str, str]] = {
    "activitySectorCode": ACTIVITY_SECTOR,
    "twentyFourHourAggregationTypeCode": TWENTY_FOUR_HOUR_AGGREGATION,
    "transactionMethodTypeCode": TRANSACTION_METHOD,
    "dispositionTypeCode": DISPOSITION,
    "accountTypeCode": ACCOUNT_TYPE,
    "deviceTypeCode": DEVICE_TYPE,
    "relationshipTypeCode": RELATIONSHIP_TYPE,
    "identificationTypeCode": IDENTIFICATION_TYPE,
}


# ---------------------------------------------------------------------------
# Mapping
# ---------------------------------------------------------------------------


def _amount(value) -> str:
    """FINTRAC amounts are decimal strings, not floats.

    Emitting a float here is how ``0.1 + 0.2`` ends up in a regulatory filing.
    ``token_amount`` also strips the column-scale padding that would otherwise
    report 0.03 BTC as ``0.030000000000000000``.
    """
    return token_amount(value)


def _prune(node: Any) -> Any:
    """Drop empty optional fields, keeping ``False`` and ``0``."""
    if isinstance(node, dict):
        out = {}
        for key, value in node.items():
            cleaned = _prune(value)
            if cleaned in (None, "", [], {}):
                continue
            out[key] = cleaned
        return out
    if isinstance(node, list):
        return [_prune(v) for v in node if _prune(v) not in (None, "", [], {})]
    return node


def _person_definition(subject: dict) -> dict:
    details = {
        "$id": subject["ref"],
        "@type": "LvctrPersonDetails",
        "surname": subject.get("surname"),
        "givenName": subject.get("given_name"),
        "other": subject.get("other_name"),
        "alias": subject.get("alias"),
        "birthDate": subject.get("birth_date"),
        "occupation": subject.get("occupation"),
        "employerName": subject.get("employer_name"),
        "telephoneNumber": subject.get("telephone"),
        "residenceCountryCode": subject.get("country"),
    }
    address = subject.get("address") or {}
    if address:
        details["address"] = {"LvctrStructuredAddress": _structured_address(address)}
    identifications = subject.get("identifications") or []
    if identifications:
        details["LvctrPersonIdentificationDetails"] = [_identification(i) for i in identifications]
    return {"LvctrPersonDetails": details}


def _entity_definition(subject: dict) -> dict:
    details = {
        "$id": subject["ref"],
        "@type": "LvctrEntityDetails",
        "legalName": subject.get("legal_name") or subject.get("name"),
        "businessNature": subject.get("business_nature"),
        "telephoneNumber": subject.get("telephone"),
        "registrationIndicator": subject.get("registration_indicator", False),
        "registrationNumber": subject.get("registration_number"),
        "registrationJurisdictionCountryCode": subject.get("registration_country"),
        "registrationJurisdictionProvinceCode": subject.get("registration_province"),
    }
    address = subject.get("address") or {}
    if address:
        details["address"] = {"LvctrStructuredAddress": _structured_address(address)}
    identifications = subject.get("identifications") or []
    if identifications:
        details["LvctrEntityIdentificationDetails"] = [_identification(i) for i in identifications]
    authorized = subject.get("authorized_persons") or []
    if authorized:
        details["authorizedPersons"] = [
            {
                "@type": "LvctrPersonName",
                "surname": p.get("surname"),
                "givenName": p.get("given_name"),
                "other": p.get("other_name"),
            }
            for p in authorized
        ]
    return {"LvctrEntityDetails": details}


def _structured_address(address: dict) -> dict:
    return {
        "@type": "LvctrStructuredAddress",
        "unitNumber": address.get("unit"),
        "buildingNumber": address.get("building"),
        "streetAddress": address.get("street"),
        "city": address.get("city"),
        "provinceCode": address.get("province"),
        "postalCode": address.get("postal_code"),
        "countryCode": address.get("country"),
        "district": address.get("district"),
        "locality": address.get("locality"),
    }


def _identification(identification: dict) -> dict:
    node = {
        "@type": identification.get("node_type", "LvctrPersonIdentificationDetails"),
        "identificationTypeCode": identification.get("type_code"),
        "identificationNumber": identification.get("number"),
        "identificationJurisdictionCountryCode": identification.get("country"),
        "identificationJurisdictionProvinceCode": identification.get("province"),
    }
    if identification.get("type_code") == "3":
        node["identificationTypeOther"] = identification.get("type_other")
    return node


def _conductor(action: dict, subject_ref: str) -> dict:
    details = {
        "@type": "LvctrConductingDetails",
        "clientIndicator": action.get("client_indicator", True),
        "clientNumber": action.get("client_number"),
        "username": action.get("username"),
        "email": action.get("email"),
        "requestDateTime": action.get("request_datetime"),
        "onBehalfOfIndicator": bool(action.get("on_behalf_of")),
        "deviceTypeCode": action.get("device_type_code"),
        "deviceIdentificationNumber": action.get("device_id"),
        "deviceIpAddress": action.get("device_ip"),
    }
    if action.get("device_type_code") == "4":
        details["deviceTypeOther"] = action.get("device_type_other")

    node = {
        "@type": "LvctrConductor",
        "subject": {"$ref": subject_ref},
        "details": details,
    }
    on_behalf = action.get("on_behalf_of") or []
    if on_behalf:
        node["onBehalfOfs"] = [
            {
                "@type": "LvctrOnBehalfOf",
                "subject": {"$ref": p["ref"]},
                "details": _prune(
                    {
                        "@type": "LvctrOnBehalfOfDetails",
                        "clientNumber": p.get("client_number"),
                        "email": p.get("email"),
                        "relationshipTypeCode": p.get("relationship_type_code"),
                        "relationshipTypeOther": p.get("relationship_type_other")
                        if p.get("relationship_type_code") == "9"
                        else None,
                    }
                ),
            }
            for p in on_behalf
        ]
    return node


def _starting_action(action: dict) -> dict:
    details = {
        "@type": "LvctrStartingActionDetails",
        "virtualCurrencyTypeCode": action.get("asset"),
        "virtualCurrencyAmount": _amount(action["asset_amount"]),
        "canadianExchangeRate": _amount(action["exchange_rate"]),
        "conductorIndicator": action.get("conductor_indicator", True),
        "sourceOfVirtualCurrencyIndicator": bool(action.get("sources")),
        "sendingVirtualCurrencyAddresses": list(action.get("sending_addresses") or []),
        "obtained": action.get("obtained"),
    }
    node: dict[str, Any] = {"@type": "LvctrStartingAction", "details": details}
    if action.get("conductor_ref"):
        node["conductors"] = [_conductor(action, action["conductor_ref"])]
    sources = action.get("sources") or []
    if sources:
        node["sourcesOfVirtualCurrency"] = [
            {
                "@type": "LvctrSourceOfVirtualCurrency",
                "name": {"$ref": s["ref"]},
                "details": _prune(
                    {
                        "@type": "LvctrSourceOfVirtualCurrencyDetails",
                        "accountNumber": s.get("account_number"),
                        "identifyingNumber": s.get("identifying_number"),
                        "policyNumber": s.get("policy_number"),
                    }
                ),
            }
            for s in sources
        ]
    return node


def _completing_action(action: dict) -> dict:
    details = {
        "@type": "LvctrCompletingActionDetails",
        "dispositionTypeCode": action.get("disposition_type_code", "17"),
        "virtualCurrencyTypeCode": action.get("asset"),
        "virtualCurrencyAmount": _amount(action["asset_amount"]),
        "canadianEquivalentAmount": _amount(action["cad_value"]),
        "currencyTypeCode": action.get("currency_type_code", "CAD"),
        "receivingVirtualCurrencyAddresses": list(action.get("receiving_addresses") or []),
        "beneficiaryIndicator": bool(action.get("beneficiary")),
        "involvementIndicator": bool(action.get("involvements")),
        "accountNumber": action.get("account_number"),
        "accountTypeCode": action.get("account_type_code"),
        "accountCurrencyTypeCode": action.get("account_currency_type_code"),
        "accountVirtualCurrencyTypeCode": action.get("account_asset"),
        "accountOpenDate": action.get("account_open_date"),
        "referenceNumber": action.get("reference_number"),
    }
    if action.get("disposition_type_code") == "11":
        details["dispositionTypeOther"] = action.get("disposition_type_other")
    if action.get("account_type_code") == "4":
        details["accountTypeOther"] = action.get("account_type_other")

    node: dict[str, Any] = {"@type": "LvctrCompletingAction", "details": details}
    beneficiary = action.get("beneficiary")
    if beneficiary:
        node["beneficiaries"] = [
            {
                "@type": "LvctrBeneficiary",
                "subject": {"$ref": beneficiary["ref"]},
                "details": _prune(
                    {
                        "@type": "LvctrBenefitingDetails",
                        "clientNumber": beneficiary.get("client_number"),
                        "email": beneficiary.get("email"),
                        "username": beneficiary.get("username"),
                    }
                ),
            }
        ]
    involvements = action.get("involvements") or []
    if involvements:
        node["involvements"] = [
            {
                "@type": "LvctrInvolvement",
                "name": {"$ref": i["ref"]},
                "details": _prune(
                    {
                        "@type": "LvctrInvolvementDetails",
                        "accountNumber": i.get("account_number"),
                        "identifyingNumber": i.get("identifying_number"),
                        "policyNumber": i.get("policy_number"),
                    }
                ),
            }
            for i in involvements
        ]
    account_holders = action.get("account_holders") or []
    if account_holders:
        node["accountHolders"] = [
            {
                "@type": "LvctrAccountHolder",
                "name": {"$ref": h["ref"]},
                "details": _prune({"@type": "LvctrAccountHolderDetails", "username": h.get("username")}),
            }
            for h in account_holders
        ]
    return node


def _transaction(txn: dict) -> dict:
    details = {
        "@type": "LvctrTransactionDetails",
        "transactionReference": txn["reference"],
        "transactionDateTime": txn["occurred_at"],
        "locationReference": txn.get("location_reference") or settings.entity.location_reference,
        "transactionMethodTypeCode": txn.get("method_code", "8"),
        "transactionPurpose": txn.get("purpose"),
        "thresholdIndicator": bool(txn.get("threshold_indicator", False)),
        "transactionIdentifiers": list(txn.get("identifiers") or []),
    }
    if txn.get("method_code") == "7":
        details["transactionMethodTypeOther"] = txn.get("method_other")
    return {
        "@type": "LvctrTransaction",
        "details": details,
        "startingActions": [_starting_action(a) for a in txn.get("starting_actions", [])],
        "completingActions": [_completing_action(a) for a in txn.get("completing_actions", [])],
    }


def to_fintrac_lvctr(canonical: dict) -> dict:
    """Render the canonical report body as the FINTRAC LVCTR JSON-LD payload."""
    entity = canonical.get("reporting_entity") or {}
    aggregation = canonical.get("aggregation") or {}

    report_details = {
        "@type": "LvctrFormDetails",
        "activitySectorCode": entity.get("activity_sector_code") or settings.entity.activity_sector_code,
        "contactNumber": entity.get("contact_number") or settings.entity.contact_number,
        "ministerialDirectiveCode": canonical.get("ministerial_directive_code"),
        "twentyFourHourAggregationTypeCode": aggregation.get("type_code", "4"),
        "twentyFourHourStartDateTime": aggregation.get("start"),
        "twentyFourHourEndDateTime": aggregation.get("end"),
    }

    definitions = []
    for subject in canonical.get("subjects", []):
        if subject.get("kind") == "entity":
            definitions.append(_entity_definition(subject))
        else:
            definitions.append(_person_definition(subject))

    payload = {
        "$schema": SCHEMA_ID,
        "@context": CONTEXT_2021,
        "@type": "LvctrForm",
        "reportingEntityNumber": entity.get("reporting_entity_number") or settings.entity.reporting_entity_number,
        "reportReference": canonical["report_reference"],
        "details": report_details,
        "definitions": definitions,
        "transactions": [_transaction(t) for t in canonical.get("transactions", [])],
    }
    return _prune(payload)


# ---------------------------------------------------------------------------
# Reverse index helpers used by the cross-reference validator
# ---------------------------------------------------------------------------


@dataclass
class ReferenceIndex:
    declared: dict[str, str]  # $id -> node type
    used: list[tuple[str, str]]  # ($ref, json path)


def index_references(payload: dict) -> ReferenceIndex:
    declared: dict[str, str] = {}
    used: list[tuple[str, str]] = []

    def walk(node: Any, path: str) -> None:
        if isinstance(node, dict):
            if "$id" in node:
                declared[node["$id"]] = node.get("@type", "")
            if "$ref" in node:
                used.append((node["$ref"], path))
            for key, value in node.items():
                walk(value, f"{path}.{key}" if path else key)
        elif isinstance(node, list):
            for index, value in enumerate(node):
                walk(value, f"{path}[{index}]")

    walk(payload, "")
    return ReferenceIndex(declared=declared, used=used)


def datetime_field(value) -> str | None:
    return iso_local_naive(value) if value is not None else None
