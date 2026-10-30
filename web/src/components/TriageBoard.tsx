"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/Badges";
import { alertDeadline, caseDeadline, formatRemaining } from "@/lib/sla";
import { useWorkspace } from "@/lib/workspace-store";

type CaseRow = {
  id: number;
  reference: string;
  customer_id: number;
  customer_name: string | null;
  status: string;
  risk_tier: string;
  risk_score: number;
  due_at: string | null;
  disposition: string | null;
};

type AlertRow = {
  id: number;
  case_id: number | null;
  customer_id: number;
  customer_name: string | null;
  title: string;
  severity: string;
  rule_id: string;
  occurred_at: string;
};

type Item = {
  key: string;
  href: string;
  label: string;
  subject: string;
  customerId: number;
  tier: string;
  deadline: string;
  caseId: number | null;
  snapshotStatus: string;
  snapshotDisposition: string | null;
};

export function TriageBoard({
  namespace,
  asOf,
  cases,
  alerts,
}: {
  namespace: string;
  asOf: string;
  cases: CaseRow[];
  alerts: AlertRow[];
}) {
  const workspace = useWorkspace(namespace);
  const [filter, setFilter] = useState<"all" | "breached" | "inside" | "unassigned" | "approval">("all");
  const [layout, setLayout] = useState<"table" | "lanes">("lanes");
  const items = useMemo<Item[]>(() => {
    const caseItems: Item[] = cases.map((row) => ({
      key: `case-${row.id}`,
      href: `/cases/${row.id}`,
      label: row.reference,
      subject: row.customer_name ?? "Customer",
      customerId: row.customer_id,
      tier: row.risk_tier,
      deadline: caseDeadline(row, alerts, asOf),
      caseId: row.id,
      snapshotStatus: row.status,
      snapshotDisposition: row.disposition,
    }));
    const alertItems: Item[] = alerts
      .filter((alert) => alert.case_id == null && alert.severity.toLowerCase() !== "low")
      .map((alert) => ({
        key: `alert-${alert.id}`,
        href: `/alerts/${alert.id}`,
        label: alert.rule_id,
        subject: alert.customer_name ?? alert.title,
        customerId: alert.customer_id,
        tier: alert.severity,
        deadline: alertDeadline(alert),
        caseId: null,
        snapshotStatus: "NEW",
        snapshotDisposition: null,
      }));
    return [...caseItems, ...alertItems].sort((left, right) => {
      const a = formatRemaining(left.deadline, asOf).ms;
      const b = formatRemaining(right.deadline, asOf).ms;
      return a - b;
    });
  }, [alerts, asOf, cases]);

  const decorated = items.map((item) => {
    const clock = formatRemaining(item.deadline, asOf);
    const overlay = item.caseId == null ? null : workspace.overlayFor(item.caseId, item.snapshotStatus, item.snapshotDisposition);
    return {
      ...item,
      clock,
      assignee: overlay?.assignee ?? "Unassigned",
      status: overlay?.status ?? item.snapshotStatus,
      approval: overlay?.approval.status ?? "none",
    };
  });
  const visible = decorated.filter((item) => {
    if (filter === "breached") return item.clock.breached;
    if (filter === "inside") return !item.clock.breached;
    if (filter === "unassigned") return item.assignee === "Unassigned";
    if (filter === "approval") return item.approval === "pending";
    return true;
  });
  const breached = decorated.filter((item) => item.clock.breached).length;

  return (
    <div>
      <p className="mb-4 text-sm text-muted">
        Timers use the snapshot clock {asOf.replace("T", " ").slice(0, 16)} UTC, so the queue is stable. A reporting case uses its filing due date. Anything else is measured from the latest evidence.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter the queue">
        {(
          [
            ["all", `All ${decorated.length}`],
            ["breached", `Over SLA ${breached}`],
            ["inside", "Inside SLA"],
            ["unassigned", "Unassigned"],
            ["approval", `Four-eyes ${decorated.filter((item) => item.approval === "pending").length}`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${filter === value ? "bg-spruce text-white" : "border border-line bg-card"}`}
          >
            {label}
          </button>
        ))}
        <span className="mx-1 hidden h-6 w-px bg-line sm:inline-block" aria-hidden="true" />
        {(["lanes", "table"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={layout === value}
            onClick={() => setLayout(value)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${layout === value ? "bg-brass text-ink" : "border border-line bg-card"}`}
          >
            {value === "lanes" ? "Lanes" : "Table"}
          </button>
        ))}
      </div>
      {layout === "lanes" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {["NEW", "TRIAGE", "UNDER_REVIEW", "ESCALATED", "DECISION", "APPROVED"].map((column) => {
            const lane = visible.filter((item) => item.status === column || (column === "NEW" && item.caseId == null && item.status === "NEW"));
            return (
              <section key={column} className="rounded-2xl border border-line bg-card/80 p-3">
                <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{column.replaceAll("_", " ")} · {lane.length}</h2>
                <ul className="mt-2 space-y-2">
                  {lane.slice(0, 8).map((item) => (
                    <li key={item.key} className="rounded-xl border border-line bg-paper/70 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Link href={item.href} className="text-sm font-semibold hover:underline">{item.label}</Link>
                        <span className={`num text-xs font-semibold ${item.clock.breached ? "text-critical" : "text-low"}`}>{item.clock.text}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted">{item.subject}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Badge value={item.tier} />
                        {item.approval === "pending" ? <Badge value="Four-eyes" tone="HIGH" /> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      ) : null}
      {layout === "table" ? (
      <div className="overflow-x-auto rounded-2xl border border-line bg-card">
        <table className="min-w-full text-left text-sm">
          <caption className="sr-only">Triage queue with SLA timers</caption>
          <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3" scope="col">SLA</th>
              <th className="px-4 py-3" scope="col">Subject</th>
              <th className="px-4 py-3" scope="col">Item</th>
              <th className="px-4 py-3" scope="col">Tier</th>
              <th className="px-4 py-3" scope="col">Assignee</th>
              <th className="px-4 py-3" scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr key={item.key} className="border-b border-line last:border-0">
                <td className="px-4 py-3">
                  <span className={`num font-semibold ${item.clock.breached ? "text-critical" : "text-low"}`}>{item.clock.text}</span>
                  <span className="sr-only">{item.clock.breached ? "Past the SLA." : "Inside the SLA."}</span>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/customers/${item.customerId}`} className="font-semibold hover:underline">{item.subject}</Link>
                </td>
                <td className="px-4 py-3">
                  <Link href={item.href} className="hover:underline">{item.label}</Link>
                </td>
                <td className="px-4 py-3"><Badge value={item.tier} /></td>
                <td className="px-4 py-3">{item.assignee}</td>
                <td className="px-4 py-3">
                  {item.status.replaceAll("_", " ")}
                  {item.approval === "pending" ? <span className="ml-2 text-xs font-semibold text-high">four-eyes</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      ) : null}
      {visible.length === 0 ? <p className="mt-3 text-sm text-muted">Nothing in this filter.</p> : null}
    </div>
  );
}
