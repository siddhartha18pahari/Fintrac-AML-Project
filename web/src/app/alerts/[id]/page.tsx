import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Badge } from "@/components/Badges";
import { PageIntro, Shell } from "@/components/Shell";
import { Timeline } from "@/components/Timeline";
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
        <article className="panel glass p-5">
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
        <article className="panel glass p-5">
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
        <div className="table-shell">
          <table className="data-table min-w-full">
            <caption className="sr-only">Transactions cited by this alert</caption>
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">When</th>
                <th scope="col">Rail</th>
                <th scope="col">Direction</th>
                <th scope="col">CAD</th>
              </tr>
            </thead>
            <tbody>
              {evidence.map((txn) => (
                <tr key={txn.id}>
                  <td>
                    <Link href={`/transactions/${txn.id}`} className="font-semibold hover:underline">{txn.transaction_id}</Link>
                  </td>
                  <td className="num">{when(txn.occurred_at)}</td>
                  <td>{txn.instrument === "VIRTUAL_CURRENCY" ? txn.asset : txn.instrument}</td>
                  <td>{txn.direction}</td>
                  <td className="num">{money(txn.cad_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel glass mt-6 p-5">
          <h3 className="mb-4 font-display text-2xl text-spruce">Evidence in time</h3>
          <Timeline
            events={evidence.map((txn) => ({
              at: txn.occurred_at,
              kind: txn.direction.toLowerCase(),
              title: txn.transaction_id,
              detail: `${txn.instrument === "VIRTUAL_CURRENCY" ? txn.asset : txn.instrument} · ${txn.direction} · ${money(txn.cad_value)}`,
              href: `/transactions/${txn.id}`,
            }))}
          />
        </div>
      </section>
    </Shell>
  );
}
