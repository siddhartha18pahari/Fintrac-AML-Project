import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Badge } from "@/components/Badges";
import { CaseWorkspace } from "@/components/CaseWorkspace";
import { PageIntro, Shell } from "@/components/Shell";
import { Timeline } from "@/components/Timeline";
import { when } from "@/lib/format";
import { data } from "@/lib/snapshot";

type Params = { id: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  const row = data.cases.find((item) => item.id === Number(id));
  return { title: row?.reference ?? "Case" };
}

export default async function CasePage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const row = data.cases.find((item) => item.id === Number(id));
  if (!row) notFound();
  const alerts = data.alerts.filter((alert) => alert.case_id === row.id);
  const report = data.reports.find((item) => item.case_id === row.id);
  const filing = data.filings.find((item) => item.case_id === row.id);
  const namespace = `${data.meta.as_of}:${data.meta.counts.cases}`;

  return (
    <Shell>
      <PageIntro
        kicker={row.reference}
        title={row.customer_name ?? "Case"}
        lede="The score and the evidence come from the detection run. The assignment, notes and disposition are yours, and they stay on this machine."
      />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge value={row.risk_tier} />
        <Badge value={row.priority} tone={row.priority === "URGENT" ? "CRITICAL" : "INFO"} />
        {row.lvctr_required ? <Badge value="LVCTR" tone="REPORTING" /> : null}
        {row.str_candidate ? <Badge value="STR review" tone="HIGH" /> : null}
        <Link href={`/customers/${row.customer_id}`} className="text-sm text-info underline">Customer 360</Link>
        {report ? <Link href={`/reports/${row.id}`} className="text-sm text-info underline">STR narrative</Link> : null}
        {filing ? <Link href={`/filings/${filing.id}`} className="text-sm text-info underline">Draft filing</Link> : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <article className="panel glass p-5">
          <h2 className="font-display text-2xl text-spruce">Why it is open</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted">Score</dt><dd className="num">{row.risk_score}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Opened in the run</dt><dd>{when(row.opened_at)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Filing due</dt><dd>{when(row.due_at)}</dd></div>
          </dl>
          <ul className="mt-4 space-y-3">
            {(row.risk_drivers ?? []).slice(0, 8).map((driver) => (
              <li key={`${driver.key}-${driver.label}`} className="text-sm">
                <div className="flex justify-between gap-3">
                  <span className="font-semibold">{driver.label}</span>
                  <span className="num text-muted">+{driver.points}</span>
                </div>
                <p className="text-muted">{driver.detail}</p>
              </li>
            ))}
          </ul>
          <h3 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wider text-muted">Linked alerts</h3>
          <ul className="space-y-2 text-sm">
            {alerts.map((alert) => (
              <li key={alert.id}>
                <Link href={`/alerts/${alert.id}`} className="font-semibold hover:underline">{alert.title}</Link>
                <p className="text-xs text-muted">{alert.rule_id}</p>
              </li>
            ))}
          </ul>
          <h3 className="mb-3 mt-6 font-display text-xl text-spruce">What happened</h3>
          <Timeline
            events={[
              { at: row.opened_at, kind: "case", title: "Case opened in the detection run", detail: row.reference },
              ...alerts.map((alert) => ({
                at: alert.occurred_at,
                kind: alert.severity,
                title: alert.title,
                detail: alert.rule_id,
                href: `/alerts/${alert.id}`,
              })),
              ...(row.due_at ? [{ at: row.due_at, kind: "due", title: "Filing clock", detail: "Due date carried on the case." }] : []),
            ]}
          />
        </article>
        <article className="panel glass p-5">
          <h2 className="font-display text-2xl text-spruce">Working file</h2>
          <div className="mt-3">
            <CaseWorkspace namespace={namespace} caseId={row.id} status={row.status} disposition={row.disposition} />
          </div>
        </article>
      </div>
    </Shell>
  );
}
