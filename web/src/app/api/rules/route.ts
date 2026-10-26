import { data } from "@/lib/snapshot";

export function GET(request: Request) {
  const all = new URL(request.url).searchParams.get("all") === "1";
  const rules = all ? data.rules : data.rules.filter((rule) => rule.in_force);
  return Response.json({ catalogue_version: data.meta.catalogue_version, total: rules.length, rules });
}
