"""LangChain tool-calling copilot over the synthetic book and guidance notes.

When ``OPENAI_API_KEY`` or ``AI_GATEWAY_API_KEY`` is unset, or LangChain is not
installed, the same tools still run through a deterministic router. The model
is never required for the demo.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

from .retrieval import search
from .studio_data import compute_stats, entity_detail, explain_rule, graph_query, load_snapshot, query_alerts

RULE_PATTERN = re.compile(r"aml-[a-z]+-\d+", re.IGNORECASE)
GUARD = (
    "Indicators only. Do not state that a person committed money laundering, terrorist financing, "
    "or is a listed person. A reporting threshold is not suspicion."
)


def langchain_installed() -> bool:
    try:
        import langchain_core  # noqa: F401

        return True
    except ImportError:
        return False


def _alerts(severity: str = "", rule_id: str = "", query: str = "", limit: int = 8) -> str:
    return json.dumps(query_alerts(severity=severity, rule_id=rule_id, query=query, limit=limit))


def _entity(query: str) -> str:
    detail = entity_detail(query)
    if detail is None:
        from .studio_data import query_entities

        return json.dumps(query_entities(query=query, limit=5))
    return json.dumps(detail)


def _path(source: str = "", target: str = "", ego: str = "") -> str:
    return json.dumps(graph_query(source=source, target=target, ego=ego or source, depth=2))


def _rule(rule_id: str) -> str:
    return json.dumps(explain_rule(rule_id))


def _stats(metric: str = "overview") -> str:
    return json.dumps(compute_stats(metric))


def _guidance(question: str) -> str:
    hits = search(question, k=4)
    return json.dumps(hits)


def build_tools() -> list[Any]:
    """LangChain tools when the package is present, otherwise plain callables."""
    if not langchain_installed():
        return [
            ("query_alerts", _alerts),
            ("lookup_entity", _entity),
            ("graph_path", _path),
            ("explain_rule", _rule),
            ("compute_stats", _stats),
            ("retrieve_guidance", _guidance),
        ]
    from langchain_core.tools import tool

    @tool
    def query_alerts(severity: str = "", rule_id: str = "", query: str = "", limit: int = 8) -> str:
        """List synthetic monitoring alerts. Filter by severity, rule id, or a name fragment."""
        return _alerts(severity, rule_id, query, limit)

    @tool
    def lookup_entity(query: str) -> str:
        """Look up a customer or graph entity by name, reference, or id."""
        return _entity(query)

    @tool
    def graph_path(source: str = "", target: str = "", ego: str = "") -> str:
        """Find a knowledge-graph path between two names, or the ego network of one."""
        return _path(source, target, ego)

    @tool
    def explain_rule(rule_id: str) -> str:
        """Explain one catalogue rule, for example AML-FI-003."""
        return _rule(rule_id)

    @tool
    def compute_stats(metric: str = "overview") -> str:
        """Compute a book statistic: overview, benford, velocity, peers, roc, or anomaly."""
        return _stats(metric)

    @tool
    def retrieve_guidance(question: str) -> str:
        """Retrieve FINTRAC guidance notes bundled with this project."""
        return _guidance(question)

    return [query_alerts, lookup_entity, graph_path, explain_rule, compute_stats, retrieve_guidance]


def _tool_map(tools: list[Any]) -> dict[str, Any]:
    mapped = {}
    for item in tools:
        if isinstance(item, tuple):
            mapped[item[0]] = item[1]
        else:
            mapped[item.name] = item
    return mapped


def _invoke(tool: Any, payload: dict) -> str:
    if isinstance(tool, tuple):
        tool = tool[1]
    if hasattr(tool, "invoke"):
        result = tool.invoke(payload)
        return result if isinstance(result, str) else json.dumps(result)
    return tool(**payload)


def plan(question: str) -> list[dict]:
    text = question.strip()
    lowered = text.lower()
    calls: list[dict] = []
    rule = RULE_PATTERN.search(text)
    if rule or ("rule" in lowered and "explain" in lowered):
        calls.append({"name": "explain_rule", "args": {"rule_id": rule.group(0).upper() if rule else ""}})
    if any(word in lowered for word in ("alert", "queue", "severity", "critical", "triage")):
        severity = ""
        for level in ("critical", "high", "medium", "low"):
            if level in lowered:
                severity = level.upper()
        calls.append({"name": "query_alerts", "args": {"severity": severity, "query": "", "limit": 6}})
    if any(word in lowered for word in ("benford", "statistic", "anomaly", "precision", "recall", "velocity", "how many")):
        metric = "overview"
        for name in ("benford", "velocity", "peer", "roc", "anomaly"):
            if name in lowered:
                metric = name
        calls.append({"name": "compute_stats", "args": {"metric": metric}})
    names = _mentioned_customers(text)
    if any(word in lowered for word in ("path", "connect", "between", "linked", "link")) and len(names) >= 2:
        calls.append({"name": "graph_path", "args": {"source": names[0], "target": names[1]}})
    elif any(word in lowered for word in ("connected", "neighbour", "neighbor", "ego", "network")) and names:
        calls.append({"name": "graph_path", "args": {"ego": names[0]}})
    elif names and not any(call["name"] == "lookup_entity" for call in calls):
        calls.append({"name": "lookup_entity", "args": {"query": names[0]}})
    elif not calls:
        calls.append({"name": "lookup_entity", "args": {"query": text[:80]}})
    calls.append({"name": "retrieve_guidance", "args": {"question": text}})
    deduped = []
    seen = set()
    for call in calls:
        if call["name"] in seen:
            continue
        seen.add(call["name"])
        deduped.append(call)
    return deduped[:4]


def _mentioned_customers(question: str) -> list[str]:
    book = load_snapshot()
    lowered = question.lower()
    found = []
    for customer in book["customers"]:
        name = customer["name"]
        if name.lower() in lowered:
            found.append(name)
            continue
        parts = [part for part in name.split() if len(part) > 3]
        if parts and all(part.lower() in lowered for part in parts[:2]):
            found.append(name)
    return found


def _retrieval_query(question: str, traces: list[dict]) -> str:
    for trace in traces:
        if trace["name"] != "explain_rule":
            continue
        try:
            payload = json.loads(trace["output"])
        except json.JSONDecodeError:
            return question
        return f"{question} {payload.get('name', '')} {payload.get('description', '')}"[:1200]
    return question


def _compose(question: str, traces: list[dict], passages: list[dict]) -> str:
    paragraphs = [f"Question: {question.strip()}", ""]
    for trace in traces:
        if trace["name"] == "retrieve_guidance":
            continue
        paragraphs.append(_summarise_trace(trace))
        paragraphs.append("")
    if passages:
        paragraphs.append("Guidance notes:")
        for passage in passages[:3]:
            snippet = " ".join(str(passage.get("text") or "").split())
            if len(snippet) > 380:
                snippet = snippet[:377] + "..."
            paragraphs.append(f"[{passage.get('id')}] {passage.get('title')}. {snippet}")
        paragraphs.append("")
    paragraphs.append(GUARD)
    return "\n".join(paragraphs).strip()


def _summarise_trace(trace: dict) -> str:
    try:
        payload = json.loads(trace["output"]) if isinstance(trace["output"], str) else trace["output"]
    except json.JSONDecodeError:
        return f"{trace['name']} returned a result."
    name = trace["name"]
    if name == "query_alerts":
        alerts = payload.get("alerts") or []
        if not alerts:
            return "No alerts matched that filter."
        preview = "; ".join(f"{alert['rule_id']} {alert['title']} ({alert.get('customer_name')})" for alert in alerts[:4])
        return f"{payload.get('count', len(alerts))} alerts match. {preview}."
    if name == "lookup_entity":
        if payload.get("kind") == "customer":
            customer = payload.get("customer") or {}
            risk = (customer.get("risk") or {})
            return (
                f"{customer.get('name')} ({customer.get('reference')}) is residual {risk.get('residual')} {risk.get('tier')}. "
                f"{len(payload.get('alerts') or [])} alerts are on the record in this view."
            )
        entities = payload.get("entities") or []
        if entities:
            return "Closest entities: " + ", ".join(str(entity.get("name") or entity.get("label")) for entity in entities[:4]) + "."
        return "No entity matched that name."
    if name == "graph_path":
        if payload.get("path"):
            labels = " → ".join(str(node.get("label") or node.get("id")) for node in payload["path"])
            return f"A path on the knowledge graph: {labels}."
        focus = (payload.get("focus") or {}).get("label")
        count = len(payload.get("nodes") or [])
        if focus:
            return f"Ego network around {focus} has {count} entities in this depth."
        return "No path was found between those names."
    if name == "explain_rule":
        if not payload.get("found"):
            return "That rule id is not in the in-force catalogue view."
        return f"{payload['rule_id']} {payload['name']}. {payload.get('description') or ''}".strip()
    if name == "compute_stats":
        if "benford" in payload:
            benford = payload["benford"]
            return f"Benford MAD is {benford['mad']:.4f} ({benford['conformity']}) on {benford['n']} amounts."
        if "auc" in payload:
            return (
                f"The book has {payload.get('transactions')} transactions. "
                f"Benford conformity is {payload.get('benford_conformity')}. "
                f"Planted-label ROC AUC is {payload.get('auc')}."
            )
        return "Statistics were computed for that metric."
    return f"{name} completed."


def answer(question: str, history: list[dict] | None = None) -> dict:
    """Answer with tool traces and citations. Uses a model only when a key is set."""
    text = (question or "").strip()
    if not text:
        raise ValueError("A question is required.")
    traces = _run_plan(text)
    passages = search(_retrieval_query(text, traces), k=4)
    mode = "deterministic"
    framework = "langchain" if langchain_installed() else "plain"
    body = _compose(text, traces, passages)
    if _llm_key():
        try:
            generated = _langchain_model_answer(text, history or [], traces, passages)
            if generated:
                body = generated
                mode = "langchain"
        except Exception:
            mode = "deterministic"
    return {
        "answer": body,
        "mode": mode,
        "framework": framework,
        "traces": [{"name": trace["name"], "input": trace["input"], "output": _clip(trace["output"])} for trace in traces],
        "citations": [
            {"id": hit["id"], "title": hit["title"], "source": hit["source"], "score": hit.get("score"), "text": hit["text"]}
            for hit in passages
        ],
    }


def _clip(payload: str, limit: int = 1200) -> str:
    if len(payload) <= limit:
        return payload
    return payload[: limit - 3] + "..."


def _run_plan(question: str) -> list[dict]:
    tools = _tool_map(build_tools())
    traces = []
    for call in plan(question):
        tool = tools.get(call["name"])
        if tool is None:
            continue
        output = _invoke(tool, call["args"])
        traces.append({"name": call["name"], "input": call["args"], "output": output})
    return traces


def _llm_key() -> str:
    return os.environ.get("AI_GATEWAY_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""


def _langchain_model_answer(question: str, history: list[dict], traces: list[dict], passages: list[dict]) -> str:
    from langchain_core.messages import HumanMessage, SystemMessage
    from langchain_openai import ChatOpenAI

    gateway = bool(os.environ.get("AI_GATEWAY_API_KEY"))
    model_name = "openai/gpt-5.4" if gateway else os.environ.get("SENTINEL_CHAT_MODEL", "gpt-5.4")
    kwargs: dict[str, Any] = {
        "model": model_name,
        "api_key": _llm_key(),
        "temperature": 0,
    }
    if gateway:
        kwargs["base_url"] = os.environ.get("AI_GATEWAY_BASE_URL", "https://ai-gateway.vercel.sh/v1")
    model = ChatOpenAI(**kwargs)
    notes = "\n\n".join(f"[{hit['id']}] {hit['title']}\n{hit['text']}" for hit in passages)
    tool_blob = "\n".join(f"{trace['name']}: {trace['output']}" for trace in traces)
    messages = [
        SystemMessage(
            content=(
                "You are the Sentinel investigator copilot. Answer only from the tool results and guidance notes. "
                "Cite passage ids in brackets. " + GUARD
            )
        )
    ]
    for turn in history[-6:]:
        if turn.get("role") == "user" and turn.get("content"):
            messages.append(HumanMessage(content=str(turn["content"])[:2000]))
    messages.append(
        HumanMessage(content=f"Question: {question}\n\nTool results:\n{tool_blob}\n\nGuidance notes:\n{notes}")
    )
    result = model.invoke(messages)
    content = result.content
    if isinstance(content, list):
        content = " ".join(str(part.get("text") if isinstance(part, dict) else part) for part in content)
    return str(content).strip()
