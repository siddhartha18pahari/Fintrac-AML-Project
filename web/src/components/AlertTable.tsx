"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/Badges";
import { SlideOver } from "@/components/SlideOver";
import { when } from "@/lib/format";

export type AlertPreview = {
  id: number;
  title: string;
  severity: string;
  customerId: number;
  customerName: string;
  ruleId: string;
  occurredAt: string;
  score: number;
  detail: string;
  observed: [string, string][];
};

export function AlertTable({ rows }: { rows: AlertPreview[] }) {
  const [active, setActive] = useState<AlertPreview | null>(null);

  return (
    <>
      <div className="table-shell">
        <table className="data-table min-w-full">
          <caption className="sr-only">Filtered alerts</caption>
          <thead>
            <tr>
              <th scope="col">Alert</th>
              <th scope="col">Customer</th>
              <th scope="col">Rule</th>
              <th scope="col">When</th>
              <th scope="col">Points</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted">
                  No alerts match these filters.
                </td>
              </tr>
            ) : (
              rows.map((alert) => (
                <tr key={alert.id}>
                  <td>
                    <Link href={`/alerts/${alert.id}`} className="font-semibold hover:underline">
                      {alert.title}
                    </Link>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge value={alert.severity} />
                      <button type="button" className="text-xs font-semibold text-info underline" onClick={() => setActive(alert)}>
                        Preview
                      </button>
                    </div>
                  </td>
                  <td>
                    <Link href={`/customers/${alert.customerId}`} className="hover:underline">
                      {alert.customerName}
                    </Link>
                  </td>
                  <td className="num whitespace-nowrap">{alert.ruleId}</td>
                  <td className="num whitespace-nowrap">{when(alert.occurredAt)}</td>
                  <td className="num">{alert.score}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <SlideOver open={active != null} title={active?.title ?? "Alert"} kicker={active?.ruleId} onClose={() => setActive(null)}>
        {active ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge value={active.severity} />
              <span className="num text-sm text-muted">{active.score} points</span>
              <span className="text-sm text-muted">{when(active.occurredAt)}</span>
            </div>
            <p className="text-sm leading-relaxed">{active.detail}</p>
            <p className="text-sm">
              Customer{" "}
              <Link href={`/customers/${active.customerId}`} className="font-semibold text-info underline">
                {active.customerName}
              </Link>
            </p>
            {active.observed.length > 0 ? (
              <dl className="divide-y divide-line text-sm">
                {active.observed.map(([key, value]) => (
                  <div key={key} className="grid grid-cols-[0.9fr_1.1fr] gap-3 py-2">
                    <dt className="text-muted">{key}</dt>
                    <dd className="num font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <Link href={`/alerts/${active.id}`} className="inline-flex rounded-full bg-spruce px-4 py-2 text-sm font-semibold text-white">
              Open the full record
            </Link>
          </div>
        ) : null}
      </SlideOver>
    </>
  );
}
