"""Snapshot studio API: alerts, cases, entities, graph, stats, simulation, chat.

These routes read the bundled synthetic book. They do not require a database
session and they do not file anything. OpenAPI lists every body field.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..services import langchain_copilot, studio_data

router = APIRouter(prefix="/api/studio", tags=["studio"])


class GraphRequest(BaseModel):
    source: str = ""
    target: str = ""
    ego: str = ""
    depth: int = Field(2, ge=1, le=4)


class SimulateRequest(BaseModel):
    seed: int = Field(7, ge=1, le=999999)
    days: int = Field(21, ge=7, le=60)
    customers: int = Field(12, ge=6, le=48)
    mu: float = Field(6.2, ge=4, le=9)
    sigma: float = Field(0.85, ge=0.2, le=1.6)
    seasonality: float = Field(0.35, ge=0, le=1)
    night_share: float = Field(0.12, ge=0, le=0.6)
    fx_vol: float = Field(0.02, ge=0, le=0.15)
    intensity: float = Field(0.55, ge=0, le=1)
    camouflage: float = Field(0, ge=0, le=1)
    focus_city: str = ""
    preset: str = ""
    structuring: bool = True
    layering: bool = True
    mules: bool = True
    trade: bool = True
    offramp: bool = True
    round_trip: bool = True
    funnel: bool = False
    rapid: bool = False
    professional: bool = False
    payroll: bool = True
    rent: bool = True


class ChatTurn(BaseModel):
    role: str
    content: str = ""


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    history: list[ChatTurn] = Field(default_factory=list)


@router.get("/alerts")
def alerts(
    severity: str = "",
    rule_id: str = "",
    q: str = "",
    limit: int = Query(25, ge=1, le=100),
) -> dict:
    return studio_data.query_alerts(severity=severity, rule_id=rule_id, query=q, limit=limit)


@router.get("/cases")
def cases(
    tier: str = "",
    status: str = "",
    limit: int = Query(25, ge=1, le=100),
) -> dict:
    return studio_data.query_cases(tier=tier, status=status, limit=limit)


@router.get("/entities")
def entities(q: str = "", kind: str = "customer", limit: int = Query(20, ge=1, le=50)) -> dict:
    return studio_data.query_entities(query=q, kind=kind, limit=limit)


@router.get("/entities/{entity_id}")
def entity(entity_id: str) -> dict:
    detail = studio_data.entity_detail(entity_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="No entity matched that id.")
    return detail


@router.post("/graph")
def graph(body: GraphRequest) -> dict:
    return studio_data.graph_query(source=body.source, target=body.target, ego=body.ego, depth=body.depth)


@router.get("/stats")
def stats(metric: str = "overview") -> dict:
    if metric == "full":
        return studio_data.book_statistics()
    return studio_data.compute_stats(metric)


@router.post("/simulate")
def simulate(body: SimulateRequest) -> dict:
    return studio_data.run_simulation(body.model_dump())


@router.post("/chat")
def chat(body: ChatRequest, stream: bool = False):
    try:
        payload = langchain_copilot.answer(
            body.message,
            [turn.model_dump() for turn in body.history],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not stream:
        return payload

    def chunks():
        yield _sse({"type": "mode", "mode": payload["mode"], "framework": payload["framework"]})
        for trace in payload["traces"]:
            yield _sse({"type": "tool", "name": trace["name"], "input": trace["input"], "output": trace["output"]})
        for citation in payload["citations"]:
            yield _sse({"type": "citation", **citation})
        step = 80
        text = payload["answer"]
        for index in range(0, len(text), step):
            yield _sse({"type": "token", "text": text[index : index + step]})
        yield _sse({"type": "done"})

    return StreamingResponse(chunks(), media_type="text/event-stream")


def _sse(payload: dict) -> str:
    import json

    return f"data: {json.dumps(payload)}\n\n"
