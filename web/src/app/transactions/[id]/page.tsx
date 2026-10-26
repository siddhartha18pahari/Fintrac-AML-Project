import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Badge, InstrumentTag } from "@/components/Badges";
import { PageIntro, Shell } from "@/components/Shell";
import { money, shortAddress, when } from "@/lib/format";
import { alertsCiting } from "@/lib/queries";
import { transactionById } from "@/lib/snapshot";

type Params = { id: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  const txn = transactionById(Number(id));
  return { title: txn?.transaction_id ?? "Transaction" };
}

export default async function TransactionPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const txn = transactionById(Number(id));
  if (!txn) notFound();
  const alerts = alertsCiting(txn.id);
  const facts = [
    ["When", when(txn.occurred_at)],
    ["Direction", txn.direction],
    ["Rail", txn.instrument],
    ["Asset", `${txn.asset_amount} ${txn.asset}`],
    ["CAD value", money(txn.cad_value)],
    ["Rate", txn.exchange_rate],
    ["From", shortAddress(txn.wallet_from)],
    ["To", shortAddress(txn.wallet_to)],
    ["Scenario", txn.scenario ?? "—"],
    ["Purpose", String(txn.context?.purpose ?? "—")],
  ];

  return (
    <Shell>
      <PageIntro
        kicker="Transaction"
        title={txn.transaction_id}
        lede={`${money(txn.cad_value)} ${txn.direction.toLowerCase()} · ${txn.customer_name}`}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <InstrumentTag value={txn.instrument} />
        <Badge value={txn.direction} tone="INFO" />
      </div>
      <p className="mb-6 text-sm">
        Customer{" "}
        <Link className="font-semibold text-info underline" href={`/customers/${txn.customer_id}`}>{txn.customer_name}</Link>
      </p>
      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <article className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-display text-2xl text-spruce">Valuation</h2>
          <dl className="mt-3 divide-y divide-line text-sm">
            {facts.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[140px_1fr] gap-3 py-2">
                <dt className="text-muted">{label}</dt>
                <dd className="num font-medium break-all">{value}</dd>
              </div>
            ))}
          </dl>
        </article>
        <article className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-display text-2xl text-spruce">Alerts that cite it</h2>
          {alerts.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No rule used this transaction as evidence.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {alerts.map((alert) => (
                <li key={alert.id} className="py-3">
                  <Link href={`/alerts/${alert.id}`} className="font-semibold hover:underline">{alert.title}</Link>
                  <p className="text-xs text-muted">{alert.rule_id} · {alert.explanation.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>
    </Shell>
  );
}
