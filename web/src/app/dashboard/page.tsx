import Link from "next/link";
import type { Metadata } from "next";
import { Badge } from "@/components/Badges";
import { RuleBars, TierBars, VolumeChart } from "@/components/Charts";
import { PageIntro, Shell } from "@/components/Shell";
import { money } from "@/lib/format";
import { data } from "@/lib/snapshot";

export const metadata: Metadata = { title: "Overview" };

export default function DashboardPage() {
  const counts = data.meta.counts;
  const topCustomers = [...data.customers].sort((a, b) => b.risk.residual - a.risk.residual).slice(0, 6);
  const maple = data.customers.find((row) => row.name.includes("Maple"));
  const harbour = data.customers.find((row) => row.name.includes("Harbour"));
  const recent = [...data.alerts].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 6);

  const cards = [
    ["Alerts", counts.alerts, "Open indicators across the book"],
    ["Cases", counts.cases, "Subjects above the triage line or with a reporting duty"],
    ["LVCTR", counts.lvctr, "Virtual-currency receipts at CAD 10,000"],
    ["LCTR", counts.lctr, "Cash receipts at the same line"],
    ["EFTR", counts.eftr, "International electronic transfers"],
    ["STR drafts", counts.str_drafts, "Narratives that passed the claim check"],
  ];

  return (
    <Shell>
      <PageIntro
        kicker="Monitoring workspace"
        title="The book, as of the snapshot"
        lede={`${counts.transactions} synthetic transactions across ${counts.customers} customers. Indicators are inputs to a review. They are not a disposition.`}
      />
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(([label, value, note]) => (
          <article key={label} className="rounded-2xl border border-line bg-card px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
            <p className="num mt-1 font-display text-4xl text-spruce">{value}</p>
            <p className="mt-1 text-sm text-muted">{note}</p>
          </article>
        ))}
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <article className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-display text-2xl text-spruce">Incoming value</h2>
          <p className="mb-3 text-sm text-muted">Last three weeks of receipts, split by rail. Cash spikes are the planted LCTR and structuring days.</p>
          <VolumeChart />
        </article>
        <article className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-display text-2xl text-spruce">Residual risk</h2>
          <p className="mb-4 text-sm text-muted">Inherent onboarding risk blended with the open alert score. {counts.customers} relationships.</p>
          <TierBars />
          <h3 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wider text-muted">Most common rules</h3>
          <RuleBars />
        </article>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-line bg-card p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-display text-2xl text-spruce">Highest residual risk</h2>
            <Link href="/customers" className="text-sm text-info underline">All customers</Link>
          </div>
          <ul className="divide-y divide-line">
            {topCustomers.map((customer) => (
              <li key={customer.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <Link href={`/customers/${customer.id}`} className="font-semibold hover:underline">{customer.name}</Link>
                  <p className="text-xs text-muted">{customer.occupation_or_business}</p>
                </div>
                <div className="text-right">
                  <Badge value={customer.risk.tier} />
                  <p className="num mt-1 text-sm">{customer.risk.residual}</p>
                </div>
              </li>
            ))}
          </ul>
        </article>
        <article className="rounded-2xl border border-line bg-card p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-display text-2xl text-spruce">Latest alerts</h2>
            <Link href="/alerts" className="text-sm text-info underline">Alert queue</Link>
          </div>
          <ul className="divide-y divide-line">
            {recent.map((alert) => (
              <li key={alert.id} className="py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/alerts/${alert.id}`} className="text-sm font-semibold hover:underline">{alert.title}</Link>
                  <Badge value={alert.severity} />
                </div>
                <p className="mt-1 text-xs text-muted">{alert.customer_name} · {alert.rule_id} · {alert.occurred_at.slice(0, 16).replace("T", " ")}</p>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        {maple ? (
          <Link href={`/customers/${maple.id}`} className="rounded-2xl bg-spruce p-5 text-[#f4f7f5]">
            <p className="text-xs uppercase tracking-wider text-brass-soft">Flagship virtual-currency case</p>
            <h2 className="mt-2 font-display text-2xl text-white">{maple.name}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#d5e3dc]">
              Declared about {money(maple.expected_monthly_volume_cad)} a month, then took a day of fan-in, a pass-through and a shared beneficiary. Residual {maple.risk.residual}.
            </p>
          </Link>
        ) : null}
        {harbour ? (
          <Link href={`/customers/${harbour.id}`} className="rounded-2xl border border-line bg-card p-5">
            <p className="text-xs uppercase tracking-wider text-brass">Flagship cash case</p>
            <h2 className="mt-2 font-display text-2xl text-spruce">{harbour.name}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Four cash receipts, each under CAD 10,000, together well over it. Large-cash obligation and a structuring indicator, scored apart. Residual {harbour.risk.residual}.
            </p>
          </Link>
        ) : null}
      </section>
    </Shell>
  );
}
