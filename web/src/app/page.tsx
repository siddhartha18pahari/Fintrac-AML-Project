import Link from "next/link";
import type { Metadata } from "next";
import { AssistNote } from "@/components/Assist";
import { PageIntro, Shell } from "@/components/Shell";
import { money } from "@/lib/format";
import { data } from "@/lib/snapshot";

export const metadata: Metadata = {
  title: "FINTRAC Sentinel",
};

const RAILS = [
  {
    name: "Large virtual currency",
    code: "LVCTR",
    detail: "CAD 10,000 or more received in virtual currency, including receipts that only cross the line once they are added inside 24 hours.",
    stat: `${data.meta.counts.lvctr} open candidates`,
    href: "/rules#AML-VC-012",
  },
  {
    name: "Large cash",
    code: "LCTR",
    detail: "Cash received for one conductor, in one amount or across the same 24-hour window. A threshold is an obligation, not a suspicion.",
    stat: `${data.meta.counts.lctr} cash alerts`,
    href: "/rules#AML-FI-001",
  },
  {
    name: "International wires",
    code: "EFTR",
    detail: "The catalogue observation is an international electronic transfer at CAD 10,000. A domestic payroll wire is out of scope for that rule.",
    stat: `${data.meta.counts.eftr} wire alerts`,
    href: "/rules#AML-FI-002",
  },
  {
    name: "Suspicion",
    code: "STR",
    detail: "Structuring, rapid movement and unusual behaviour can support a draft. The draft cites evidence. A person decides. There is no dollar safe harbour.",
    stat: `${data.meta.counts.str_drafts} grounded drafts`,
    href: "/reports",
  },
];

export default function HomePage() {
  const counts = data.meta.counts;
  const featured = data.scenarios.filter((item) =>
    ["demo_maple", "sanctions_fuzzy", "terrorist_property", "travel_rule_gap", "trade_based", "msb_payouts", "casino_minimal_play", "cash_structuring"].includes(item.scenario_type),
  );

  return (
    <Shell>
      <PageIntro
        kicker="FINTRAC Sentinel"
        title="An investigation book, not a live feed"
        lede={`${counts.transactions} synthetic transactions, ${counts.customers} customers, frozen at ${data.meta.as_of.replace("T", " ").slice(0, 16)} UTC. Follow the path across the top: portfolio, alert, customer, network, cross-border, rule, case, then the tuner.`}
      />
      <AssistNote title="Assist is optional">
        Turn Assist on in the sidebar or the top bar when you want a plain-language note on the page. Turn it off when you already know the book. Assist does not file, approve, or change a threshold by itself.
      </AssistNote>
      <div className="mb-6 flex flex-wrap gap-2">
        <Link href="/dashboard" className="btn btn-primary">Open the portfolio</Link>
        <Link href="/alerts" className="btn btn-secondary">Alert queue</Link>
        <Link href="/rules" className="btn btn-secondary">Rules</Link>
        <Link href="/statistics" className="btn btn-secondary">Threshold tuner</Link>
      </div>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Transactions", counts.transactions],
          ["Alerts", counts.alerts],
          ["Cases", counts.cases],
          ["Customers", counts.customers],
        ].map(([label, value]) => (
          <article key={String(label)} className="panel px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
            <p className="num mt-1 text-2xl font-semibold">{value}</p>
          </article>
        ))}
      </section>
      <section className="mt-6 grid gap-3 md:grid-cols-2">
        {RAILS.map((rail) => (
          <Link key={rail.code} href={rail.href} className="panel block p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{rail.code}</p>
            <h2 className="mt-1 text-base font-semibold">{rail.name}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{rail.detail}</p>
            <p className="mt-2 text-sm font-semibold">{rail.stat}</p>
          </Link>
        ))}
      </section>
      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <article className="panel p-5">
          <h2 className="text-base font-semibold">How a score is built</h2>
          <ol className="mt-3 space-y-3 text-sm leading-6">
            <li><span className="font-semibold">1. Value it.</span> CAD equivalence is stored with the rate, so a threshold can be re-derived later.</li>
            <li><span className="font-semibold">2. Aggregate it.</span> The 24-hour rule groups by conductor, beneficiary or third party.</li>
            <li><span className="font-semibold">3. Indicate.</span> Versioned rules return observed, threshold and evidence. Repeated firings of one rule do not stack.</li>
            <li><span className="font-semibold">4. Rate the relationship.</span> Inherent onboarding risk sits beside the behavioural score.</li>
            <li><span className="font-semibold">5. Draft, then stop.</span> The STR copilot cites its sentences. A person decides. Nothing is filed.</li>
          </ol>
        </article>
        <article className="panel p-5">
          <h2 className="text-base font-semibold">Planted in this book</h2>
          <ul className="mt-3 divide-y divide-line">
            {featured.map((item) => (
              <li key={item.scenario_type} className="py-3">
                <p className="text-sm font-semibold">{item.scenario_type.replaceAll("_", " ")}</p>
                <p className="mt-1 text-sm leading-6 text-muted">{item.note}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted">
            The largest receipt in view is still synthetic. {money(10000)} is a reporting line in the catalogue. Neither a high score nor that line is a finding that money laundering occurred.
          </p>
        </article>
      </section>
    </Shell>
  );
}
