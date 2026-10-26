import { data } from "@/lib/snapshot";

export function GET() {
  return Response.json({
    nodes: data.network.nodes,
    edges: data.network.edges,
    links: data.links,
  });
}
