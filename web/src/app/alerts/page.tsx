import Link from "next/link";
import type { Metadata } from "next";
import { Badge } from "@/components/Badges";
import { PageIntro, Shell } from "@/components/Shell";
import { when } from "@/lib/format";
import { filterAlerts, ruleOptions } from "@/lib/queries";

export const metadata: Metadata = { title: "Alerts" };

type Search = { q?: string; severity?: string; rule?: string };

export default async function AlertsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const filters = await searchParams;
  const rows = filterAlerts(filters);
  const rules = ruleOptions();

  return (
    <Shell>
      <PageIntro
        kicker="Alert queue"
        title="What the rules returned"
        lede="Each row is one indicator or one reporting observation, with the evidence attached. Filter the queue, then open a row to see observed against threshold."
      />
      <form method="get" className="mb-4 grid gap-3 rounded-2xl border border-line bg-card p-4 sm:grid-cols-[1fr_160px_180px_auto]" role="search">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Search</span>
          <input
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder="Customer, rule, or detail"
            className="w-full rounded-md border border-line bg-white px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Severity</span>
          <select name="severity" defaultValue={filters.severity ?? ""} className="w-full rounded-md border border-line bg-white px-3 py-2">
            <option value="">Any</option>
            <option value="reporting">Reporting</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Rule</span>
          <select name="rule" defaultValue={filters.rule ?? ""} className="w-full rounded-md border border-line bg-white px-3 py-2">
            <option value="">Any</option>
            {rules.map((rule) => (
              <option key={rule} value={rule}>{rule}</option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button type="submit" className="rounded-md bg-spruce px-4 py-2 text-sm font-semibold text-white">Apply</button>
        </div>
      </form>
      <p className="mb-3 text-sm text-muted">{rows.length} alert{rows.length === 1 ? "" : "s"}</p>
      <div className="overflow-x-auto rounded-2xl border border-line bg-card">
        <table className="min-w-full text-left text-sm">
          <caption className="sr-only">Filtered alerts</caption>
          <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3 font-semibold" scope="col">Alert</th>
              <th className="px-4 py-3 font-semibold" scope="col">Customer</th>
              <th className="px-4 py-3 font-semibold" scope="col">Rule</th>
              <th className="px-4 py-3 font-semibold" scope="col">When</th>
              <th className="px-4 py-3 font-semibold" scope="col">Points</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-muted">No alerts match these filters.</td>
              </tr>
            ) : (
              rows.map((alert) => (
                <tr key={alert.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/alerts/${alert.id}`} className="font-semibold hover:underline">{alert.title}</Link>
                    <div className="mt-1"><Badge value={alert.severity} /></div>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/customers/${alert.customer_id}`} className="hover:underline">{alert.customer_name}</Link>
                  </td>
                  <td className="num px-4 py-3">{alert.rule_id}</td>
                  <td className="num px-4 py-3 whitespace-nowrap">{when(alert.occurred_at)}</td>
                  <td className="num px-4 py-3">{alert.score_contribution}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
