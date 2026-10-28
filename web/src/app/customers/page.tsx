import Link from "next/link";
import type { Metadata } from "next";
import { Badge } from "@/components/Badges";
import { PageIntro, Shell } from "@/components/Shell";
import { money } from "@/lib/format";
import { sortCustomers } from "@/lib/queries";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; q?: string; province?: string }>;
}) {
  const { sort, q, province } = await searchParams;
  const query = (q ?? "").trim().toLowerCase();
  const provinceCode = (province ?? "").trim().toUpperCase();
  const rows = sortCustomers(sort).filter((row) => {
    if (provinceCode && (row.profile.province ?? "").toUpperCase() !== provinceCode) return false;
    if (!query) return true;
    return `${row.name} ${row.customer_id} ${row.occupation_or_business} ${row.profile.city ?? ""}`.toLowerCase().includes(query);
  });

  return (
    <Shell>
      <PageIntro
        kicker="Customer risk"
        title="Inherent risk, then behaviour"
        lede={provinceCode ? `Filtered to ${provinceCode}. The residual rating blends onboarding factors with the open alert score.` : "The residual rating blends onboarding factors with the open alert score. Every point on a profile names the factor that produced it."}
      />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3" role="search">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Search</span>
          <input name="q" defaultValue={q ?? ""} placeholder="Name, reference, city" className="rounded-md border border-line bg-white px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Sort</span>
          <select name="sort" defaultValue={sort ?? "residual"} className="rounded-md border border-line bg-white px-3 py-2">
            <option value="residual">Residual risk</option>
            <option value="inherent">Inherent risk</option>
            <option value="name">Name</option>
          </select>
        </label>
        <button type="submit" className="rounded-md bg-spruce px-4 py-2 text-sm font-semibold text-white">Apply</button>
      </form>
      <div className="overflow-x-auto rounded-2xl border border-line bg-card">
        <table className="min-w-full text-left text-sm">
          <caption className="sr-only">Customer risk ratings</caption>
          <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3" scope="col">Customer</th>
              <th className="px-4 py-3" scope="col">Activity</th>
              <th className="px-4 py-3" scope="col">Declared</th>
              <th className="px-4 py-3" scope="col">Inherent</th>
              <th className="px-4 py-3" scope="col">Behaviour</th>
              <th className="px-4 py-3" scope="col">Residual</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((customer) => (
              <tr key={customer.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3">
                  <Link href={`/customers/${customer.id}`} className="font-semibold hover:underline">{customer.name}</Link>
                  <p className="text-xs text-muted">{customer.customer_id} · {customer.profile.city}, {customer.profile.province}</p>
                </td>
                <td className="px-4 py-3">{customer.occupation_or_business}</td>
                <td className="num px-4 py-3">{money(customer.expected_monthly_volume_cad)}</td>
                <td className="num px-4 py-3">{customer.risk.inherent}</td>
                <td className="num px-4 py-3">{customer.risk.behavioural}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="num font-semibold">{customer.risk.residual}</span>
                    <Badge value={customer.risk.tier} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
