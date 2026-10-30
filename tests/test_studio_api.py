"""Studio HTTP API and the LangChain copilot fallback."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import langchain_copilot


@pytest.fixture()
def client(session):
    return TestClient(app)


def test_alerts_cases_and_entities_read_the_snapshot(client):
    alerts = client.get("/api/studio/alerts", params={"severity": "high", "limit": 5})
    assert alerts.status_code == 200
    body = alerts.json()
    assert body["count"] >= 1
    assert all(row["severity"].lower() == "high" for row in body["alerts"])

    cases = client.get("/api/studio/cases", params={"tier": "CRITICAL", "limit": 5})
    assert cases.status_code == 200
    assert cases.json()["cases"]

    entities = client.get("/api/studio/entities", params={"q": "Maple"})
    assert entities.status_code == 200
    assert any("Maple" in row["name"] for row in entities.json()["entities"])

    detail = client.get("/api/studio/entities/Maple")
    assert detail.status_code == 200
    assert detail.json()["kind"] == "customer"


def test_graph_path_and_stats(client):
    graph = client.post("/api/studio/graph", json={"source": "Maple Digital Imports Ltd.", "ego": "Maple Digital Imports Ltd.", "depth": 1})
    assert graph.status_code == 200
    assert graph.json()["nodes"]

    stats = client.get("/api/studio/stats", params={"metric": "benford"})
    assert stats.status_code == 200
    assert stats.json()["benford"]["n"] > 50

    full = client.get("/api/studio/stats", params={"metric": "full"})
    assert full.status_code == 200
    assert "correlation" in full.json()
    assert "roc" in full.json()


def test_simulate_endpoint(client):
    response = client.post("/api/studio/simulate", json={"seed": 4, "days": 10, "customers": 8, "structuring": True})
    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["transactions"] > 0
    assert any(hit["rule_id"] == "AML-FI-003" for hit in body["hits"])


def test_chat_falls_back_without_a_model_key(client, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    response = client.post(
        "/api/studio/chat",
        json={"message": "Explain AML-FI-003 and what the large virtual currency threshold is."},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "deterministic"
    assert body["framework"] == "langchain"
    assert any(trace["name"] == "explain_rule" for trace in body["traces"])
    assert any(trace["name"] == "retrieve_guidance" for trace in body["traces"])
    assert any(citation["id"] == "structuring" for citation in body["citations"])
    assert "AML-FI-003" in body["answer"]
    assert "money laundering" in body["answer"].lower()


def test_chat_stream_emits_tool_events(client, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    response = client.post("/api/studio/chat", params={"stream": "true"}, json={"message": "Which critical alerts are open?"})
    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]
    text = response.text
    assert '"type": "tool"' in text
    assert '"type": "citation"' in text
    assert '"type": "done"' in text


def test_openapi_lists_the_studio(client):
    spec = client.get("/openapi.json").json()
    for path in ("/api/studio/alerts", "/api/studio/simulate", "/api/studio/chat", "/api/studio/graph", "/api/studio/stats"):
        assert path in spec["paths"]
    assert "SimulateRequest" in spec["components"]["schemas"]


def test_langchain_tools_are_invocable(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    tools = langchain_copilot.build_tools()
    names = [tool.name for tool in tools]
    assert names == ["query_alerts", "lookup_entity", "graph_path", "explain_rule", "compute_stats", "retrieve_guidance"]
    payload = langchain_copilot.answer("How many transactions, and does Benford conform?")
    assert payload["mode"] == "deterministic"
    assert any(trace["name"] == "compute_stats" for trace in payload["traces"])
    assert os.environ.get("OPENAI_API_KEY") is None


def test_missing_entity_is_a_json_404(client):
    response = client.get("/api/studio/entities/not-a-real-customer-zzz")
    assert response.status_code == 404
    assert response.json()["detail"]
