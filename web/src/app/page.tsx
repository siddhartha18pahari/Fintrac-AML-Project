import Link from "next/link";
import type { Metadata } from "next";
import { data } from "@/lib/snapshot";
import { money } from "@/lib/format";

export const metadata: Metadata = {
  title: "FINTRAC Sentinel",
};

const RAILS = [
  {
    name: "Large virtual currency",
    code: "LVCTR",
    detail: "CAD 10,000 or more received in virtual currency, including receipts that only cross the line once they are added inside 24 hours.",
    stat: `${data.meta.counts.lvctr} open candidates`,
  },
  {
    name: "Large cash",
    code: "LCTR",
    detail: "Cash received for one conductor, in one amount or across the same 24-hour window. A threshold is an obligation, not a suspicion.",
    stat: `${data.meta.counts.lctr} cash alerts`,
  },
  {
    name: "International wires",
    code: "EFTR",
    detail: "Electronic funds transfers that cross the border at CAD 10,000 or more. A domestic payroll wire is out of scope.",
    stat: `${data.meta.counts.eftr} wire alert`,
  },
  {
    name: "Suspicion",
    code: "STR",
    detail: "Structuring, rapid movement between rails, high-risk exposure and unusual behaviour. A draft cites its evidence. A person decides.",
    stat: `${data.meta.counts.str_drafts} grounded drafts`,
  },
];

export default function HomePage() {
  const counts = data.meta.counts;
  const featured = data.scenarios.filter((item) =>
    ["demo_maple", "cash_structuring", "eftr_international", "rapid_cross_rail", "smurf_ring", "near_threshold"].includes(item.scenario_type),
  );

  return (
    <div>
      <header className="border-b border-white/10 bg-spruce-deep text-[#f6f3ea]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brass-soft">Canada · AML monitoring</p>
            <p className="font-display text-2xl text-white">FINTRAC Sentinel</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-[#c9d8d1] sm:inline">Synthetic book · {data.meta.as_of.slice(0, 10)}</span>
            <Link href="/dashboard" className="rounded-full bg-brass-soft px-4 py-2 text-sm font-semibold text-spruce-deep">
              Open workspace
            </Link>
          </div>
        </div>
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.4fr_0.8fr] lg:py-20">
          <div>
            <h1 className="max-w-xl font-display text-4xl leading-[1.05] tracking-tight text-white sm:text-6xl">
              Detect. Explain. Then let a person decide.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#d5e3dc]">
              Sentinel watches a virtual-currency ledger and the cash and wire rails beside it.
              Every alert names what was observed, the threshold it was compared with, and the transactions that are the evidence.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/dashboard" className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-spruce">
                Review the book
              </Link>
              <Link href="/reports" className="rounded-full border border-white/30 px-5 py-2.5 text-sm font-semibold text-white">
                Read an STR draft
              </Link>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 self-end">
            {[
              ["Transactions", counts.transactions],
              ["Alerts", counts.alerts],
              ["Cases", counts.cases],
              ["Customers", counts.customers],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <dt className="text-xs uppercase tracking-wider text-[#b7c9c0]">{label}</dt>
                <dd className="num mt-1 font-display text-3xl text-white">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brass">Reporting obligations</p>
          <h2 className="mt-2 font-display text-3xl text-spruce">Four questions, kept separate</h2>
          <p className="mt-3 text-muted">
            An LVCTR is arithmetic. An STR is a judgement. Mixing them is how a compliance program starts treating every large receipt as suspicious, or waving away a real reporting duty because nobody felt uneasy.
          </p>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {RAILS.map((rail) => (
            <article key={rail.code} className="rounded-2xl border border-line bg-card p-5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display text-2xl text-spruce">{rail.name}</h3>
                <span className="text-xs font-semibold tracking-wider text-brass">{rail.code}</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted">{rail.detail}</p>
              <p className="mt-4 text-sm font-semibold text-ink">{rail.stat}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-card/70">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brass">How a score is built</p>
            <h2 className="mt-2 font-display text-3xl text-spruce">No bare number</h2>
            <ol className="mt-6 space-y-4 text-sm leading-relaxed">
              <li><span className="font-semibold">1. Value it.</span> CAD equivalence is snapshotted with the rate, so a threshold can be re-derived later.</li>
              <li><span className="font-semibold">2. Aggregate it.</span> The 24-hour rule groups by conductor, beneficiary or third party, and absorbs duplicates.</li>
              <li><span className="font-semibold">3. Indicate.</span> Versioned rules return observed, threshold and evidence. Repeated firings of one rule do not stack.</li>
              <li><span className="font-semibold">4. Rate the relationship.</span> Inherent risk from onboarding sits beside the behavioural score.</li>
              <li><span className="font-semibold">5. Draft, then stop.</span> The STR copilot cites every sentence and rejects claims the facts do not contain.</li>
            </ol>
          </div>
          <div>
            <h3 className="font-display text-2xl text-spruce">Planted in this book</h3>
            <ul className="mt-4 divide-y divide-line">
              {featured.map((item) => (
                <li key={item.scenario_type} className="py-3">
                  <p className="text-sm font-semibold">{item.scenario_type.replaceAll("_", " ")}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{item.note}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-3">
          <article className="rounded-2xl border border-line bg-card p-5 lg:col-span-2">
            <h2 className="font-display text-2xl text-spruce">Deploy the workspace</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Point a Vercel project at the <code className="rounded bg-[#f6f1e6] px-1">web</code> directory.
              Framework preset Next.js. Build command <code className="rounded bg-[#f6f1e6] px-1">next build</code>.
              No database, no environment variables, no external services. The pages and the API routes read a bundled snapshot produced by the Python detection pipeline.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Regenerate that snapshot from the repository root with <code className="rounded bg-[#f6f1e6] px-1">python -m scripts.export_snapshot</code> after the rule catalogue changes.
              The operational FastAPI console remains the system of record for case workflow and is documented separately.
            </p>
          </article>
          <article className="rounded-2xl bg-spruce p-5 text-[#e7f0eb]">
            <h2 className="font-display text-2xl text-white">What this is not</h2>
            <p className="mt-3 text-sm leading-relaxed text-[#d5e3dc]">
              Nothing is filed. The largest receipt in view is still synthetic. A high score is a reason to look, {money(10000)} is a reporting line, and neither one is a finding that money laundering occurred.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
