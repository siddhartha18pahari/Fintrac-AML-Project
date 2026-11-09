import { toCsv } from "@/lib/csv";
import { pageWindow, slicePage } from "@/lib/page";
import { filterTransactions } from "@/lib/queries";
import { data } from "@/lib/snapshot";

export function GET(request: Request) {
  const url = new URL(request.url);
  const min = url.searchParams.get("min");
  if (min && min.trim() && Number.isNaN(Number(min))) {
    return Response.json({ error: { code: "invalid_min", message: "min must be a number of Canadian dollars." } }, { status: 400 });
  }
  const transactions = filterTransactions({
    q: url.searchParams.get("q") ?? undefined,
    instrument: url.searchParams.get("instrument") ?? undefined,
    direction: url.searchParams.get("direction") ?? undefined,
    min: min ?? undefined,
  });
  if (url.searchParams.get("format") === "csv") {
    const limited = transactions.slice(0, 2000);
    const csv = toCsv(
      ["id", "transaction_id", "customer_id", "customer_name", "occurred_at", "direction", "instrument", "asset", "cad_value", "scenario"],
      limited.map((txn) => [
        txn.id,
        txn.transaction_id,
        txn.customer_id,
        txn.customer_name,
        txn.occurred_at,
        txn.direction,
        txn.instrument,
        txn.asset,
        txn.cad_value,
        txn.scenario,
      ]),
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sentinel-transactions-${data.meta.as_of.slice(0, 10)}.csv"`,
        "X-Synthetic": "true",
      },
    });
  }
  const window = pageWindow({ page: url.searchParams.get("page"), pageSize: url.searchParams.get("pageSize") });
  const page = slicePage(transactions, window);
  return Response.json({
    synthetic: true,
    asOf: data.meta.as_of,
    ...page,
    transactions: page.items,
  });
}
