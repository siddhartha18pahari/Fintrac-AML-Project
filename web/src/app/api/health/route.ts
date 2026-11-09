import { persistenceMode } from "@/lib/case-persistence";
import { snapshotDiagnostics } from "@/lib/data-quality";
import { data } from "@/lib/snapshot";

export function GET() {
  const cases = persistenceMode(process.env.DATABASE_URL);
  const diagnostics = snapshotDiagnostics();
  const ready = diagnostics.transactions > 0 && diagnostics.customers > 0;
  return Response.json({
    ok: ready,
    ready,
    product: data.meta.product,
    version: data.meta.version,
    storage: "bundled-snapshot",
    synthetic: true,
    as_of: data.meta.as_of,
    counts: data.meta.counts,
    chat: process.env.OPENAI_API_KEY || process.env.AI_GATEWAY_API_KEY ? "model" : "deterministic",
    casePersistence: cases.mode,
    casePersistenceReason: cases.reason,
    dataQuality: diagnostics,
  });
}
