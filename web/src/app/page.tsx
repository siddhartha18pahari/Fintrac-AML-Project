import Link from "next/link";
import type { Metadata } from "next";
import { GlobeSlot } from "@/components/globe/GlobeSlot";
import { HeroField, StatCounter } from "@/components/HeroField";
import { LiveAlertFeed } from "@/components/LiveAlertFeed";
import { Reveal } from "@/components/Reveal";
import { StoryRails } from "@/components/StoryRails";
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

const FEATURES = [
  {
    title: "Sample-list screening",
    stat: `${data.meta.counts.sanctions} sanctions · ${data.meta.counts.pep} PEP`,
    detail: "Fuzzy name matching against a fictional sanctions and PEP list. A hit records the score. It is not a legal designation.",
    className: "lg:col-span-7",
  },
  {
    title: "Terrorist property",
    stat: `${data.meta.counts.tpr} sample observation`,
    detail: "A match on the fictional property list is kept apart from suspicion, the same way a large-cash threshold is.",
    className: "lg:col-span-4",
  },
  {
    title: "Travel rule",
    stat: `${data.meta.counts.travel} incomplete wire`,
    detail: "International EFTs are checked for originator and beneficiary fields. A blank is a record defect.",
    className: "lg:col-span-3",
  },
  {
    title: "Typologies",
    stat: `${data.meta.counts.trade} trade · ${data.meta.counts.msb} MSB · ${data.meta.counts.casino} casino`,
    detail: "Invoice gaps, multi-beneficiary MSB payouts, and casino chips with almost no play.",
    className: "md:col-span-2 lg:col-span-12",
  },
];

export default function HomePage() {
  const counts = data.meta.counts;
  const countries = data.geography.countries.map((country) => ({
    code: country.code,
    name: country.name,
    incoming_cad: country.incoming_cad,
    outgoing_cad: country.outgoing_cad,
  }));
  const feed = [...data.alerts]
    .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at))
    .slice(0, 6)
    .map((alert) => ({
      id: alert.id,
      title: alert.title,
      severity: alert.severity,
      customer: alert.customer_name,
      rule: alert.rule_id,
      at: alert.occurred_at,
      href: `/alerts/${alert.id}`,
    }));
  const featured = data.scenarios.filter((item) =>
    ["demo_maple", "sanctions_fuzzy", "terrorist_property", "travel_rule_gap", "trade_based", "msb_payouts", "casino_minimal_play", "cash_structuring"].includes(item.scenario_type),
  );

  return (
    <div>
      <header className="relative isolate overflow-hidden bg-[#050d0b] text-[#f6f3ea]">
        <div className="aurora pointer-events-none absolute -left-24 top-0 h-[28rem] w-[28rem] rounded-full bg-[#9a7433]/35 blur-3xl" aria-hidden="true" />
        <div className="aurora pointer-events-none absolute bottom-0 right-0 h-[34rem] w-[34rem] rounded-full bg-[#1d684f]/40 blur-3xl" aria-hidden="true" />
        <div className="aurora pointer-events-none absolute left-1/3 top-16 h-72 w-72 rounded-full bg-[#5b6fd6]/25 blur-3xl" aria-hidden="true" />
        <HeroField />
        <div className="hero-grid pointer-events-none absolute inset-0 opacity-70" aria-hidden="true" />
        <div className="relative z-10 mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brass-soft">Canada · AML monitoring</p>
            <p className="font-display text-2xl tracking-tight text-white">FINTRAC Sentinel</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-[#c9d8d1] sm:inline">Synthetic book · {data.meta.as_of.slice(0, 10)}</span>
            <Link href="/dashboard" className="glow-cta px-4 py-2 text-sm">
              Open workspace
            </Link>
          </div>
        </div>
        <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-8 px-4 pb-16 pt-6 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:pb-20 lg:pt-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#e2c48a]">Explainable monitoring</p>
            <h1 className="grad-text-live mt-3 max-w-xl font-display text-5xl leading-[0.98] tracking-[-0.045em] sm:text-7xl">
              Detect. Explain. Then let a person decide.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#d5e3dc]">
              Sentinel watches a virtual-currency ledger and the cash and wire rails beside it.
              Every alert names what was observed, the threshold it was compared with, and the transactions that are the evidence.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/dashboard" className="glow-cta px-5 py-2.5 text-sm">
                Review the book
              </Link>
              <Link href="/reports" className="ghost-cta">
                Read an STR draft
              </Link>
              <Link href="/geography" className="ghost-cta">
                Open the map
              </Link>
              <Link href="/graph" className="ghost-cta">
                Trace the graph
              </Link>
            </div>
          </div>
          <div className="relative h-[420px] sm:h-[520px]">
            <GlobeSlot countries={countries} variant="hero" />
            <p className="pointer-events-none absolute left-2 top-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#e2c48a]">
              Canada and the book&apos;s counterparties
            </p>
            <dl className="absolute inset-x-2 bottom-2 grid grid-cols-2 gap-2 sm:inset-x-4 sm:bottom-4">
              <StatCounter label="Transactions" value={counts.transactions} />
              <StatCounter label="Alerts" value={counts.alerts} />
              <StatCounter label="Cases" value={counts.cases} />
              <StatCounter label="Customers" value={counts.customers} />
            </dl>
          </div>
        </div>
        <p className="scroll-cue relative z-10 pb-8 text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9ad7c4]">Scroll the book</p>
      </header>

      <StoryRails rails={RAILS} />

      <section className="mx-auto max-w-6xl px-4 pb-8 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brass">Inside the workspace</p>
          <h2 className="mt-2 font-display text-4xl tracking-[-0.04em] text-spruce">A desk, not a dashboard costume</h2>
          <p className="mt-3 text-muted">
            Screening, property, travel-rule gaps and typologies stay labelled as what they are. Open any tile and the evidence is still attached.
          </p>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-12">
          <Reveal className="md:col-span-2 lg:col-span-5 lg:row-span-2">
            <LiveAlertFeed alerts={feed} />
          </Reveal>
          {FEATURES.map((feature, index) => (
            <Reveal key={feature.title} className={feature.className} delay={0.05 * index}>
              <article className="panel glass h-full p-5">
                <h3 className="font-display text-2xl text-spruce">{feature.title}</h3>
                <p className="mt-2 text-sm font-semibold">{feature.stat}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted">{feature.detail}</p>
              </article>
            </Reveal>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["/triage", "Triage queue"],
            ["/geography", "Geography"],
            ["/graph", "Knowledge graph"],
            ["/copilot", "AML copilot"],
          ].map(([href, label]) => (
            <Link key={href} href={href} className="pill text-center text-sm text-ink">
              {label}
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-10 border-y border-line bg-card/70">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brass">How a score is built</p>
            <h2 className="mt-2 font-display text-4xl tracking-[-0.04em] text-spruce">No bare number</h2>
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

      <section className="relative overflow-hidden bg-[#071410] text-[#f6f3ea]">
        <div className="aurora pointer-events-none absolute -left-10 top-0 h-64 w-64 rounded-full bg-[#9a7433]/30 blur-3xl" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#e2c48a]">The line we do not cross</p>
            <h2 className="grad-text-live mt-3 max-w-xl font-display text-4xl tracking-[-0.04em] sm:text-6xl">A person still decides.</h2>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-[#d5e3dc]">
              Nothing is filed. The largest receipt in view is still synthetic. A high score is a reason to look, {money(10000)} is a reporting line, and neither one is a finding that money laundering occurred.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/dashboard" className="glow-cta px-5 py-2.5 text-sm">
                Enter the workspace
              </Link>
              <Link href="/filings" className="ghost-cta">
                Draft filings
              </Link>
            </div>
          </div>
          <article className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
            <h3 className="font-display text-2xl text-white">Deploy the workspace</h3>
            <p className="mt-3 text-sm leading-relaxed text-[#d5e3dc]">
              Point a Vercel project at the <code className="code">web</code> directory.
              Framework preset Next.js. Build command <code className="code">next build</code>.
              No database, no environment variables, no external services. The pages and the API routes read a bundled snapshot produced by the Python detection pipeline.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[#d5e3dc]">
              Regenerate that snapshot from the repository root with <code className="code">python -m scripts.export_snapshot</code> after the rule catalogue changes.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
