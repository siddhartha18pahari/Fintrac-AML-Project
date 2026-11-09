import { z } from "zod";

/**
 * Case working files are durable only in Postgres.
 * A missing URL, or any non-Postgres URL, stays in the browser demo.
 * SQLite files and memory databases are refused: they do not survive a Vercel instance.
 */

export type PersistenceMode = "demo-browser" | "postgres";

const noteSchema = z.object({
  id: z.string().max(48),
  at: z.string().max(40),
  author: z.string().max(80),
  body: z.string().max(4000),
});

const evidenceSchema = z.object({
  id: z.string().max(48),
  at: z.string().max(40),
  author: z.string().max(80),
  name: z.string().max(180),
  mime: z.string().max(120),
  size: z.number().int().nonnegative().max(5_000_000),
  note: z.string().max(2000).default(""),
  preview: z.string().max(2_000_000).nullable().optional(),
});

const approvalSchema = z.object({
  status: z.enum(["none", "pending", "approved", "rejected"]),
  requestedBy: z.string().max(80).default(""),
  decidedBy: z.string().max(80).default(""),
  reason: z.string().max(2000).default(""),
  at: z.string().max(40).default(""),
});

export const workspaceBodySchema = z.object({
  assignee: z.string().max(80).default("Unassigned"),
  status: z.string().max(40),
  disposition: z.string().max(40).default(""),
  notes: z.array(noteSchema).max(80).default([]),
  evidence: z.array(evidenceSchema).max(20).default([]),
  pins: z.array(z.object({
    id: z.string().max(48),
    kind: z.string().max(40),
    ref: z.string().max(80),
    label: z.string().max(160),
    detail: z.string().max(500).default(""),
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
  })).max(40).default([]),
  approval: approvalSchema.default({ status: "none", requestedBy: "", decidedBy: "", reason: "", at: "" }),
});

export type WorkspaceBody = z.infer<typeof workspaceBodySchema>;

export function persistenceMode(databaseUrl: string | undefined | null): { mode: PersistenceMode; reason: string } {
  const url = (databaseUrl ?? "").trim();
  if (!url) {
    return {
      mode: "demo-browser",
      reason: "DATABASE_URL is unset. Notes, evidence names and approvals stay in this browser. They are not a durable record.",
    };
  }
  if (/^postgres(ql)?:\/\//i.test(url)) {
    return {
      mode: "postgres",
      reason: "The working file is stored in Postgres. Four-eyes approval is not stored, because this server has no signed-in reviewer.",
    };
  }
  return {
    mode: "demo-browser",
    reason: "DATABASE_URL is not a Postgres URL. File and memory databases are not used as durable storage, so the working file stays in this browser.",
  };
}

function withoutPreviews(input: unknown) {
  if (!input || typeof input !== "object") return { value: input, strippedPreviews: 0 };
  const body = input as { evidence?: unknown };
  if (!Array.isArray(body.evidence)) return { value: input, strippedPreviews: 0 };
  let strippedPreviews = 0;
  const evidence = body.evidence.map((item) => {
    if (!item || typeof item !== "object") return item;
    const row = item as { preview?: unknown };
    if (row.preview) strippedPreviews += 1;
    return { ...row, preview: null };
  });
  return { value: { ...body, evidence }, strippedPreviews };
}

export function acceptWorkspace(input: unknown):
  | { ok: true; record: WorkspaceBody; strippedPreviews: number }
  | { ok: false; status: number; code: string; message: string } {
  const prepared = withoutPreviews(input);
  const parsed = workspaceBodySchema.safeParse(prepared.value);
  if (!parsed.success) {
    return { ok: false, status: 400, code: "invalid_workspace", message: "The working file did not match the expected shape or was too large." };
  }
  if (parsed.data.status === "APPROVED" || parsed.data.approval.status === "approved" || parsed.data.approval.status === "rejected") {
    return {
      ok: false,
      status: 403,
      code: "approval_unauthenticated",
      message: "Four-eyes approval needs a signed-in reviewer. Choosing a name in the browser does not authenticate anyone, so that decision is not stored.",
    };
  }
  const record: WorkspaceBody = parsed.data;
  if (JSON.stringify(record).length > 48_000) {
    return { ok: false, status: 413, code: "workspace_too_large", message: "The working file is over 48 KB after previews are removed." };
  }
  return { ok: true, record, strippedPreviews: prepared.strippedPreviews };
}

export const WORKSPACE_DDL = `
CREATE TABLE IF NOT EXISTS sentinel_case_workspace (
  case_id integer PRIMARY KEY,
  snapshot_as_of text NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
)`;

export const WORKSPACE_UPSERT = `
INSERT INTO sentinel_case_workspace (case_id, snapshot_as_of, payload, updated_at)
VALUES ($1, $2, $3::jsonb, now())
ON CONFLICT (case_id) DO UPDATE
SET snapshot_as_of = EXCLUDED.snapshot_as_of,
    payload = EXCLUDED.payload,
    updated_at = now()`;
