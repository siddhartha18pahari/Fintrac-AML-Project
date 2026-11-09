import { toCsv } from "@/lib/csv";
import { pageWindow, slicePage } from "@/lib/page";
import { filterAlerts } from "@/lib/queries";
import { data } from "@/lib/snapshot";

export function GET(request: Request) {
  const url = new URL(request.url);
  const alerts = filterAlerts({
    q: url.searchParams.get("q") ?? undefined,
    severity: url.searchParams.get("severity") ?? undefined,
    rule: url.searchParams.get("rule") ?? undefined,
  });
  if (url.searchParams.get("format") === "csv") {
    const limited = alerts.slice(0, 2000);
    const csv = toCsv(
      ["id", "rule_id", "rule_version", "severity", "customer_id", "customer_name", "title", "occurred_at", "case_id"],
      limited.map((alert) => [
        alert.id,
        alert.rule_id,
        alert.rule_version,
        alert.severity,
        alert.customer_id,
        alert.customer_name,
        alert.title,
        alert.occurred_at,
        alert.case_id,
      ]),
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sentinel-alerts-${data.meta.as_of.slice(0, 10)}.csv"`,
        "X-Synthetic": "true",
      },
    });
  }
  const window = pageWindow({ page: url.searchParams.get("page"), pageSize: url.searchParams.get("pageSize") });
  const page = slicePage(alerts, window);
  return Response.json({
    synthetic: true,
    asOf: data.meta.as_of,
    ...page,
    alerts: page.items,
  });
}
