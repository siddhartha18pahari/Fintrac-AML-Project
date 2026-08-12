"""LVCTR mapping, the five validation levels, and the mock receiver."""

from __future__ import annotations

import copy
import json
from datetime import timedelta

import pytest

from app.models import ReportType
from app.services import fintrac_mapper as fm
from app.services import mock_fintrac, pipeline, report_builder, validation
from conftest import NOW, make_party, receipt


@pytest.fixture()
def built_report(session, customer, users):
    beneficiary = make_party(session, "ben_map")
    base = NOW.replace(hour=9)
    for index, amount in enumerate(["4000", "3500", "3000"]):
        receipt(session, customer, cad=amount, at=base + timedelta(hours=index), beneficiary=beneficiary)
    pipeline.run(session, with_anomaly=False)

    from sqlalchemy import select

    from app.models import Case

    case = session.execute(select(Case)).scalars().first()
    return report_builder.build_report(session, case, ReportType.LVCTR, actor=users["officer"])


# ---------------------------------------------------------------------------
# Mapping
# ---------------------------------------------------------------------------


def test_payload_matches_the_reference_json_ld_shape(built_report):
    payload = built_report.payload
    assert payload["@context"] == fm.CONTEXT_2021
    assert payload["@type"] == "LvctrForm"
    assert payload["details"]["@type"] == "LvctrFormDetails"
    assert payload["transactions"][0]["@type"] == "LvctrTransaction"
    assert payload["transactions"][0]["startingActions"][0]["@type"] == "LvctrStartingAction"
    assert payload["transactions"][0]["completingActions"][0]["@type"] == "LvctrCompletingAction"


def test_subjects_are_declared_once_and_referenced_by_id(built_report):
    index = fm.index_references(built_report.payload)
    assert index.declared, "no subjects were declared"
    for ref, _path in index.used:
        assert ref in index.declared, f"{ref} is referenced but never declared"


def test_amounts_are_decimal_strings_not_floats(built_report):
    action = built_report.payload["transactions"][0]["startingActions"][0]["details"]
    assert isinstance(action["virtualCurrencyAmount"], str)
    assert isinstance(action["canadianExchangeRate"], str)
    raw = json.dumps(built_report.payload)
    assert "e-" not in raw.lower(), "an amount was serialised in exponent notation"


def test_amounts_carry_no_storage_padding(built_report):
    action = built_report.payload["transactions"][0]["startingActions"][0]["details"]
    assert not action["virtualCurrencyAmount"].endswith("000000000")


def test_aggregation_type_code_is_carried_into_the_report(built_report):
    code = built_report.payload["details"]["twentyFourHourAggregationTypeCode"]
    assert code in {"1", "2", "3"}
    assert built_report.payload["details"]["twentyFourHourStartDateTime"]
    assert built_report.payload["details"]["twentyFourHourEndDateTime"]


def test_single_receipt_reports_threshold_indicator_not_aggregation(session, customer, users):
    receipt(session, customer, cad="18000", at=NOW)
    pipeline.run(session, with_anomaly=False)

    from sqlalchemy import select

    from app.models import Case

    case = session.execute(select(Case)).scalars().first()
    report = report_builder.build_report(session, case, ReportType.LVCTR, actor=users["officer"])
    assert report.payload["details"]["twentyFourHourAggregationTypeCode"] == "4"
    assert report.payload["transactions"][0]["details"]["thresholdIndicator"] is True


def test_transaction_reference_respects_the_20_character_limit(built_report):
    for txn in built_report.payload["transactions"]:
        assert len(txn["details"]["transactionReference"]) <= 20


def test_canonical_body_records_its_own_provenance(built_report):
    provenance = built_report.canonical["provenance"]
    assert provenance["case_reference"]
    assert provenance["aggregation_event_ids"]
    assert provenance["valuation_methodology"]
    assert provenance["all_groupings"], "the other groupings that fired must not be lost"


def test_a_freshly_built_report_validates_clean(built_report):
    assert built_report.validation["error_count"] == 0, built_report.validation["issues"]
    assert built_report.validation["levels_run"] == [1, 2, 3, 4]


# ---------------------------------------------------------------------------
# Validation levels
# ---------------------------------------------------------------------------


def test_level1_rejects_a_float_amount(built_report):
    payload = copy.deepcopy(built_report.payload)
    payload["transactions"][0]["startingActions"][0]["details"]["virtualCurrencyAmount"] = 0.5
    issues = validation.validate_level1(payload)
    assert any(i.code == "L1-AMOUNT" for i in issues)


def test_level1_rejects_an_unknown_code(built_report):
    payload = copy.deepcopy(built_report.payload)
    payload["details"]["activitySectorCode"] = "99"
    issues = validation.validate_level1(payload)
    assert any(i.code == "L1-CODELIST" for i in issues)


def test_level1_rejects_a_malformed_datetime(built_report):
    payload = copy.deepcopy(built_report.payload)
    payload["transactions"][0]["details"]["transactionDateTime"] = "10/08/2026"
    assert any(i.code == "L1-DATETIME" for i in validation.validate_level1(payload))


def test_level1_enforces_field_length_limits(built_report):
    payload = copy.deepcopy(built_report.payload)
    payload["transactions"][0]["details"]["transactionReference"] = "T" * 40
    assert any(i.code == "L1-LENGTH" for i in validation.validate_level1(payload))


def test_level2_requires_other_text_when_a_code_is_other(built_report):
    payload = copy.deepcopy(built_report.payload)
    payload["transactions"][0]["details"]["transactionMethodTypeCode"] = "7"
    assert any(i.code == "L2-OTHER-REQUIRED" for i in validation.validate_level2(payload))


def test_level2_requires_a_conductor_when_the_indicator_is_set(built_report):
    payload = copy.deepcopy(built_report.payload)
    payload["transactions"][0]["startingActions"][0].pop("conductors", None)
    assert any(i.code == "L2-CONDUCTOR-REQUIRED" for i in validation.validate_level2(payload))


def test_level2_requires_a_beneficiary_when_the_indicator_is_set(built_report):
    payload = copy.deepcopy(built_report.payload)
    action = payload["transactions"][0]["completingActions"][0]
    action["details"]["beneficiaryIndicator"] = True
    action.pop("beneficiaries", None)
    assert any(i.code == "L2-BENEFICIARY-REQUIRED" for i in validation.validate_level2(payload))


def test_level2_requires_a_window_when_aggregation_is_declared(built_report):
    payload = copy.deepcopy(built_report.payload)
    payload["details"].pop("twentyFourHourEndDateTime", None)
    assert any(i.code == "L2-24H-WINDOW" for i in validation.validate_level2(payload))


def test_level3_enforces_the_schema(built_report):
    payload = copy.deepcopy(built_report.payload)
    payload["transactions"][0]["details"].pop("locationReference")
    assert any(i.code == "L3-SCHEMA" for i in validation.validate_level3(payload))


def test_level4_catches_a_dangling_subject_reference(built_report):
    payload = copy.deepcopy(built_report.payload)
    payload["transactions"][0]["startingActions"][0]["conductors"][0]["subject"]["$ref"] = "NOPE"
    issues = validation.validate_level4(payload)
    assert any(i.code == "L4-DANGLING-REF" for i in issues)


def test_level4_catches_a_cad_reconciliation_failure(built_report):
    payload = copy.deepcopy(built_report.payload)
    payload["transactions"][0]["completingActions"][0]["details"]["canadianEquivalentAmount"] = "999999.00"
    assert any(i.code == "L4-CAD-MISMATCH" for i in validation.validate_level4(payload))


def test_level4_catches_a_transaction_outside_the_declared_window(built_report):
    payload = copy.deepcopy(built_report.payload)
    payload["transactions"][0]["details"]["transactionDateTime"] = "2020-01-01T00:00:00"
    assert any(i.code == "L4-OUTSIDE-WINDOW" for i in validation.validate_level4(payload))


def test_readiness_reflects_severity(built_report):
    clean = validation.validate(built_report.payload)
    assert clean.readiness == 100 and clean.valid

    broken = copy.deepcopy(built_report.payload)
    broken["details"]["activitySectorCode"] = "99"
    result = validation.validate(broken)
    assert result.readiness < 100 and not result.valid


def test_level5_translates_a_rejection_into_issues():
    response = {
        "status": "rejected",
        "validation_messages": [
            {"field": "transactions[0].beneficiary", "code": "VAL-107", "message": "Beneficiary reference does not exist."}
        ],
    }
    issues = validation.validate_level5(response)
    assert len(issues) == 1 and issues[0].code == "VAL-107" and issues[0].severity == validation.ERROR
    assert validation.validate_level5({"status": "accepted", "validation_messages": []}) == []


# ---------------------------------------------------------------------------
# Mock receiver
# ---------------------------------------------------------------------------


def test_receiver_accepts_a_well_formed_report(built_report):
    response = mock_fintrac.receive(built_report.payload, "LVCTR")
    assert response.status == "accepted"
    assert response.submission_id.startswith("MOCK-")
    assert "SIMULATED" in response.as_dict()["notice"]


def test_receiver_is_deterministic(built_report):
    a = mock_fintrac.receive(built_report.payload, "LVCTR")
    b = mock_fintrac.receive(built_report.payload, "LVCTR")
    assert a.status == b.status and a.submission_id == b.submission_id


def test_receiver_itemises_its_rejections(built_report):
    payload = copy.deepcopy(built_report.payload)
    payload["transactions"][0]["startingActions"][0]["details"]["sendingVirtualCurrencyAddresses"] = []
    payload["transactions"][0]["startingActions"][0]["conductors"][0]["subject"]["$ref"] = "MISSING"
    response = mock_fintrac.receive(payload, "LVCTR")
    assert response.status == "rejected"
    codes = {m["code"] for m in response.validation_messages}
    assert "VAL-112" in codes and "VAL-107" in codes
    assert all(m["field"] and m["message"] for m in response.validation_messages)


def test_receiver_rejects_a_duplicate_report_reference(built_report):
    reference = built_report.payload["reportReference"]
    response = mock_fintrac.receive(built_report.payload, "LVCTR", known_references={reference})
    assert response.status == "rejected"
    assert any(m["code"] == "VAL-103" for m in response.validation_messages)


def test_settings_are_immutable_at_runtime():
    """Configuration cannot be mutated in place; changing it means a restart."""
    import dataclasses

    from app.config import settings

    with pytest.raises(dataclasses.FrozenInstanceError):
        settings.lvctr_threshold_cad = 1  # type: ignore[misc]


def test_submission_endpoint_is_hard_guarded(session, built_report, users, monkeypatch):
    """Pointing this system at anything but its own mock receiver is refused."""
    import dataclasses

    from app.config import settings

    monkeypatch.setattr(
        mock_fintrac,
        "settings",
        dataclasses.replace(settings, submission_endpoint="https://example.invalid/reports"),
    )
    with pytest.raises(mock_fintrac.SubmissionBlocked, match="only ever submits to its own mock"):
        mock_fintrac.submit(session, built_report, users["approver"])
