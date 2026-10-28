"""Knowledge-graph paths and BM25 retrieval over the guidance notes."""

from __future__ import annotations

from datetime import timedelta

from app.services.knowledge_graph import build_graph, shortest_path
from app.services.retrieval import extractive_answer, load_passages, search
from conftest import NOW, make_customer, receipt


def test_shared_wallet_is_a_path_between_customers(session):
    first = make_customer(session, "cust_graph_a", "Ada North")
    second = make_customer(session, "cust_graph_b", "Bea South")
    receipt(session, first, cad="800", at=NOW, sender="shared_wallet_addr")
    receipt(session, second, cad="900", at=NOW + timedelta(minutes=20), sender="shared_wallet_addr")
    graph = build_graph(session, as_of=NOW + timedelta(hours=1))
    path = shortest_path(graph["edges"], f"customer:{first.id}", f"customer:{second.id}")
    assert path is not None
    assert path[0] == f"customer:{first.id}"
    assert path[-1] == f"customer:{second.id}"
    assert any(node.startswith("wallet:") for node in path)
    kinds = {node["kind"] for node in graph["nodes"]}
    assert "customer" in kinds
    assert "wallet" in kinds


def test_a_customer_with_no_activity_has_no_path(session):
    active = make_customer(session, "cust_graph_c", "Cara West")
    quiet = make_customer(session, "cust_graph_d", "Dara East")
    receipt(session, active, cad="100", at=NOW, sender="wallet_only_cara")
    graph = build_graph(session, as_of=NOW + timedelta(hours=1))
    assert shortest_path(graph["edges"], f"customer:{active.id}", f"customer:{quiet.id}") is None


def test_cash_guidance_outranks_a_passing_mention():
    hits = search("large cash transaction report threshold", k=3)
    assert hits
    assert hits[0]["id"] == "lctr-threshold"
    assert hits[0]["score"] >= hits[1]["score"]
    assert hits[0]["source"].startswith("https://fintrac-canafe.canada.ca/")


def test_typology_queries_find_their_own_notes():
    assert search("casino chips minimal play redemption", k=1)[0]["id"] == "casino-typology"
    assert search("trade invoice over-invoicing declared goods", k=1)[0]["id"] == "trade-based"
    assert search("terrorist property listed person report", k=1)[0]["id"] == "terrorist-property"
    assert search("originator beneficiary travel rule international wire", k=1)[0]["id"] == "travel-rule"


def test_unknown_query_is_empty_and_the_extractive_answer_does_not_accuse():
    assert search("zzzzqqqq notaword") == []
    hits = search("suspicious transaction reasonable grounds", k=2)
    answer = extractive_answer("When is an STR filed?", hits, context="Case CASE-1 is open.")
    assert "CASE-1" in answer
    assert "http" in answer
    assert "not a filing decision" in answer.lower()
    assert "money launderer" not in answer.lower()
    assert "is a terrorist" not in answer.lower()
    assert len(load_passages()) >= 12
