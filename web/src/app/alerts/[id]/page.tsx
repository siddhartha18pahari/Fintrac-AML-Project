import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Badge } from "@/components/Badges";
import { PageIntro, Shell } from "@/components/Shell";
import { formatValue, money, observedEntries, when } from "@/lib/format";
import { alertById, transactionById } from "@/lib/snapshot";

type Params = { id: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  const alert = alertById(Number(id));
  return { title: alert ? alert.rule_id : "Alert" };
}

export default async function AlertDetailPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const alert = alertById(Number(id));
  if (!alert) notFound();
  const evidence = alert.evidence_txn_ids
    .map((txnId) => transactionById(txnId))
    .filter((txn): txn is NonNullable<typeof txn> => Boolean(txn));

  return (
    <Shell>
      <PageIntro kicker={alert.rule_id} title={alert.title} lede={alert.explanation.detail} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge value={alert.severity} />
        <span className="text-sm text-muted">Version {alert.rule_version}</span>
        <span className="text-sm text-muted">· {alert.score_contribution} points</span>
        <span className="text-sm text-muted">· {when(alert.occurred_at)}</span>
      </div>
      <p className="mb-6 text-sm">
        Customer{" "}
        <Link href={`/customers/${alert.customer_id}`} className="font-semibold text-info underline">
          {alert.customer_name}
        </Link>
      </p>
      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-display text-2xl text-spruce">Observed</h2>
          <dl className="mt-3 divide-y divide-line text-sm">
            {observedEntries(alert.explanation.observed).map(([key, value]) => (
              <div key={key} className="grid grid-cols-[1fr_1.2fr] gap-3 py-2">
                <dt className="text-muted">{key.replaceAll("_", " ")}</dt>
                <dd className="num font-medium">{formatValue(value)}</dd>
              </div>
            ))}
          </dl>
        </article>
        <article className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-display text-2xl text-spruce">Threshold</h2>
          <dl className="mt-3 divide-y divide-line text-sm">
            {observedEntries(alert.explanation.threshold).map(([key, value]) => (
              <div key={key} className="grid grid-cols-[1fr_1.2fr] gap-3 py-2">
                <dt className="text-muted">{key.replaceAll("_", " ")}</dt>
                <dd className="num font-medium">{formatValue(value)}</dd>
              </div>
            ))}
          </dl>
        </article>
      </section>
      <section className="mt-6">
        <h2 className="mb-3 font-display text-2xl text-spruce">Evidence</h2>
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">Transactions cited by this alert</caption>
            <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3" scope="col">Reference</th>
                <th className="px-4 py-3" scope="col">When</th>
                <th className="px-4 py-3" scope="col">Rail</th>
                <th className="px-4 py-3" scope="col">Direction</th>
                <th className="px-4 py-3" scope="col">CAD</th>
              </tr>
            </thead>
            <tbody>
              {evidence.map((txn) => (
                <tr key={txn.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/transactions/${txn.id}`} className="font-semibold hover:underline">{txn.transaction_id}</Link>
                  </td>
                  <td className="num px-4 py-3">{when(txn.occurred_at)}</td>
                  <td className="px-4 py-3">{txn.instrument === "VIRTUAL_CURRENCY" ? txn.asset : txn.instrument}</td>
                  <td className="px-4 py-3">{txn.direction}</td>
                  <td className="num px-4 py-3">{money(txn.cad_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Shell>
  );
}
