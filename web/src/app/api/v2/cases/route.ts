import { caseQuerySchema, queryParams } from "@/lib/studio";
import { listCases } from "@/lib/studio-query";

export async function GET(request: Request) {
  const parsed = caseQuerySchema.safeParse(queryParams(request));
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  return Response.json(listCases(parsed.data));
}
