import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AssistNote } from "@/components/Assist";
import { Badge } from "@/components/Badges";
import { CaseStoreNote, CaseWorkspace, InvestigationCanvas } from "@/components/CaseWorkspace";
import { PageIntro, Shell } from "@/components/Shell";
import { Timeline } from "@/components/Timeline";
import { when } from "@/lib/format";
import { preservedQueue, safeReturn, withReturn } from "@/lib/return-to";
import { caseDeadline } from "@/lib/sla";
import { data } from "@/lib/snapshot";

type Params = { id: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  const row = data.cases.find((item) => item.id === Number(id));
  return { title: row?.reference ?? "Case" };
}

export default async function CasePage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ return?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const row = data.cases.find((item) => item.id === Number(id));
  if (!row) notFound();
  const back = safeReturn(query.return, "/alerts");
  const queue = preservedQueue(query.return);
  const alerts = data.alerts.filter((alert) => alert.case_id === row.id);
  const report = data.reports.find((item) => item.case_id === row.id);
  const filing = data.filings.find((item) => item.case_id === row.id);
  const namespace = `${data.meta.as_of}:${data.meta.counts.cases}`;
  const deadline = caseDeadline(row, data.alerts, data.meta.as_of);
  const seeds = [
    ...alerts.slice(0, 4).map((alert, index) => ({
      id: `alert-${alert.id}`,
      kind: "alert",
      ref: String(alert.id),
      label: alert.rule_id,
      detail: alert.title,
      x: 4 + (index % 3) * 30,
      y: 8 + Math.floor(index / 3) * 38,
    })),
    ...(row.risk_drivers ?? []).slice(0, 3).map((driver, index) => ({
      id: `driver-${index}`,
      kind: "driver",
      ref: driver.key,
      label: driver.label,
      detail: driver.detail,
      x: 8 + index * 28,
      y: 58,
    })),
  ];

  return (
    <Shell wide>
      <PageIntro
        kicker={`6 · ${row.reference}`}
        title={row.customer_name ?? "Case"}
        lede="The score and the evidence come from the detection run. Notes, the canvas and the four-eyes decision stay in this browser. Approval here does not authenticate a person and does not file."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href={back} className="btn btn-secondary">Back</Link>
        <Link href={queue} className="btn btn-secondary">Alert queue</Link>
        <Link href="/cases" className="btn btn-secondary">All cases</Link>
        {alerts[0] ? <Link href={withReturn(`/alerts/${alerts[0].id}`, `/cases/${row.id}`)} className="btn btn-primary">Explain this alert</Link> : null}
      </div>
      <AssistNote title="Working a case">
        Read why it is open, open the linked alert, and write a note that cites a transaction or a rule version. Requesting approval only changes the local draft. Switch the actor to record a second review. That switch is a label, not a login.
      </AssistNote>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge value={row.risk_tier} />
        <Badge value={row.priority} tone={row.priority === "URGENT" ? "CRITICAL" : "INFO"} />
        {row.lvctr_required ? <Badge value="LVCTR" tone="REPORTING" /> : null}
        {row.str_candidate ? <Badge value="STR review" tone="HIGH" /> : null}
        <Link href={`/customers/${row.customer_id}`} className="text-sm text-info underline">Customer 360</Link>
        {report ? <Link href={`/reports/${row.id}`} className="text-sm text-info underline">STR narrative</Link> : null}
        {filing ? <Link href={`/filings/${filing.id}`} className="text-sm text-info underline">Draft filing</Link> : null}
      </div>
      <CaseStoreNote caseId={row.id} />
      <div className="mb-4">
        <InvestigationCanvas namespace={namespace} caseId={row.id} status={row.status} disposition={row.disposition} seeds={seeds} />
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
            <CaseWorkspace
              namespace={namespace}
              caseId={row.id}
              status={row.status}
              disposition={row.disposition}
              asOf={data.meta.as_of}
              deadline={deadline}
            />
          </div>
        </article>
      </div>
    </Shell>
  );
}
