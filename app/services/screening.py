"""Fuzzy name screening against a bundled fictional list.

The list in ``app/rules/screening_sample.yaml`` is not a sanctions, PEP, or
terrorist-property register. Matching it demonstrates the control — normalise,
tolerate reordered tokens and small edits, record the score — without shipping
anyone's real designation.

The scorer is intentionally small and dependency-free so a hit can be
recomputed later from the name and the list version alone.
"""

from __future__ import annotations

import functools
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import yaml

LIST_PATH = Path(__file__).resolve().parent.parent / "rules" / "screening_sample.yaml"

_STOPWORDS = frozenset(
    {
        "ltd",
        "limited",
        "inc",
        "incorporated",
        "co",
        "corp",
        "corporation",
        "llc",
        "company",
        "the",
        "of",
        "and",
        "fze",
        "dmcc",
        "sa",
        "ag",
        "gmbh",
    }
)
_TOKEN = re.compile(r"[^a-z0-9\s]+")


@dataclass(frozen=True)
class ListEntry:
    id: str
    name: str
    aliases: tuple[str, ...]
    kind: str
    program: str
    country: str
    note: str


@dataclass(frozen=True)
class NameHit:
    query: str
    entry_id: str
    canonical_name: str
    matched_name: str
    kind: str
    program: str
    country: str
    score: float

    def as_dict(self) -> dict:
        return {
            "query": self.query,
            "entry_id": self.entry_id,
            "canonical_name": self.canonical_name,
            "matched_name": self.matched_name,
            "kind": self.kind,
            "program": self.program,
            "country": self.country,
            "score": round(self.score, 4),
        }


def normalize(name: str) -> str:
    """Lower-case, strip accents and punctuation, drop legal-form words."""
    decomposed = unicodedata.normalize("NFKD", name or "")
    stripped = "".join(char for char in decomposed if not unicodedata.combining(char))
    cleaned = _TOKEN.sub(" ", stripped.lower())
    tokens = [token for token in cleaned.split() if token not in _STOPWORDS]
    return " ".join(tokens)


def levenshtein(left: str, right: str) -> int:
    if left == right:
        return 0
    if not left:
        return len(right)
    if not right:
        return len(left)
    if len(left) < len(right):
        left, right = right, left
    previous = list(range(len(right) + 1))
    for index, char in enumerate(left, start=1):
        current = [index]
        for other_index, other in enumerate(right, start=1):
            insert = current[other_index - 1] + 1
            delete = previous[other_index] + 1
            replace = previous[other_index - 1] + (char != other)
            current.append(min(insert, delete, replace))
        previous = current
    return previous[-1]


def _ratio(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    distance = levenshtein(left, right)
    return 1.0 - distance / max(len(left), len(right))


def _token_cover(query_tokens: list[str], candidate_tokens: list[str]) -> float:
    """Share of the candidate's significant tokens that appear, fuzzily, in the query.

    A middle initial in the query does not dilute the score. A single-token
    candidate never passes, so a shared surname alone cannot clear the bar.
    """
    significant = [token for token in candidate_tokens if len(token) > 1]
    if len(significant) < 2:
        return 0.0
    query_significant = [token for token in query_tokens if len(token) > 1]
    if not query_significant:
        return 0.0
    matched = 0
    for token in significant:
        best = max(_ratio(token, other) for other in query_significant)
        if best >= 0.86:
            matched += 1
    extra = max(0, len(query_significant) - len(significant))
    return (matched / len(significant)) * (1 - 0.05 * extra)


def similarity(query: str, candidate: str) -> float:
    """1.0 is an exact normalised match. Order-insensitive and edit-tolerant."""
    left = normalize(query)
    right = normalize(candidate)
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    direct = _ratio(left, right)
    ordered = _ratio(" ".join(sorted(left.split())), " ".join(sorted(right.split())))
    covered = _token_cover(left.split(), right.split())
    return max(direct, ordered, covered)


@functools.lru_cache(maxsize=1)
def load_entries(path: str | None = None) -> tuple[ListEntry, ...]:
    source = Path(path) if path else LIST_PATH
    raw = yaml.safe_load(source.read_text(encoding="utf-8"))
    entries: list[ListEntry] = []
    for item in raw.get("entries", []):
        entries.append(
            ListEntry(
                id=str(item["id"]),
                name=str(item["name"]),
                aliases=tuple(str(alias) for alias in (item.get("aliases") or [])),
                kind=str(item["kind"]).upper(),
                program=str(item.get("program") or ""),
                country=str(item.get("country") or ""),
                note=str(item.get("note") or "").strip(),
            )
        )
    return tuple(entries)


def list_meta(path: str | None = None) -> dict:
    source = Path(path) if path else LIST_PATH
    raw = yaml.safe_load(source.read_text(encoding="utf-8"))
    meta = raw.get("meta") or {}
    return {
        "id": meta.get("id"),
        "version": str(meta.get("version") or ""),
        "entries": len(raw.get("entries") or []),
        "disclaimer": str(meta.get("disclaimer") or "").strip(),
    }


def match_name(
    query: str,
    *,
    kinds: set[str] | None = None,
    min_score: float = 0.90,
) -> list[NameHit]:
    """Every list entry at or above ``min_score``, best first.

    A query is compared with the canonical name and each alias. The hit keeps
    the form that actually scored.
    """
    if not str(query or "").strip():
        return []
    wanted = {kind.upper() for kind in kinds} if kinds else None
    hits: list[NameHit] = []
    for entry in load_entries():
        if wanted is not None and entry.kind not in wanted:
            continue
        forms = (entry.name, *entry.aliases)
        best_score = -1.0
        best_form = entry.name
        for form in forms:
            score = similarity(query, form)
            if score > best_score:
                best_score = score
                best_form = form
        if best_score + 1e-9 < min_score:
            continue
        hits.append(
            NameHit(
                query=query.strip(),
                entry_id=entry.id,
                canonical_name=entry.name,
                matched_name=best_form,
                kind=entry.kind,
                program=entry.program,
                country=entry.country,
                score=best_score,
            )
        )
    hits.sort(key=lambda hit: (-hit.score, hit.entry_id))
    return hits


def best_match(query: str, *, kinds: set[str] | None = None) -> NameHit | None:
    hits = match_name(query, kinds=kinds, min_score=0.0)
    return hits[0] if hits else None


def summarize(name: str) -> dict:
    """Hits at the catalogue threshold, plus the closest sample name when it is near."""
    hits = match_name(name, min_score=0.90)
    closest = best_match(name)
    return {
        "hits": [hit.as_dict() for hit in hits],
        "closest": closest.as_dict() if closest and closest.score >= 0.75 else None,
        "list": list_meta(),
    }
