import type { Metadata } from "next";
import { PageIntro, Shell } from "@/components/Shell";
import { TriageBoard } from "@/components/TriageBoard";
import { data } from "@/lib/snapshot";

export const metadata: Metadata = { title: "Triage" };

export default function TriagePage() {
  const namespace = `${data.meta.as_of}:${data.meta.counts.cases}`;
  return (
    <Shell>
      <PageIntro
        kicker="Queue"
        title="What is due, and what is already late"
        lede="Cases sit beside alerts that never became a case. The clock is the book clock, not your wall clock, so a refresh does not age the queue."
      />
      <TriageBoard
        namespace={namespace}
        asOf={data.meta.as_of}
        cases={data.cases.map((row) => ({
          id: row.id,
          reference: row.reference,
          customer_id: row.customer_id,
          customer_name: row.customer_name,
          status: row.status,
          risk_tier: row.risk_tier,
          risk_score: row.risk_score,
          due_at: row.due_at,
          disposition: row.disposition,
        }))}
        alerts={data.alerts.map((alert) => ({
          id: alert.id,
          case_id: alert.case_id,
          customer_id: alert.customer_id,
          customer_name: alert.customer_name,
          title: alert.title,
          severity: alert.severity,
          rule_id: alert.rule_id,
          occurred_at: alert.occurred_at,
        }))}
      />
    </Shell>
  );
}
