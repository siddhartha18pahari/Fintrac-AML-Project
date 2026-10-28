import { data } from "@/lib/snapshot";

export function GET() {
  return Response.json({ hits: data.screening_hits, list: data.meta.screening_list });
}