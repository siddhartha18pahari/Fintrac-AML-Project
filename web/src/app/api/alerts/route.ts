import { filterAlerts } from "@/lib/queries";

export function GET(request: Request) {
  const url = new URL(request.url);
  const alerts = filterAlerts({
    q: url.searchParams.get("q") ?? undefined,
    severity: url.searchParams.get("severity") ?? undefined,
    rule: url.searchParams.get("rule") ?? undefined,
  });
  return Response.json({ total: alerts.length, alerts });
}
