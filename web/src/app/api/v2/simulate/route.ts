import { simulateRequestSchema } from "@/lib/studio";
import { runSimulation } from "@/lib/studio-query";

export async function POST(request: Request) {
  const parsed = simulateRequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  return Response.json(runSimulation(parsed.data));
}
