import { entityQuerySchema, queryParams } from "@/lib/studio";
import { listEntities } from "@/lib/studio-query";

export async function GET(request: Request) {
  const parsed = entityQuerySchema.safeParse(queryParams(request));
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  return Response.json(listEntities(parsed.data));
}
