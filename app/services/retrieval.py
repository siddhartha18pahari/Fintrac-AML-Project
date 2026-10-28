"""BM25 retrieval over the bundled FINTRAC guidance notes.

The copilot in the workspace uses the same formula. No model, no network, and
no API key. A passage is a summary written for this project, with a public
source URL. Retrieval ranks those notes. It does not decide a filing.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml

CORPUS_PATH = Path(__file__).resolve().parent.parent / "corpus" / "guidance.yaml"
_TOKEN = re.compile(r"[a-z0-9]+")
K1 = 1.5
B = 0.75


def tokenize(text: str) -> list[str]:
    return _TOKEN.findall((text or "").lower())


@dataclass(frozen=True)
class Passage:
    id: str
    title: str
    text: str
    source: str
    topics: tuple[str, ...]

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "text": self.text.strip(),
            "source": self.source,
            "topics": list(self.topics),
        }


@lru_cache(maxsize=1)
def load_passages(path: str | None = None) -> tuple[Passage, ...]:
    source = Path(path) if path else CORPUS_PATH
    raw = yaml.safe_load(source.read_text(encoding="utf-8"))
    passages: list[Passage] = []
    for item in raw.get("passages", []):
        passages.append(
            Passage(
                id=str(item["id"]),
                title=str(item["title"]),
                text=str(item["text"]).strip(),
                source=str(item["source"]),
                topics=tuple(str(topic) for topic in (item.get("topics") or [])),
            )
        )
    return tuple(passages)


def _indexed_text(passage: Passage) -> str:
    """Title is repeated so a query that names the report type outranks a passing mention."""
    return f"{passage.title} {passage.title} {passage.title} {passage.text}"


def search(query: str, *, k: int = 4, passages: tuple[Passage, ...] | None = None) -> list[dict]:
    """Return the top ``k`` passages with BM25 scores.

    Scores are comparable within one query. A score of zero means no shared
    token, and those passages are omitted.
    """
    docs = passages if passages is not None else load_passages()
    tokens = [tokenize(_indexed_text(passage)) for passage in docs]
    query_terms = tokenize(query)
    if not docs or not query_terms:
        return []
    lengths = [len(tokens_for_doc) for tokens_for_doc in tokens]
    average = sum(lengths) / len(lengths) if lengths else 0.0
    document_frequency: dict[str, int] = {}
    for doc_tokens in tokens:
        for term in set(doc_tokens):
            document_frequency[term] = document_frequency.get(term, 0) + 1
    total = len(docs)
    scores: list[tuple[float, Passage]] = []
    for passage, doc_tokens, length in zip(docs, tokens, lengths):
        if not doc_tokens:
            continue
        term_frequency: dict[str, int] = {}
        for term in doc_tokens:
            term_frequency[term] = term_frequency.get(term, 0) + 1
        score = 0.0
        for term in query_terms:
            frequency = term_frequency.get(term, 0)
            if not frequency:
                continue
            df = document_frequency.get(term, 0)
            idf = math.log((total - df + 0.5) / (df + 0.5) + 1)
            denominator = frequency + K1 * (1 - B + B * length / average)
            score += idf * (frequency * (K1 + 1)) / denominator
        if score > 0:
            scores.append((score, passage))
    scores.sort(key=lambda item: (-item[0], item[1].id))
    hits = []
    for score, passage in scores[:k]:
        payload = passage.as_dict()
        payload["score"] = round(score, 4)
        hits.append(payload)
    return hits


def extractive_answer(query: str, hits: list[dict], *, context: str = "") -> str:
    """A cited answer made only of the retrieved notes.

    Used when no model key is configured. It does not infer a filing decision
    and it does not assert that money laundering occurred.
    """
    if not hits:
        return (
            "None of the bundled guidance notes share terms with that question. "
            "Try a report name such as LCTR, EFTR, STR, or terrorist property. "
            "This copilot only answers from those notes."
        )
    lines = [
        "This answer is extracted from Sentinel's own summaries of public FINTRAC guidance. "
        "It is not a filing decision and it is not a finding that money laundering occurred.",
        "",
    ]
    if context.strip():
        lines.append(f"Book context supplied with the question: {context.strip()}")
        lines.append("")
    for index, hit in enumerate(hits, start=1):
        snippet = " ".join(hit["text"].split())
        if len(snippet) > 420:
            snippet = snippet[:417].rsplit(" ", 1)[0] + "…"
        lines.append(f"{index}. {hit['title']} ({hit['id']}, score {hit['score']})")
        lines.append(snippet)
        lines.append(f"Source: {hit['source']}")
        lines.append("")
    lines.append("A person still decides whether a report is filed.")
    return "\n".join(lines).strip()
