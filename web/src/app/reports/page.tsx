import Link from "next/link";
import type { Metadata } from "next";
import { Badge } from "@/components/Badges";
import { PageIntro, Shell } from "@/components/Shell";
import { data } from "@/lib/snapshot";

export const metadata: Metadata = { title: "STR drafts" };

export default function ReportsPage() {
  return (
    <Shell>
      <PageIntro
        kicker="Suspicious transaction reports"
        title="Drafts a person can check"
        lede="Each narrative is composed from the case facts. The verifier rejects a number that is not in those facts, and it rejects any sentence that states a crime as fact. Filing is still a human decision."
      />
      <p className="mb-4 text-sm">
        <Link href="/filings" className="font-semibold text-info underline">Open the FINTRAC-like drafts</Link>
        <span className="text-muted"> for STR, LCTR, EFTR and terrorist-property JSON.</span>
      </p>
      <ul className="grid gap-4">
        {data.reports.map((report) => (
          <li key={report.case_id}>
            <Link href={`/reports/${report.case_id}`} className="block rounded-2xl border border-line bg-card p-5 hover:border-brass">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted">{report.reference}</p>
                  <h2 className="font-display text-2xl text-spruce">{report.customer_name}</h2>
                </div>
                <div className="flex items-center gap-2">
                  <Badge value={report.risk_tier} />
                  <Badge value={report.verification.supported ? "Verified" : "Needs review"} tone={report.verification.supported ? "LOW" : "HIGH"} />
                </div>
              </div>
              <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted">{report.narrative.replaceAll("\n", " ")}</p>
              <p className="mt-3 text-xs text-muted">
                Score {report.risk_score}
                {report.lvctr_required ? " · LVCTR also required" : ""}
                {report.str_candidate ? " · STR candidate" : ""}
                {report.missing_information.length ? ` · ${report.missing_information.length} gap${report.missing_information.length === 1 ? "" : "s"}` : ""}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
