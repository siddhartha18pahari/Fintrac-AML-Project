import { sortCustomers } from "@/lib/queries";

export function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const customers = sortCustomers(url.searchParams.get("sort") ?? undefined).filter((row) => {
    if (!q) return true;
    return `${row.name} ${row.customer_id} ${row.occupation_or_business}`.toLowerCase().includes(q);
  });
  return Response.json({ total: customers.length, customers });
}
