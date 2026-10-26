import { filterTransactions } from "@/lib/queries";

export function GET(request: Request) {
  const url = new URL(request.url);
  const transactions = filterTransactions({
    q: url.searchParams.get("q") ?? undefined,
    instrument: url.searchParams.get("instrument") ?? undefined,
    direction: url.searchParams.get("direction") ?? undefined,
    min: url.searchParams.get("min") ?? undefined,
  });
  return Response.json({ total: transactions.length, transactions });
}
