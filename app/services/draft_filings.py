"""FINTRAC-like draft documents for the investigator workspace.

Field names follow the shape a reporting entity would recognise — reporting
entity number, activity sector, a narrative, the transactions that are the
evidence. The codes are Sentinel mnemonics. This is not a FINTRAC schema, not
a submission, and not a determination that a report must be filed.
"""

from __future__ import annotations

from ..config import settings

DISCLAIMER = (
    "Synthetic draft for investigator review. Field names are FINTRAC-like. "
    "This document is not a FINTRAC schema, has not been submitted, and is not "
    "a determination that money laundering, terrorist financing, or a reporting "
    "obligation has been established."
)


def _entity() -> dict:
    entity = settings.entity
    return {
        "reportingEntityNumber": entity.reporting_entity_number,
        "reportingEntityContactId": entity.contact_number,
        "activitySectorCode": entity.activity_sector_code,
        "reportingEntityLocationReference": entity.location_reference,
        "legalName": entity.legal_name,
    }


def _transaction(txn: dict) -> dict:
    context = txn.get("context") or {}
    return {
        "transactionReference": txn.get("transaction_id"),
        "dateTimeOfTransaction": txn.get("occurred_at"),
        "direction": txn.get("direction"),
        "instrument": txn.get("instrument"),
        "amount": txn.get("asset_amount"),
        "currencyCode": txn.get("asset"),
        "cadEquivalent": txn.get("cad_value"),
        "exchangeRate": txn.get("exchange_rate"),
        "methodCode": context.get("method_code"),
        "purpose": context.get("purpose"),
        "conductorName": txn.get("customer_name"),
    }


def _lookup(transactions: list[dict]) -> dict[int, dict]:
    return {int(txn["id"]): txn for txn in transactions}


def _evidence(alert: dict, by_id: dict[int, dict]) -> list[dict]:
    return [_transaction(by_id[txn_id]) for txn_id in alert.get("evidence_txn_ids") or [] if txn_id in by_id]


def _subject(customer: dict | None) -> dict:
    if customer is None:
        return {}
    profile = customer.get("profile") or {}
    return {
        "customerReference": customer.get("customer_id"),
        "name": customer.get("name"),
        "typeCode": customer.get("customer_type"),
        "countryCode": customer.get("country"),
        "provinceCode": profile.get("province"),
        "city": profile.get("city"),
        "occupationOrBusiness": customer.get("occupation_or_business"),
    }


def str_document(*, report: dict, customer: dict | None, transactions: list[dict], alerts: list[dict]) -> dict:
    by_id = _lookup(transactions)
    evidence_ids: list[int] = []
    for alert in alerts:
        evidence_ids.extend(alert.get("evidence_txn_ids") or [])
    ordered = []
    seen = set()
    for txn_id in evidence_ids:
        if txn_id in seen or txn_id not in by_id:
            continue
        seen.add(txn_id)
        ordered.append(_transaction(by_id[txn_id]))
    pep = any(alert.get("rule_id") == "AML-SC-002" for alert in alerts)
    return {
        "schema": "sentinel-draft-1",
        "reportType": "STR",
        "disclaimer": DISCLAIMER,
        "reportDetails": {
            **_entity(),
            "reportTypeCode": "STR",
            "submitTypeCode": "DRAFT",
            "reportingEntityReportReference": f"NDA-STR-{report.get('reference')}",
        },
        "detailsOfSuspicion": {
            "descriptionOfSuspiciousActivity": report.get("narrative") or "",
            "politicallyExposedPersonIncludedIndicator": pep,
            "actionTakenDescription": "Draft only. No report has been submitted. A person still has to decide.",
        },
        "subject": _subject(customer),
        "indicators": [
            {
                "ruleId": alert.get("rule_id"),
                "ruleVersion": alert.get("rule_version"),
                "severity": alert.get("severity"),
                "detail": (alert.get("explanation") or {}).get("detail"),
            }
            for alert in alerts
            if alert.get("severity") != "reporting"
        ],
        "transactions": ordered[:24],
        "verification": report.get("verification"),
        "missingInformation": report.get("missing_information") or [],
    }


def threshold_document(*, kind: str, alert: dict, customer: dict | None, transactions: list[dict]) -> dict:
    by_id = _lookup(transactions)
    observed = (alert.get("explanation") or {}).get("observed") or {}
    reference = f"NDA-{kind}-{alert.get('id')}"
    body = {
        "schema": "sentinel-draft-1",
        "reportType": kind,
        "disclaimer": DISCLAIMER,
        "reportDetails": {
            **_entity(),
            "reportTypeCode": kind,
            "submitTypeCode": "DRAFT",
            "reportingEntityReportReference": reference,
        },
        "subject": _subject(customer),
        "thresholdObservation": {
            "ruleId": alert.get("rule_id"),
            "ruleVersion": alert.get("rule_version"),
            "detail": (alert.get("explanation") or {}).get("detail"),
            "observed": observed,
            "threshold": (alert.get("explanation") or {}).get("threshold") or {},
        },
        "transactions": _evidence(alert, by_id),
    }
    if kind == "TPR":
        body["detailsOfProperty"] = {
            "sampleListEntry": observed.get("entry_id"),
            "matchedName": observed.get("canonical_name"),
            "queryName": observed.get("query_name"),
            "score": observed.get("score"),
            "note": (
                "Property observed on the evidence transactions would be what a Terrorist "
                "Property Report describes. This entry is from the fictional sample list."
            ),
        }
    return body


def build_filings(
    *,
    reports: list[dict],
    alerts: list[dict],
    customers: list[dict],
    transactions: list[dict],
) -> list[dict]:
    customers_by_id = {customer["id"]: customer for customer in customers}
    alerts_by_customer: dict[int, list[dict]] = {}
    for alert in alerts:
        alerts_by_customer.setdefault(alert["customer_id"], []).append(alert)

    filings: list[dict] = []
    for report in reports:
        customer = customers_by_id.get(report["customer_id"])
        related = alerts_by_customer.get(report["customer_id"], [])
        document = str_document(report=report, customer=customer, transactions=transactions, alerts=related)
        reference = report.get("reference") or report.get("case_id")
        filings.append(
            {
                "id": f"str-{report['case_id']}",
                "kind": "STR",
                "title": f"STR draft {reference}",
                "customer_id": report.get("customer_id"),
                "customer_name": report.get("customer_name"),
                "case_id": report.get("case_id"),
                "filename": f"STR-{reference}.json",
                "document": document,
            }
        )

    caps = {"LCTR": 0, "EFTR": 0}
    for alert in alerts:
        rule_id = alert.get("rule_id")
        if rule_id == "AML-FI-001":
            kind = "LCTR"
        elif rule_id == "AML-FI-002":
            kind = "EFTR"
        elif rule_id == "AML-TF-001":
            kind = "TPR"
        else:
            continue
        if kind in caps:
            if caps[kind] >= 8:
                continue
            caps[kind] += 1
        customer = customers_by_id.get(alert["customer_id"])
        document = threshold_document(kind=kind, alert=alert, customer=customer, transactions=transactions)
        filings.append(
            {
                "id": f"{kind.lower()}-{alert['id']}",
                "kind": kind,
                "title": f"{kind} draft · {alert.get('customer_name') or alert.get('title')}",
                "customer_id": alert.get("customer_id"),
                "customer_name": alert.get("customer_name"),
                "case_id": alert.get("case_id"),
                "filename": f"{kind}-{alert['id']}.json",
                "document": document,
            }
        )
    return filings
