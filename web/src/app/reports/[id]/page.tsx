import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Badge } from "@/components/Badges";
import { PageIntro, Shell } from "@/components/Shell";
import { reportByCaseId } from "@/lib/snapshot";

type Params = { id: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  const report = reportByCaseId(Number(id));
  return { title: report?.reference ?? "STR draft" };
}

export default async function ReportPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const report = reportByCaseId(Number(id));
  if (!report) notFound();
  const sections = new Map<string, typeof report.citations>();
  for (const citation of report.citations) {
    const bucket = sections.get(citation.section) ?? [];
    bucket.push(citation);
    sections.set(citation.section, bucket);
  }

  return (
    <Shell>
      <PageIntro
        kicker={report.reference}
        title={report.customer_name ?? "STR draft"}
        lede="Read this as a draft for an investigator. The sentences below are the whole narrative. Citations sit under each one."
      />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge value={report.risk_tier} />
        <Badge value={report.verification.supported ? "Claims supported" : "Unsupported claims"} tone={report.verification.supported ? "LOW" : "HIGH"} />
        <span className="text-sm text-muted">Score {report.risk_score}</span>
        <Link href={`/customers/${report.customer_id}`} className="text-sm text-info underline">Customer profile</Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.7fr]">
        <article className="rounded-2xl border border-line bg-card p-6">
          {[...sections.entries()].map(([section, sentences]) => (
            <section key={section} className="mb-6 last:mb-0">
              <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-brass">{section}</h2>
              <div className="mt-2 space-y-3">
                {sentences.map((sentence) => (
                  <p key={sentence.sentence} className="text-[15px] leading-relaxed">
                    {sentence.sentence}
                    <span className="mt-1 block text-xs text-muted">Evidence: {sentence.evidence.slice(0, 6).join(", ")}{sentence.evidence.length > 6 ? "…" : ""}</span>
                  </p>
                ))}
              </div>
            </section>
          ))}
        </article>
        <aside className="space-y-4">
          <article className="rounded-2xl border border-line bg-card p-5">
            <h2 className="font-display text-xl text-spruce">Verifier</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {report.verification.supported
                ? "Every number in the draft appears in the case facts, and none of the prohibited assertions are present."
                : "The draft contains a claim the fact set does not support. It should not be treated as clean."}
            </p>
            <dl className="mt-3 text-sm">
              <div className="flex justify-between py-1"><dt>Unsupported claims</dt><dd className="num">{report.verification.unsupported_claims.length}</dd></div>
              <div className="flex justify-between py-1"><dt>Prohibited language</dt><dd className="num">{report.verification.prohibited_language.length}</dd></div>
              <div className="flex justify-between py-1"><dt>Uncited sentences</dt><dd className="num">{report.verification.uncited_sentences.length}</dd></div>
            </dl>
          </article>
          <article className="rounded-2xl border border-line bg-card p-5">
            <h2 className="font-display text-xl text-spruce">Still missing</h2>
            {report.missing_information.length === 0 ? (
              <p className="mt-2 text-sm text-muted">The fact set covered the sections the template asks for.</p>
            ) : (
              <ul className="mt-2 list-disc space-y-2 pl-4 text-sm text-muted">
                {report.missing_information.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </article>
        </aside>
      </div>
    </Shell>
  );
}
