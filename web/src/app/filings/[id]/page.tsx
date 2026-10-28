import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Badge } from "@/components/Badges";
import { FilingActions } from "@/components/FilingActions";
import { PageIntro, Shell } from "@/components/Shell";
import { data } from "@/lib/snapshot";

type Params = { id: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  const filing = data.filings.find((item) => item.id === id);
  return { title: filing?.title ?? "Filing draft" };
}

function Fields({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (depth > 3) return <p className="text-sm text-muted">See the JSON download for the rest of this block.</p>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <p className="text-sm text-muted">None.</p>;
    return (
      <ol className="space-y-3">
        {value.map((item, index) => (
          <li key={index} className="rounded-xl border border-line p-3">
            <Fields value={item} depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  }
  if (value && typeof value === "object") {
    return (
      <dl className="space-y-2">
        {Object.entries(value as Record<string, unknown>).map(([key, item]) => (
          <div key={key}>
            <dt className="text-xs font-semibold uppercase tracking-wider text-muted">{key.replaceAll("_", " ")}</dt>
            <dd className="text-sm">
              {item && typeof item === "object" ? <div className="mt-1"><Fields value={item} depth={depth + 1} /></div> : String(item ?? "—")}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <p className="text-sm">{String(value ?? "—")}</p>;
}

export default async function FilingPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const filing = data.filings.find((item) => item.id === id);
  if (!filing) notFound();
  const document = filing.document as Record<string, unknown>;

  return (
    <Shell>
      <PageIntro kicker={filing.kind} title={filing.title} lede={String(document.disclaimer ?? "")} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Badge value={filing.kind} />
        {filing.customer_id ? (
          <Link href={`/customers/${filing.customer_id}`} className="text-sm text-info underline">Customer 360</Link>
        ) : null}
        {filing.case_id ? <Link href={`/cases/${filing.case_id}`} className="text-sm text-info underline">Case</Link> : null}
        <FilingActions filename={filing.filename} document={document} />
      </div>
      <article className="rounded-2xl border border-line bg-card p-5">
        <Fields value={document} />
      </article>
    </Shell>
  );
}
