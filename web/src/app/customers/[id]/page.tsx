import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Badge, InstrumentTag } from "@/components/Badges";
import { PageIntro, Shell } from "@/components/Shell";
import { money, when } from "@/lib/format";
import { alertsForCustomer, anomalyForCustomer, customerById, data, transactionsForCustomer } from "@/lib/snapshot";

type Params = { id: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  const customer = customerById(Number(id));
  return { title: customer?.name ?? "Customer" };
}

export default async function CustomerPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const customer = customerById(Number(id));
  if (!customer) notFound();
  const alerts = alertsForCustomer(customer.id);
  const transactions = transactionsForCustomer(customer.id).slice().reverse().slice(0, 12);
  const anomaly = anomalyForCustomer(customer.id);
  const report = data.reports.find((row) => row.customer_id === customer.id);
  const maxFactor = Math.max(...customer.risk.factors.map((factor) => factor.points), 1);

  return (
    <Shell>
      <PageIntro
        kicker={customer.customer_id}
        title={customer.name}
        lede={`${customer.occupation_or_business} · ${customer.profile.city ?? "Canada"}, ${customer.profile.province ?? customer.country} · declared ${money(customer.expected_monthly_volume_cad)} / month`}
      />
      <div className="mb-6 flex flex-wrap gap-2">
        <Badge value={customer.risk.tier} />
        <Badge value={customer.customer_type} tone="INFO" />
        <Badge value={`${customer.kyc_risk} KYC`} tone={customer.kyc_risk} />
      </div>
      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ["Inherent", customer.risk.inherent, "Onboarding and product"],
          ["Behavioural", customer.risk.behavioural, "Open alert composite"],
          ["Residual", customer.risk.residual, "What the queue should feel"],
        ].map(([label, value, note]) => (
          <article key={String(label)} className="rounded-2xl border border-line bg-card px-4 py-4">
            <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
            <p className="num font-display text-4xl text-spruce">{value}</p>
            <p className="text-sm text-muted">{note}</p>
          </article>
        ))}
      </section>
      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-display text-2xl text-spruce">Why this rating</h2>
          <ul className="mt-4 space-y-3">
            {customer.risk.factors.map((factor) => (
              <li key={factor.code}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-semibold">{factor.label}</span>
                  <span className="num text-muted">+{factor.points}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-[#efe6d6]">
                  <div className="h-1.5 rounded-full bg-brass" style={{ width: `${(factor.points / maxFactor) * 100}%` }} />
                </div>
                <p className="mt-1 text-sm text-muted">{factor.detail}</p>
              </li>
            ))}
          </ul>
        </article>
        <article className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-display text-2xl text-spruce">Behavioural anomaly</h2>
          {anomaly ? (
            <div className="mt-3">
              <p className="text-sm text-muted">
                {anomaly.model_name} {anomaly.model_version}. Score {anomaly.score.toFixed(3)} against the rest of this population. Higher means less typical. It adds a bounded number of points and never files anything.
              </p>
              <ul className="mt-4 space-y-2">
                {anomaly.attributions.slice(0, 6).map((item) => (
                  <li key={item.feature} className="text-sm">
                    <div className="flex justify-between gap-3">
                      <span>{item.feature.replaceAll("_", " ")}</span>
                      <span className="num">{item.contribution.toFixed(3)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-[#efe6d6]">
                      <div className="h-1.5 rounded-full bg-spruce" style={{ width: `${Math.min(100, Math.abs(item.contribution) * 400)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">No anomaly score was stored for this customer.</p>
          )}
          {report ? (
            <p className="mt-5 text-sm">
              <Link href={`/reports/${report.case_id}`} className="font-semibold text-info underline">
                Open the STR draft for {report.reference}
              </Link>
            </p>
          ) : null}
        </article>
      </section>
      <section className="mt-6">
        <h2 className="mb-3 font-display text-2xl text-spruce">Alerts</h2>
        {alerts.length === 0 ? (
          <p className="text-sm text-muted">No alerts on this relationship.</p>
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
            {alerts.map((alert) => (
              <li key={alert.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div>
                  <Link href={`/alerts/${alert.id}`} className="font-semibold hover:underline">{alert.title}</Link>
                  <p className="text-xs text-muted">{alert.rule_id} · {alert.explanation.detail}</p>
                </div>
                <Badge value={alert.severity} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="mt-6">
        <h2 className="mb-3 font-display text-2xl text-spruce">Recent transactions</h2>
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">Recent transactions for this customer</caption>
            <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3" scope="col">When</th>
                <th className="px-4 py-3" scope="col">Reference</th>
                <th className="px-4 py-3" scope="col">Rail</th>
                <th className="px-4 py-3" scope="col">Direction</th>
                <th className="px-4 py-3" scope="col">CAD</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((txn) => (
                <tr key={txn.id} className="border-b border-line last:border-0">
                  <td className="num px-4 py-3">{when(txn.occurred_at)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/transactions/${txn.id}`} className="font-semibold hover:underline">{txn.transaction_id}</Link>
                  </td>
                  <td className="px-4 py-3"><InstrumentTag value={txn.instrument} /></td>
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
