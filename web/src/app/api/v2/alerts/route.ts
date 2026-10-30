import { alertQuerySchema, queryParams } from "@/lib/studio";
import { listAlerts } from "@/lib/studio-query";

export async function GET(request: Request) {
  const parsed = alertQuerySchema.safeParse(queryParams(request));
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  return Response.json(listAlerts(parsed.data));
}
