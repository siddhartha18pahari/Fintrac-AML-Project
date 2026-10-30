"use client";

import { useEffect, useState } from "react";

export const ASSIGNEES = ["Unassigned", "J. Okafor", "S. Rahman", "L. Chen", "D. Vasquez"] as const;
export const ACTORS = ["J. Okafor", "S. Rahman", "L. Chen", "D. Vasquez"] as const;
export const APPROVERS = ["L. Chen", "D. Vasquez"] as const;

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
export type AuditEntry = { id: string; at: string; actor: string; action: string; detail: string; hash?: string; prev?: string };
export type Evidence = {
  id: string;
  at: string;
  author: string;
  name: string;
  mime: string;
  size: number;
  note: string;
  preview: string | null;
};
export type Pin = { id: string; kind: string; ref: string; label: string; detail: string; x: number; y: number };
export type Approval = {
  status: "none" | "pending" | "approved" | "rejected";
  requestedBy: string;
  decidedBy: string;
  reason: string;
  at: string;
};

export type Overlay = {
  assignee: string;
  status: string;
  disposition: string;
  notes: Note[];
  audit: AuditEntry[];
  evidence: Evidence[];
  pins: Pin[];
  approval: Approval;
  chain: string;
};

const ACTOR_KEY = "sentinel-actor";

function storageKey(namespace: string) {
  return `sentinel-workspace:${namespace}`;
}

function stamp() {
  return new Date().toISOString();
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function chainHash(previous: string, payload: string) {
  let hash = 2166136261;
  const text = `${previous}|${payload}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function blankApproval(): Approval {
  return { status: "none", requestedBy: "", decidedBy: "", reason: "", at: "" };
}

export function blankOverlay(status: string, disposition: string | null): Overlay {
  return {
    assignee: "Unassigned",
    status,
    disposition: disposition ?? "",
    notes: [],
    audit: [],
    evidence: [],
    pins: [],
    approval: blankApproval(),
    chain: "genesis",
  };
}

function hydrate(raw: Partial<Overlay> | undefined, status: string, disposition: string | null): Overlay {
  const blank = blankOverlay(status, disposition);
  if (!raw) return blank;
  return {
    ...blank,
    ...raw,
    notes: Array.isArray(raw.notes) ? raw.notes : [],
    audit: Array.isArray(raw.audit) ? raw.audit : [],
    evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
    pins: Array.isArray(raw.pins) ? raw.pins : [],
    approval: { ...blank.approval, ...(raw.approval ?? {}) },
    chain: raw.chain || blank.chain,
  };
}

function withAudit(current: Overlay, actor: string, action: string, detail: string): Overlay {
  const prev = current.chain || "genesis";
  const at = stamp();
  const id = makeId();
  const hash = chainHash(prev, `${id}|${at}|${actor}|${action}|${detail}`);
  return {
    ...current,
    chain: hash,
    audit: [{ id, at, actor, action, detail, hash, prev }, ...current.audit],
  };
}

export function useWorkspace(namespace: string) {
  const [map, setMap] = useState<Record<string, Overlay>>({});
  const [ready, setReady] = useState(false);
  const [actor, setActorState] = useState<string>("J. Okafor");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(namespace));
      if (raw) setMap(JSON.parse(raw) as Record<string, Overlay>);
      const saved = localStorage.getItem(ACTOR_KEY);
      if (saved && (ACTORS as readonly string[]).includes(saved)) setActorState(saved);
    } catch {
      setMap({});
    }
    setReady(true);
  }, [namespace]);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(storageKey(namespace), JSON.stringify(map));
  }, [map, namespace, ready]);

  function setActor(next: string) {
    setActorState(next);
    localStorage.setItem(ACTOR_KEY, next);
  }

  function overlayFor(caseId: number, status: string, disposition: string | null): Overlay {
    return hydrate(map[String(caseId)], status, disposition);
  }

  function update(caseId: number, status: string, disposition: string | null, recipe: (current: Overlay) => Overlay) {
    const key = String(caseId);
    setMap((previous) => {
      const current = hydrate(previous[key], status, disposition);
      return { ...previous, [key]: recipe(current) };
    });
  }

  function assign(caseId: number, status: string, disposition: string | null, assignee: string) {
    update(caseId, status, disposition, (current) =>
      withAudit({ ...current, assignee }, actor, "Assigned", `Assignee set to ${assignee}.`),
    );
  }

  function setStatus(caseId: number, status: string, disposition: string | null, next: string) {
    if (next === "APPROVED") {
      setNotice("Approval is a second pair of eyes. Use the four-eyes panel.");
      return;
    }
    setNotice("");
    update(caseId, status, disposition, (current) =>
      withAudit({ ...current, status: next }, actor, "Status", `${current.status} → ${next}.`),
    );
  }

  function setDisposition(caseId: number, status: string, disposition: string | null, next: string) {
    update(caseId, status, disposition, (current) =>
      withAudit(
        { ...current, disposition: next },
        actor,
        "Disposition",
        next ? `Disposition set to ${next}.` : "Disposition cleared.",
      ),
    );
  }

  function addNote(caseId: number, status: string, disposition: string | null, body: string) {
    const text = body.trim();
    if (!text) return;
    update(caseId, status, disposition, (current) => {
      const noted = {
        ...current,
        notes: [{ id: makeId(), at: stamp(), author: actor, body: text }, ...current.notes],
      };
      return withAudit(noted, actor, "Note", text);
    });
  }

  function addEvidence(caseId: number, status: string, disposition: string | null, file: Evidence) {
    update(caseId, status, disposition, (current) =>
      withAudit({ ...current, evidence: [file, ...current.evidence] }, actor, "Evidence", `Attached ${file.name} (${file.size} bytes).`),
    );
  }

  function removeEvidence(caseId: number, status: string, disposition: string | null, evidenceId: string) {
    update(caseId, status, disposition, (current) => {
      const target = current.evidence.find((item) => item.id === evidenceId);
      return withAudit(
        { ...current, evidence: current.evidence.filter((item) => item.id !== evidenceId) },
        actor,
        "Evidence",
        `Removed ${target?.name ?? "an attachment"}.`,
      );
    });
  }

  function setPins(caseId: number, status: string, disposition: string | null, pins: Pin[]) {
    update(caseId, status, disposition, (current) => ({ ...current, pins }));
  }

  function requestApproval(caseId: number, status: string, disposition: string | null) {
    if (actor === "Unassigned") {
      setNotice("Choose who is acting before requesting approval.");
      return;
    }
    setNotice("");
    update(caseId, status, disposition, (current) =>
      withAudit(
        {
          ...current,
          status: "ESCALATED",
          approval: { status: "pending", requestedBy: actor, decidedBy: "", reason: "", at: stamp() },
        },
        actor,
        "Four-eyes",
        `${actor} requested a second review.`,
      ),
    );
  }

  function decideApproval(caseId: number, status: string, disposition: string | null, decision: "approved" | "rejected", reason: string) {
    const current = overlayFor(caseId, status, disposition);
    if (current.approval.status !== "pending") {
      setNotice("Nothing is waiting for a second pair of eyes.");
      return;
    }
    if (actor === current.approval.requestedBy) {
      setNotice("Four-eyes: the person who requested approval cannot approve it.");
      return;
    }
    if (!(APPROVERS as readonly string[]).includes(actor)) {
      setNotice("Only L. Chen or D. Vasquez can record the second review.");
      return;
    }
    const text = reason.trim();
    if (text.length < 8) {
      setNotice("Write a short reason. Eight characters is enough to show it was read.");
      return;
    }
    setNotice("");
    update(caseId, status, disposition, (overlay) =>
      withAudit(
        {
          ...overlay,
          status: decision === "approved" ? "APPROVED" : "UNDER_REVIEW",
          approval: {
            status: decision,
            requestedBy: overlay.approval.requestedBy,
            decidedBy: actor,
            reason: text,
            at: stamp(),
          },
        },
        actor,
        "Four-eyes",
        `${actor} ${decision} the request from ${overlay.approval.requestedBy}. ${text}`,
      ),
    );
  }

  function reset(caseId: number) {
    setMap((previous) => {
      const next = { ...previous };
      delete next[String(caseId)];
      return next;
    });
    setNotice("");
  }

  return {
    ready,
    actor,
    setActor,
    notice,
    overlayFor,
    assign,
    setStatus,
    setDisposition,
    addNote,
    addEvidence,
    removeEvidence,
    setPins,
    requestApproval,
    decideApproval,
    reset,
  };
}
