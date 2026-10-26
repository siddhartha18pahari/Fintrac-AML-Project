import { data } from "@/lib/snapshot";

export function GET() {
  return Response.json({
    ok: true,
    product: data.meta.product,
    version: data.meta.version,
    storage: "bundled-snapshot",
    synthetic: true,
    as_of: data.meta.as_of,
    counts: data.meta.counts,
  });
}
