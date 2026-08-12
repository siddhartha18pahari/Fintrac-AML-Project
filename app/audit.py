"""Append-only, hash-chained audit trail.

Every consequential action calls :func:`record`.  Rows are chained with
``prev_hash``/``hash`` so that removing or editing a historical row breaks the
chain and is detectable by :func:`verify_chain`.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AuditEvent
from .util import iso, utcnow

GENESIS = "0" * 64


def _canonical(payload: Any) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


def _digest(event: AuditEvent) -> str:
    material = _canonical(
        {
            "actor": event.actor_name,
            "action": event.action,
            "object_type": event.object_type,
            "object_id": event.object_id,
            "before": event.before,
            "after": event.after,
            "reason": event.reason,
            "occurred_at": iso(event.occurred_at),
            "prev": event.prev_hash,
        }
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def record(
    session: Session,
    *,
    action: str,
    object_type: str,
    object_id: str | int,
    actor_id: int | None = None,
    actor_name: str = "system",
    before: dict | None = None,
    after: dict | None = None,
    reason: str | None = None,
) -> AuditEvent:
    tip = session.execute(select(AuditEvent).order_by(AuditEvent.id.desc()).limit(1)).scalar_one_or_none()
    event = AuditEvent(
        actor_id=actor_id,
        actor_name=actor_name,
        action=action,
        object_type=object_type,
        object_id=str(object_id),
        before=before,
        after=after,
        reason=reason,
        occurred_at=utcnow(),
        prev_hash=tip.hash if tip else GENESIS,
    )
    event.hash = _digest(event)
    session.add(event)
    session.flush()
    return event


def verify_chain(session: Session) -> dict:
    """Re-derive every hash and report the first divergence, if any."""
    events = session.execute(select(AuditEvent).order_by(AuditEvent.id)).scalars().all()
    prev = GENESIS
    for event in events:
        if event.prev_hash != prev:
            return {"valid": False, "broken_at": event.id, "problem": "prev_hash mismatch", "checked": len(events)}
        if _digest(event) != event.hash:
            return {"valid": False, "broken_at": event.id, "problem": "content hash mismatch", "checked": len(events)}
        prev = event.hash
    return {"valid": True, "broken_at": None, "problem": None, "checked": len(events)}
