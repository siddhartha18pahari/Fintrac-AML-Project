import { data } from "@/lib/snapshot";

export function GET() {
  return Response.json({
    meta: data.meta,
    kpis: data.kpis,
    series: data.series,
    scenarios: data.scenarios,
  });
}
