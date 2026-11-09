import { pageWindow, slicePage } from "@/lib/page";
import { sortCustomers } from "@/lib/queries";
import { data } from "@/lib/snapshot";

export function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const province = (url.searchParams.get("province") ?? "").trim().toUpperCase();
  const customers = sortCustomers(url.searchParams.get("sort") ?? undefined).filter((row) => {
    if (province && (row.profile.province ?? "").toUpperCase() !== province) return false;
    if (!q) return true;
    return `${row.name} ${row.customer_id} ${row.occupation_or_business} ${row.profile.city ?? ""}`.toLowerCase().includes(q);
  });
  const page = slicePage(customers, pageWindow({ page: url.searchParams.get("page"), pageSize: url.searchParams.get("pageSize") }));
  return Response.json({
    synthetic: true,
    asOf: data.meta.as_of,
    ...page,
    customers: page.items.map((customer) => ({
      id: customer.id,
      customer_id: customer.customer_id,
      name: customer.name,
      occupation: customer.occupation_or_business,
      province: customer.profile.province,
      residual: customer.risk.residual,
      tier: customer.risk.tier,
    })),
  });
}
