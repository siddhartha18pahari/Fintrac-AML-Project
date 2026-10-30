import { graphQuerySchema } from "@/lib/studio";
import { graphQuery } from "@/lib/studio-query";

export async function POST(request: Request) {
  const parsed = graphQuerySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  return Response.json(graphQuery(parsed.data));
}
