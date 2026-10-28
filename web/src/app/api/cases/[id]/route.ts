import { data } from "@/lib/snapshot";

export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then(({ id }) => {
    const row = data.cases.find((item) => item.id === Number(id));
    if (!row) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({
      case: row,
      alerts: data.alerts.filter((alert) => alert.case_id === row.id),
    });
  });
}
