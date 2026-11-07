import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AssistNote, SourceNote } from "@/components/Assist";
import { Badge } from "@/components/Badges";
import { PageIntro, Shell } from "@/components/Shell";
import { Timeline } from "@/components/Timeline";
import { formatValue, money, observedEntries, when } from "@/lib/format";
import { readRule } from "@/lib/rule-guide";
import { safeReturn, withReturn } from "@/lib/return-to";
import { alertById, data, transactionById } from "@/lib/snapshot";

type Params = { id: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  const alert = alertById(Number(id));
  return { title: alert ? alert.rule_id : "Alert" };
}

export default async function AlertDetailPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ return?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const alert = alertById(Number(id));
  if (!alert) notFound();
  const back = safeReturn(query.return, "/alerts");
  const backLabel = back.startsWith("/cases") ? "Back to case" : back.startsWith("/customers") ? "Back to customer" : "Back to alert queue";
  const here = withReturn(`/alerts/${alert.id}`, back);
  const rule = data.rules.find((item) => item.rule_id === alert.rule_id && String(item.version) === String(alert.rule_version))
    ?? data.rules.find((item) => item.rule_id === alert.rule_id && item.in_force);
  const reading = rule ? readRule(rule) : null;
  const customer = data.customers.find((item) => item.id === alert.customer_id);
  const evidence = alert.evidence_txn_ids
    .map((txnId) => transactionById(txnId))
    .filter((txn): txn is NonNullable<typeof txn> => Boolean(txn));
  const evidenceCad = evidence.reduce((sum, txn) => sum + Number(txn.cad_value), 0);

  return (
    <Shell>
      <PageIntro kicker={`2 · ${alert.rule_id}`} title={alert.title} lede={alert.explanation.detail} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={back} className="btn btn-secondary">{backLabel}</Link>
        {back !== "/alerts" ? <Link href="/alerts" className="btn btn-secondary">Alert queue</Link> : null}
        <Badge value={alert.severity} />
        <span className="text-sm text-muted">Version {alert.rule_version}</span>
        <span className="text-sm text-muted">· {alert.score_contribution} points</span>
        <span className="text-sm text-muted">· {when(alert.occurred_at)}</span>
      </div>
      <AssistNote title="How to use this alert">
        Compare each observed figure with the threshold on this version. Open the evidence transactions, then the customer and the graph neighbourhood. A benign reading is ordinary activity that happens to meet the encoded pattern. Do not file from this page.
      </AssistNote>
      <p className="mb-4 text-sm">
        Customer{" "}
        <Link href={`/customers/${alert.customer_id}`} className="font-semibold text-info underline">{alert.customer_name}</Link>
        {customer ? <span className="text-muted"> · residual {customer.risk.residual} {customer.risk.tier}</span> : null}
        {alert.case_id ? (
          <>
            {" "}· <Link href={withReturn(`/cases/${alert.case_id}`, here)} className="font-semibold text-info underline">Open the case</Link>
          </>
        ) : null}
        {" "}· <Link href={`/graph?view=explore&focus=customer:${alert.customer_id}`} className="font-semibold text-info underline">Graph neighbourhood</Link>
        {" "}· <Link href={`/rules#${alert.rule_id}`} className="font-semibold text-info underline">Rule catalogue</Link>
      </p>
      <section className="panel mb-6 p-5 text-sm leading-6">
        <h2 className="text-base font-semibold">Why this fired</h2>
        <p className="mt-2">{alert.explanation.detail}</p>
        <p className="mt-2 text-muted">
          {rule ? `${rule.name}. Version ${rule.version}, ${rule.in_force ? "in force" : "superseded"}, effective ${rule.effective_from?.slice(0, 10) ?? "—"}.` : `Rule ${alert.rule_id} version ${alert.rule_version} is not in the bundled catalogue.`}
          {reading ? ` ${reading.kindLabel}.` : ""} Score contribution {alert.score_contribution}. Dedupe on the catalogue is {rule?.dedupe ?? "not recorded"}.
        </p>
        <p className="mt-2 text-muted">
          Evidence transactions in this snapshot: {evidence.length}, summing to {money(evidenceCad)}. That sum is the cited rows, not a second calculation of the rule. {reading?.limitations ?? "Treat the hit as an indicator. It is not a finding and not a filing."}
        </p>
        <SourceNote>Observed and threshold objects are the explanation stored on the alert when the snapshot was built. Transactions are the evidence ids on that alert. Customer residual is the stored rating. Nothing here is recomputed against a live book.</SourceNote>
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <article className="panel p-5">
          <h2 className="text-base font-semibold">Observed</h2>
          <dl className="mt-3 divide-y divide-line text-sm">
            {observedEntries(alert.explanation.observed).map(([key, value]) => (
              <div key={key} className="grid grid-cols-[1fr_1.2fr] gap-3 py-2">
                <dt className="text-muted">{key.replaceAll("_", " ")}</dt>
                <dd className="num font-medium">{formatValue(value)}</dd>
              </div>
            ))}
          </dl>
        </article>
        <article className="panel p-5">
          <h2 className="text-base font-semibold">Threshold on this version</h2>
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
        <div className="panel mt-6 p-5">
          <h3 className="mb-4 text-base font-semibold">Evidence in time</h3>
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
