import { bookStatistics } from "@/lib/book-statistics";
import { computeStats } from "@/lib/studio-query";

export async function GET(request: Request) {
  const metric = new URL(request.url).searchParams.get("metric") ?? "overview";
  if (metric === "full") return Response.json(bookStatistics());
  return Response.json(computeStats(metric));
}
