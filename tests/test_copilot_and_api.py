"""STR copilot grounding, graph analytics, and an end-to-end API walkthrough."""

from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import graph_engine, pipeline, str_copilot
from conftest import NOW, make_customer, make_party, receipt


@pytest.fixture()
def case_with_activity(session, customer, users):
    beneficiary = make_party(session, "ben_copilot")
    base = NOW.replace(hour=9)
    for index, amount in enumerate(["3200", "2400", "3100", "2500", "4600"]):
        receipt(session, customer, cad=amount, at=base + timedelta(hours=index), beneficiary=beneficiary)
    receipt(session, customer, cad="9000", at=base + timedelta(hours=5), direction="outgoing")
    pipeline.run(session, with_anomaly=False)
    session.commit()

    from sqlalchemy import select

    from app.models import Case

    return session.execute(select(Case)).scalars().first()


# ---------------------------------------------------------------------------
# STR copilot
# ---------------------------------------------------------------------------


def test_draft_is_grounded_and_verifies(session, case_with_activity):
    draft, verification = str_copilot.draft_for_case(session, case_with_activity)
    assert draft.text
    assert verification.supported, verification.unsupported_claims
    assert not verification.prohibited_language


def test_draft_is_deterministic(session, case_with_activity):
    first, _ = str_copilot.draft_for_case(session, case_with_activity)
    second, _ = str_copilot.draft_for_case(session, case_with_activity)
    assert first.text == second.text


def test_every_sentence_cites_evidence(session, case_with_activity):
    draft, verification = str_copilot.draft_for_case(session, case_with_activity)
    assert draft.sentences
    assert not verification.uncited_sentences, verification.uncited_sentences


def test_draft_covers_the_required_sections(session, case_with_activity):
    draft, _ = str_copilot.draft_for_case(session, case_with_activity)
    for section in ("WHO", "WHAT", "HOW FUNDS MOVED", "WHY SUSPICIOUS"):
        assert section in draft.text


def test_verifier_rejects_an_invented_figure(session, case_with_activity):
    """A generator that hallucinates a number must fail verification."""
    facts = str_copilot.collect_facts(session, case_with_activity)
    draft = str_copilot.Draft(
        sentences=[str_copilot.Sentence("The customer received CAD 987,654.32 from 44 wallets.", ["x"])],
        facts=facts,
    )
    result = str_copilot.verify(draft)
    assert not result.supported
    assert any(claim["value"] in {"987,654.32", "44"} for claim in result.unsupported_claims)


def test_verifier_rejects_an_assertion_of_criminality(session, case_with_activity):
    facts = str_copilot.collect_facts(session, case_with_activity)
    for text in [
        "The customer laundered the funds through several wallets.",
        "The money is proceeds of crime.",
        "The subject committed fraud.",
    ]:
        draft = str_copilot.Draft(sentences=[str_copilot.Sentence(text, ["x"])], facts=facts)
        result = str_copilot.verify(draft)
        assert not result.supported, text
        assert result.prohibited_language


def test_draft_reports_what_is_missing(session, case_with_activity):
    draft, _ = str_copilot.draft_for_case(session, case_with_activity)
    assert any("rationale" in item for item in draft.missing), draft.missing


def test_a_reporting_threshold_is_not_offered_as_an_indicator_of_suspicion(session, case_with_activity):
    draft, _ = str_copilot.draft_for_case(session, case_with_activity)
    suspicion = draft.text.split("WHY SUSPICIOUS")[-1]
    assert "AML-VC-012" not in suspicion, "a threshold obligation is not evidence of suspicion"


# ---------------------------------------------------------------------------
# Graph analytics
# ---------------------------------------------------------------------------


def test_fan_in_counts_distinct_senders(session, customer):
    for index in range(7):
        receipt(session, customer, cad="800", at=NOW + timedelta(minutes=5 * index))
    result = graph_engine.fan_in(session, customer.id, end=NOW + timedelta(hours=1), hours=24)
    assert result["unique_senders"] == 7


def test_shared_wallet_detection(session, customer):
    other = make_customer(session, "cust_shared", "Other Subject")
    receipt(session, customer, cad="1000", at=NOW, sender="ext_shared")
    receipt(session, other, cad="1000", at=NOW + timedelta(hours=1), sender="ext_shared")
    shared = graph_engine.shared_wallets(session, customer.id, since=NOW - timedelta(days=1))
    assert shared and shared[0]["address"] == "ext_shared"
    assert shared[0]["customer_count"] == 2


def test_cycle_detection_requires_forward_time(session, customer):
    """A 'cycle' whose hops run backwards in time is not a round trip."""
    hop = "ext_hop_1"
    receipt(session, customer, cad="5000", at=NOW, direction="outgoing")
    session.flush()

    from sqlalchemy import select

    from app.models import Transaction

    out = session.execute(select(Transaction).order_by(Transaction.id.desc())).scalars().first()
    out.wallet_to = hop
    session.flush()

    # Return leg happens BEFORE the outbound leg: must not be reported.
    receipt(session, customer, cad="4900", at=NOW - timedelta(hours=3), sender=hop)
    assert graph_engine.find_cycles(session, customer.id, end=NOW + timedelta(hours=6), hours=72) == []

    # Return leg after the outbound leg: a genuine round trip.
    receipt(session, customer, cad="4900", at=NOW + timedelta(hours=3), sender=hop)
    cycles = graph_engine.find_cycles(session, customer.id, end=NOW + timedelta(hours=6), hours=72)
    assert cycles and cycles[0]["hops"] == 2


def test_graph_view_exposes_neo4j_shaped_nodes_and_edges(session, case_with_activity):
    view = graph_engine.build_graph(session)
    nodes = view.nodes_payload()
    edges = view.edges_payload()
    assert nodes and edges
    assert {"id", "kind", "label"} <= set(nodes[0])
    assert {"source", "target", "relation"} <= set(edges[0])


# ---------------------------------------------------------------------------
# API walkthrough
# ---------------------------------------------------------------------------


@pytest.fixture()
def client(session, users):
    session.commit()
    return TestClient(app)


def _token(client, username):
    response = client.post("/api/auth/login", json={"username": username, "password": "password1234"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_health_is_public(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["submission_endpoint"] == "mock"


def test_unauthenticated_requests_are_refused(client):
    assert client.get("/api/cases").status_code == 401


def test_an_unknown_api_path_404s_as_json(client):
    """It must not fall through to the SPA shell.

    A client that typos an endpoint would otherwise get HTML with a 200 and
    parse it as success.
    """
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")


def test_unknown_non_api_paths_still_serve_the_spa(client):
    response = client.get("/cases/42")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")


def test_bad_credentials_are_refused(client):
    assert client.post("/api/auth/login", json={"username": "officer", "password": "wrong"}).status_code == 401


def test_permissions_are_role_scoped(client):
    analyst = _token(client, "analyst")
    officer = _token(client, "officer")
    assert "case:decide" not in client.get("/api/auth/me", headers=analyst).json()["permissions"]
    assert "case:decide" in client.get("/api/auth/me", headers=officer).json()["permissions"]


def test_an_analyst_cannot_run_the_pipeline(client):
    assert client.post("/api/pipeline/run", headers=_token(client, "analyst")).status_code == 403


def test_an_analyst_cannot_view_the_audit_trail(client):
    assert client.get("/api/audit", headers=_token(client, "analyst")).status_code == 403
    assert client.get("/api/audit", headers=_token(client, "auditor")).status_code == 200


def test_end_to_end_ingest_detect_report_submit(client, session):
    officer = _token(client, "officer")
    approver = _token(client, "approver")

    created = client.post("/api/customers", json={
        "customer_id": "cust_api", "name": "API Subject", "customer_type": "ENTITY",
        "expected_monthly_volume_cad": "5000", "country": "CA",
        "kyc": {"legal_name": "API Subject Ltd.", "business_nature": "Wholesale"},
    }, headers=_token(client, "admin"))
    assert created.status_code == 201, created.text

    batch = [
        {
            "transaction_id": f"api_tx_{i}", "customer_id": "cust_api", "asset": "USDT",
            "asset_amount": str(amount), "exchange_rate": "1",
            "timestamp": (NOW + timedelta(hours=i)).isoformat(), "direction": "incoming",
            "wallet_from": f"api_ext_{i}", "wallet_to": "api_int_1",
        }
        for i, amount in enumerate([4000, 3500, 3000])
    ]
    response = client.post("/api/transactions/batch", json={"transactions": batch}, headers=officer)
    assert response.status_code == 200, response.text
    assert response.json()["created"] == 3

    candidates = client.get("/api/aggregation-events", headers=officer).json()["events"]
    mine = [e for e in candidates if e["total_cad"] == 10500.0]
    assert mine, candidates

    cases = client.get("/api/cases", params={"open_only": True}, headers=officer).json()["cases"]
    case = next(c for c in cases if c["customer_reference"] == "cust_api")
    assert case["lvctr_required"] is True

    detail = client.get(f"/api/cases/{case['id']}", headers=officer)
    assert detail.status_code == 200
    assert detail.json()["timeline"]

    graph = client.get(f"/api/cases/{case['id']}/graph", headers=officer).json()
    assert graph["nodes"] and graph["focus"].startswith("customer:")

    draft = client.get(f"/api/cases/{case['id']}/str-draft", headers=officer).json()
    assert draft["verification"]["supported"] is True
    assert draft["citations"]

    # A filing decision needs a rationale and cannot be "no filing" here.
    refused = client.post(f"/api/cases/{case['id']}/decision", json={
        "disposition": "NO_FILING", "rationale": "Nothing to see here at all really honestly.",
    }, headers=officer)
    assert refused.status_code == 409

    client.post(f"/api/cases/{case['id']}/status", json={"status": "UNDER_REVIEW"}, headers=officer)
    decided = client.post(f"/api/cases/{case['id']}/decision", json={
        "disposition": "LVCTR",
        "rationale": "Three receipts aggregated past the reporting threshold inside a 24-hour window.",
    }, headers=officer)
    assert decided.status_code == 200, decided.text

    approved = client.post(f"/api/cases/{case['id']}/approve", headers=approver)
    assert approved.status_code == 200, approved.text

    built = client.post(f"/api/cases/{case['id']}/reports", json={"report_type": "LVCTR"}, headers=officer)
    assert built.status_code == 200, built.text
    report = built.json()
    assert report["validation"]["error_count"] == 0, report["validation"]["issues"]

    # An officer holds report:submit; an analyst does not.
    assert client.post(f"/api/reports/{report['id']}/submit", headers=_token(client, "analyst")).status_code == 403

    submitted = client.post(f"/api/reports/{report['id']}/submit", headers=approver)
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["submission"]["response_status"] == "accepted"

    download = client.get(f"/api/reports/{report['id']}/download", headers=officer)
    assert download.status_code == 200
    assert download.json()["@type"] == "LvctrForm"

    chain = client.get("/api/audit/verify", headers=_token(client, "auditor")).json()
    assert chain["valid"] is True


def test_validation_lab_endpoint_reports_issues(client):
    officer = _token(client, "officer")
    response = client.post(
        "/api/reports/validate-payload?levels=1,2,3,4",
        json={"@context": "x", "@type": "LvctrForm", "reportingEntityNumber": "abc", "reportReference": "R", "details": {}, "transactions": []},
        headers=officer,
    )
    assert response.status_code == 200
    result = response.json()
    assert result["valid"] is False
    assert result["error_count"] > 0
    assert {i["level"] for i in result["issues"]} & {1, 3}


def test_mock_receiver_endpoint_is_reachable(client):
    response = client.post("/api/mock-fintrac/reports/lvctr", json={"reportReference": "X"})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "rejected"
    assert "SIMULATED" in body["notice"]
