import { entityDetail } from "@/lib/studio-query";

type Params = { id: string };

export async function GET(_request: Request, context: { params: Promise<Params> }) {
  const { id } = await context.params;
  const detail = entityDetail(decodeURIComponent(id));
  if (!detail) return Response.json({ error: "No entity matched that id." }, { status: 404 });
  return Response.json(detail);
}
