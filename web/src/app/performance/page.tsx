import type { Metadata } from "next";
import { PageIntro, Shell } from "@/components/Shell";
import { data } from "@/lib/snapshot";

export const metadata: Metadata = { title: "Quality" };

export default function PerformancePage() {
  const quality = data.performance;
  const recall = quality.recall == null ? "—" : `${Math.round(quality.recall * 100)}%`;
  const planted = quality.anomaly.planted_alert_customers;
  const other = quality.anomaly.other_customers;

  return (
    <Shell>
      <PageIntro
        kicker="Labelled scenarios"
        title="What the planted book can and cannot say"
        lede={quality.disclaimer}
      />
      <section className="grid gap-3 sm:grid-cols-4">
        {[
          ["Planted indicators", quality.planted_indicators],
          ["Detected", quality.detected],
          ["Missed", quality.missed],
          ["Recall", recall],
        ].map(([label, value]) => (
          <article key={String(label)} className="rounded-2xl border border-line bg-card px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
            <p className="num mt-1 font-display text-4xl text-spruce">{value}</p>
          </article>
        ))}
      </section>
      <p className="mt-4 max-w-3xl text-sm text-muted">
        {quality.alerts_outside_labels} alerts sit outside the planted labels, out of {quality.alerts_total}. Those are unlabelled. They are the queue a reviewer would sample. They are not a false-positive rate.
      </p>
      <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-card">
        <table className="min-w-full text-left text-sm">
          <caption className="sr-only">Recall of planted indicators by rule</caption>
          <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3" scope="col">Rule</th>
              <th className="px-4 py-3" scope="col">Expected</th>
              <th className="px-4 py-3" scope="col">Detected</th>
              <th className="px-4 py-3" scope="col">Missed</th>
              <th className="px-4 py-3" scope="col">Outside the label</th>
              <th className="px-4 py-3" scope="col">Recall</th>
            </tr>
          </thead>
          <tbody>
            {quality.by_rule.map((row) => (
              <tr key={row.rule_id} className="border-b border-line last:border-0">
                <td className="px-4 py-3">
                  <p className="font-semibold">{row.rule_id}</p>
                  <p className="text-xs text-muted">{row.name}</p>
                </td>
                <td className="num px-4 py-3">{row.expected}</td>
                <td className="num px-4 py-3">{row.detected}</td>
                <td className="num px-4 py-3">{row.missed}</td>
                <td className="num px-4 py-3">{row.outside}</td>
                <td className="num px-4 py-3">{row.recall == null ? "—" : `${Math.round(row.recall * 100)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-display text-2xl text-spruce">Anomaly scores</h2>
          <p className="mt-2 text-sm text-muted">{quality.anomaly.note}</p>
          <div className="mt-4 space-y-4">
            {[
              ["Planted alert customers", planted],
              ["Everyone else", other],
            ].map(([label, stats]) => {
              const row = stats as typeof planted;
              return (
                <div key={String(label)}>
                  <div className="flex justify-between text-sm">
                    <span className="font-semibold">{label as string}</span>
                    <span className="num text-muted">n {row.count} · median {row.median ?? "—"}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-line">
                    <div className="h-2 rounded-full bg-spruce" style={{ width: `${Math.min(100, (row.median ?? 0) * 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </article>
        <article className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-display text-2xl text-spruce">Missed labels</h2>
          {quality.misses.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Every planted indicator produced an alert.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {quality.misses.map((miss) => (
                <li key={`${miss.customer_id}-${miss.rule_id}`}>
                  <span className="font-semibold">{miss.rule_id}</span>
                  <span className="text-muted"> · {miss.customer_name} · {miss.scenario}</span>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>
    </Shell>
  );
}
