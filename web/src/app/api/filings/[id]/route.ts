import { data } from "@/lib/snapshot";

export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then(({ id }) => {
    const filing = data.filings.find((item) => item.id === id);
    if (!filing) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(filing);
  });
}
