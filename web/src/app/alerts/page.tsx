import type { Metadata } from "next";
import { AlertTable } from "@/components/AlertTable";
import { PageIntro, Shell } from "@/components/Shell";
import { formatValue, observedEntries } from "@/lib/format";
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
      <form method="get" className="panel glass mb-4 grid gap-3 p-4 sm:grid-cols-[1fr_160px_180px_auto]" role="search">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Search</span>
          <input
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder="Customer, rule, or detail"
            className="field"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Severity</span>
          <select name="severity" defaultValue={filters.severity ?? ""} className="field">
            <option value="">Any</option>
            <option value="reporting">Reporting</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Rule</span>
          <select name="rule" defaultValue={filters.rule ?? ""} className="field">
            <option value="">Any</option>
            {rules.map((rule) => (
              <option key={rule} value={rule}>{rule}</option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button type="submit" className="rounded-full bg-spruce px-4 py-2 text-sm font-semibold text-white">Apply</button>
        </div>
      </form>
      <p className="mb-3 text-sm text-muted">{rows.length} alert{rows.length === 1 ? "" : "s"}</p>
      <AlertTable
        rows={rows.map((alert) => ({
          id: alert.id,
          title: alert.title,
          severity: alert.severity,
          customerId: alert.customer_id,
          customerName: alert.customer_name,
          ruleId: alert.rule_id,
          occurredAt: alert.occurred_at,
          score: alert.score_contribution,
          detail: alert.explanation.detail,
          observed: observedEntries(alert.explanation.observed)
            .filter(([, value]) => !(Array.isArray(value) && value.length === 0))
            .slice(0, 5)
            .map(([key, value]) => [key.replaceAll("_", " "), formatValue(value).slice(0, 180)] as [string, string]),
        }))}
      />
    </Shell>
  );
}
