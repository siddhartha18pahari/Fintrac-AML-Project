import Link from "next/link";
import type { Metadata } from "next";
import { AssistNote, SourceNote } from "@/components/Assist";
import { Badge } from "@/components/Badges";
import { RuleBars, TierBars, VolumeChart } from "@/components/Charts";
import { IncomingHeat } from "@/components/IncomingHeat";
import { NumberTicker } from "@/components/NumberTicker";
import { PageIntro, Shell } from "@/components/Shell";
import { FundSankey, Sparkline } from "@/components/Viz";
import { money } from "@/lib/format";
import { buildIncomingHeat } from "@/lib/incoming-heat";
import { data } from "@/lib/snapshot";

export const metadata: Metadata = { title: "Overview" };

export default function DashboardPage() {
  const counts = data.meta.counts;
  const topCustomers = [...data.customers].sort((a, b) => b.risk.residual - a.risk.residual).slice(0, 6);
  const maple = data.customers.find((row) => row.name.includes("Maple"));
  const harbour = data.customers.find((row) => row.name.includes("Harbour"));
  const recent = [...data.alerts].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 6);

  const flows = { in: { CASH: 0, EFT: 0, VIRTUAL_CURRENCY: 0 }, out: { CASH: 0, EFT: 0, VIRTUAL_CURRENCY: 0 } };
  for (const txn of data.transactions) {
    const rail = txn.instrument === "CASH" || txn.instrument === "EFT" ? txn.instrument : "VIRTUAL_CURRENCY";
    const side = txn.direction === "OUTGOING" ? flows.out : flows.in;
    side[rail] += txn.cad_value;
  }
  const tone = { CASH: "#9a5720", EFT: "#1c4f78", VIRTUAL_CURRENCY: "#1d684f" } as const;
  const label = { CASH: "Cash", EFT: "Wires", VIRTUAL_CURRENCY: "Virtual" } as const;
  const spark = data.series.slice(-21).map((row) => row.total);
  const heat = buildIncomingHeat(
    data.transactions.map((txn) => ({
      at: txn.occurred_at,
      direction: txn.direction,
      cad: txn.cad_value,
      instrument: txn.instrument,
    })),
    data.meta.as_of,
    31,
  );
  const anomaly = data.anomaly[0];

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
        kicker="1 · Portfolio"
        title="The book, as of the snapshot"
        lede={`${counts.transactions} synthetic transactions across ${counts.customers} customers, frozen at ${data.meta.as_of.replace("T", " ").slice(0, 16)} UTC. Indicators are inputs to a review. They are not a disposition. Next: open an alert, then the customer, the network, and the rule that fired.`}
      />
      <AssistNote title="Where to start">
        Read the portfolio counts, then the 31-day incoming heat. A dark day is more incoming CAD, not a higher risk score. Use All customers for the full directory and Alert queue for every alert, with no filter applied. Sentinel is this snapshot plus the catalogue. It does not receive a live feed and it does not file.
      </AssistNote>
      <section className="panel mb-6 p-4 text-sm leading-6">
        <h2 className="text-base font-semibold">What Sentinel is doing</h2>
        <p className="mt-2 text-muted">
          The pipeline that produced this book valued each transaction in CAD, ran catalogue {data.meta.catalogue_version}, and stored alerts with the observed value, the threshold, and the evidence ids. Customer residual risk is the stored blend of onboarding and open-alert behaviour. The anomaly column is {anomaly?.model_name ?? "the bundled model"} {anomaly?.model_version ?? ""}, computed {anomaly?.computed_at?.replace("T", " ").slice(0, 16) ?? "with the snapshot"} UTC. Assignment and approvals after that stay in this browser. Nothing is submitted to FINTRAC.
        </p>
      </section>
      <nav aria-label="Workspace tools" className="mb-6 flex flex-wrap gap-2 text-sm">
        {[
          ["/triage", "Triage queue"],
          ["/cases", "Cases"],
          ["/simulator", "Rule simulator"],
          ["/performance", "Labelled quality"],
          ["/graph", "Knowledge graph"],
          ["/copilot", "AML copilot"],
          ["/geography", "Geography"],
          ["/filings", "Draft filings"],
        ].map(([href, label]) => (
          <Link key={href} href={href} className="pill text-sm">
            {label}
          </Link>
        ))}
      </nav>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(([label, value, note]) => (
          <article key={label} className="panel px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
                <NumberTicker value={Number(value)} className="num mt-1 block text-4xl tracking-tight text-spruce" />
                <p className="mt-1 text-sm text-muted">{note}</p>
              </div>
              <Sparkline values={spark} label={`${label} against recent volume`} />
            </div>
          </article>
        ))}
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <article className="panel p-5">
          <h2 className="text-base font-semibold text-ink">Where value moves</h2>
          <p className="mb-2 text-sm text-muted">Receipts enter on the left. Payments leave on the right. The centre is the book, not a claim that one dollar became the other.</p>
          <FundSankey
            incoming={(["CASH", "EFT", "VIRTUAL_CURRENCY"] as const).map((rail) => ({ label: label[rail], value: flows.in[rail], tone: tone[rail] }))}
            outgoing={(["CASH", "EFT", "VIRTUAL_CURRENCY"] as const).map((rail) => ({ label: label[rail], value: flows.out[rail], tone: tone[rail] }))}
          />
          <SourceNote>Sums of cad_value on the snapshot ledger, grouped by instrument and direction. Each transaction is counted once. Incoming and outgoing are not the same money. No live market feed.</SourceNote>
        </article>
        <article className="panel p-5">
          <h2 className="text-base font-semibold text-ink">Incoming heat, 31 days</h2>
          <p className="mb-4 text-sm text-muted">{heat.start} through {heat.end}, Monday to Sunday. Select a day for the amount and the count.</p>
          <IncomingHeat rows={heat.rows} start={heat.start} end={heat.end} max={heat.max} />
          <SourceNote>
            {heat.days} calendar days ending on the snapshot date. Amount is the sum of incoming cad_value. Count is the number of those transactions ({heat.incomingCount} in the window). {heat.excludedOutgoing} outgoing transactions are excluded. Days with no incoming row are zero, not omitted. The daily series chart below drops empty days.
          </SourceNote>
        </article>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <article className="panel p-5">
          <h2 className="text-base font-semibold text-ink">Incoming value</h2>
          <p className="mb-3 text-sm text-muted">Last 21 days that have an incoming total, split by rail. The axis is CAD. Empty calendar days are not drawn.</p>
          <VolumeChart series={data.series.slice(-21)} />
          <SourceNote>Built from the snapshot series: incoming transactions only, summed by calendar day into cash, electronic transfer, and virtual currency. Window {data.series.slice(-21)[0]?.date} to {data.series.at(-1)?.date}.</SourceNote>
        </article>
        <article className="panel p-5">
          <h2 className="text-base font-semibold text-ink">Residual risk</h2>
          <p className="mb-4 text-sm text-muted">{counts.customers} relationships, counted by the stored tier. No shadow and no pulse: the length is the count.</p>
          <TierBars tiers={data.kpis.tiers} total={counts.customers} />
          <SourceNote>Counts come from the snapshot tier rollup. Each customer’s stored residual is round(0.6 × inherent + 0.7 × behavioural), clamped to 0–100. This card does not recompute it and does not change the count.</SourceNote>
          <h3 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wider text-muted">Most common rules</h3>
          <RuleBars rules={data.kpis.rules} />
        </article>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <article className="panel p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink">Highest residual risk</h2>
              <p className="text-xs text-muted">Six stored scores. The directory is the full book of {counts.customers}.</p>
            </div>
            <Link href="/customers" className="btn btn-secondary">All customers</Link>
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
        <article className="panel p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink">Latest alerts</h2>
              <p className="text-xs text-muted">Six most recent. The queue opens with no severity or rule filter.</p>
            </div>
            <Link href="/alerts" className="btn btn-secondary">Alert queue</Link>
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
          <Link href={`/customers/${harbour.id}`} className="panel block p-5">
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
