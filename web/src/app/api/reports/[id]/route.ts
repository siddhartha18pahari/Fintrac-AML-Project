import { reportByCaseId } from "@/lib/snapshot";

export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then(({ id }) => {
    const report = reportByCaseId(Number(id));
    if (!report) return Response.json({ error: "report not found" }, { status: 404 });
    return Response.json(report);
  });
}
