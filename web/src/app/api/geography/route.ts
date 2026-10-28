import { data } from "@/lib/snapshot";

export function GET() {
  return Response.json(data.geography);
}
