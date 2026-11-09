import type { Metadata } from "next";
import { AlertTable } from "@/components/AlertTable";
import { listHref, Pager } from "@/components/Pager";
import { PageIntro, Shell } from "@/components/Shell";
import { formatValue, observedEntries } from "@/lib/format";
import { pageWindow, slicePage } from "@/lib/page";
import { filterAlerts, ruleOptions } from "@/lib/queries";
import { queuePath } from "@/lib/return-to";

export const metadata: Metadata = { title: "Alerts" };

type Search = { q?: string; severity?: string; rule?: string; page?: string };

export default async function AlertsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const filters = await searchParams;
  const rows = filterAlerts(filters);
  const window = pageWindow({ page: filters.page });
  const paged = slicePage(rows, window);
  const rules = ruleOptions();
  const queue = queuePath(filters);

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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-muted">{paged.total} alert{paged.total === 1 ? "" : "s"} in the snapshot. This page shows {paged.items.length}.</p>
        <a className="btn btn-secondary" href={`/api/alerts?format=csv${filters.q ? `&q=${encodeURIComponent(filters.q)}` : ""}${filters.severity ? `&severity=${encodeURIComponent(filters.severity)}` : ""}${filters.rule ? `&rule=${encodeURIComponent(filters.rule)}` : ""}`}>Export CSV</a>
      </div>
      <AlertTable
        queue={queue}
        rows={paged.items.map((alert) => ({
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
      <Pager
        page={paged.page}
        pages={paged.pages}
        total={paged.total}
        hrefFor={(page) => listHref("/alerts", { q: filters.q, severity: filters.severity, rule: filters.rule }, page)}
      />
    </Shell>
  );
}
