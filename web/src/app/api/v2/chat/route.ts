import { runTurn } from "@/lib/agent";
import { chatRequestSchema } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = chatRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "A message is required.", issues: parsed.error.flatten() }, { status: 400 });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        await runTurn(parsed.data.message, parsed.data.history, send);
      } catch {
        send({ type: "error", message: "The copilot could not finish that turn." });
      }
      send({ type: "done" });
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
