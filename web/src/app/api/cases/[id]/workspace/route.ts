import { readCaseWorkspace, writeCaseWorkspace } from "@/lib/case-db";
import { acceptWorkspace, persistenceMode } from "@/lib/case-persistence";
import { data } from "@/lib/snapshot";

function caseId(value: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) return null;
  return data.cases.some((row) => row.id === id) ? id : null;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const resolved = caseId(id);
  if (!resolved) return Response.json({ error: { code: "not_found", message: "That case is not in this snapshot." } }, { status: 404 });
  const mode = persistenceMode(process.env.DATABASE_URL);
  if (mode.mode === "demo-browser") {
    return Response.json({ persistence: mode.mode, reason: mode.reason, record: null, approval: "simulated-in-browser" });
  }
  try {
    const stored = await readCaseWorkspace(resolved);
    return Response.json({
      persistence: "postgres",
      reason: mode.reason,
      record: stored?.payload ?? null,
      updatedAt: stored?.updatedAt ?? null,
      approval: "not-stored-without-identity",
    });
  } catch {
    return Response.json(
      { error: { code: "workspace_unavailable", message: "Postgres did not answer. The working file was not read." } },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const resolved = caseId(id);
  if (!resolved) return Response.json({ error: { code: "not_found", message: "That case is not in this snapshot." } }, { status: 404 });
  const mode = persistenceMode(process.env.DATABASE_URL);
  if (mode.mode === "demo-browser") {
    return Response.json(
      { error: { code: "demo_browser", message: mode.reason } },
      { status: 409 },
    );
  }
  const body = await request.json().catch(() => null);
  const accepted = acceptWorkspace(body);
  if (!accepted.ok) {
    return Response.json({ error: { code: accepted.code, message: accepted.message } }, { status: accepted.status });
  }
  try {
    await writeCaseWorkspace(resolved, data.meta.as_of, accepted.record);
    return Response.json({
      persistence: "postgres",
      stored: true,
      strippedPreviews: accepted.strippedPreviews,
      approval: "not-stored-without-identity",
    });
  } catch {
    return Response.json(
      { error: { code: "workspace_unavailable", message: "Postgres did not accept the working file." } },
      { status: 503 },
    );
  }
}
