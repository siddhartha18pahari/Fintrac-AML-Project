"use client";

import { useEffect, useState } from "react";

export const ASSIGNEES = ["Unassigned", "J. Okafor", "S. Rahman", "L. Chen", "D. Vasquez"] as const;

export const STATUSES = [
  "NEW",
  "TRIAGE",
  "UNDER_REVIEW",
  "ESCALATED",
  "DECISION",
  "APPROVED",
  "CLOSED_NO_FILING",
] as const;

export const DISPOSITIONS = ["", "NO_FILING", "LVCTR", "LCTR", "EFTR", "STR", "TPR", "LVCTR_AND_STR"] as const;

export type Note = { id: string; at: string; author: string; body: string };
export type AuditEntry = { id: string; at: string; actor: string; action: string; detail: string };

export type Overlay = {
  assignee: string;
  status: string;
  disposition: string;
  notes: Note[];
  audit: AuditEntry[];
};

function storageKey(namespace: string) {
  return `sentinel-workspace:${namespace}`;
}

function stamp() {
  return new Date().toISOString();
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function blankOverlay(status: string, disposition: string | null): Overlay {
  return {
    assignee: "Unassigned",
    status,
    disposition: disposition ?? "",
    notes: [],
    audit: [],
  };
}

export function useWorkspace(namespace: string) {
  const [map, setMap] = useState<Record<string, Overlay>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(namespace));
      if (raw) setMap(JSON.parse(raw) as Record<string, Overlay>);
    } catch {
      setMap({});
    }
    setReady(true);
  }, [namespace]);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(storageKey(namespace), JSON.stringify(map));
  }, [map, namespace, ready]);

  function overlayFor(caseId: number, status: string, disposition: string | null): Overlay {
    return map[String(caseId)] ?? blankOverlay(status, disposition);
  }

  function update(caseId: number, status: string, disposition: string | null, recipe: (current: Overlay) => Overlay) {
    const key = String(caseId);
    setMap((previous) => {
      const current = previous[key] ?? blankOverlay(status, disposition);
      return { ...previous, [key]: recipe(current) };
    });
  }

  function assign(caseId: number, status: string, disposition: string | null, assignee: string) {
    update(caseId, status, disposition, (current) => ({
      ...current,
      assignee,
      audit: [
        { id: makeId(), at: stamp(), actor: assignee, action: "Assigned", detail: `Assignee set to ${assignee}.` },
        ...current.audit,
      ],
    }));
  }

  function setStatus(caseId: number, status: string, disposition: string | null, next: string, actor: string) {
    update(caseId, status, disposition, (current) => ({
      ...current,
      status: next,
      audit: [
        { id: makeId(), at: stamp(), actor, action: "Status", detail: `${current.status} → ${next}.` },
        ...current.audit,
      ],
    }));
  }

  function setDisposition(caseId: number, status: string, disposition: string | null, next: string, actor: string) {
    update(caseId, status, disposition, (current) => ({
      ...current,
      disposition: next,
      audit: [
        {
          id: makeId(),
          at: stamp(),
          actor,
          action: "Disposition",
          detail: next ? `Disposition set to ${next}.` : "Disposition cleared.",
        },
        ...current.audit,
      ],
    }));
  }

  function addNote(caseId: number, status: string, disposition: string | null, author: string, body: string) {
    const text = body.trim();
    if (!text) return;
    update(caseId, status, disposition, (current) => ({
      ...current,
      notes: [{ id: makeId(), at: stamp(), author, body: text }, ...current.notes],
      audit: [{ id: makeId(), at: stamp(), actor: author, action: "Note", detail: text }, ...current.audit],
    }));
  }

  function reset(caseId: number) {
    setMap((previous) => {
      const next = { ...previous };
      delete next[String(caseId)];
      return next;
    });
  }

  return { ready, overlayFor, assign, setStatus, setDisposition, addNote, reset };
}
