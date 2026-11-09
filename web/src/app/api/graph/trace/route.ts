import { traceFunds } from "@/lib/trace-funds";

export function GET(request: Request) {
  const url = new URL(request.url);
  const from = (url.searchParams.get("from") ?? "").trim();
  const to = (url.searchParams.get("to") ?? "").trim();
  if (!from || !to || from.length > 120 || to.length > 120) {
    return Response.json(
      { error: { code: "invalid_trace", message: "Provide from and to names, each under 120 characters." } },
      { status: 400 },
    );
  }
  return Response.json(traceFunds(from, to));
}
