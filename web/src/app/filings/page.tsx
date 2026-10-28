import Link from "next/link";
import type { Metadata } from "next";
import { Badge } from "@/components/Badges";
import { PageIntro, Shell } from "@/components/Shell";
import { data } from "@/lib/snapshot";

export const metadata: Metadata = { title: "Filings" };

const TONE: Record<string, string> = { STR: "HIGH", LCTR: "REPORTING", EFTR: "REPORTING", TPR: "CRITICAL" };

export default function FilingsPage() {
  return (
    <Shell>
      <PageIntro
        kicker="Draft reports"
        title="STR, LCTR, EFTR and TPR shapes"
        lede="Each draft uses FINTRAC-like field names and says, in the document itself, that it has not been submitted. Download the JSON, or a text PDF of the same fields."
      />
      <ul className="space-y-3">
        {data.filings.map((filing) => (
          <li key={filing.id} className="rounded-2xl border border-line bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <Badge value={filing.kind} tone={TONE[filing.kind] ?? "INFO"} />
                  <h2 className="font-semibold">{filing.title}</h2>
                </div>
                <p className="text-sm text-muted">{filing.customer_name}</p>
              </div>
              <Link href={`/filings/${filing.id}`} className="rounded-md bg-spruce px-4 py-2 text-sm font-semibold text-white">
                Open draft
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
