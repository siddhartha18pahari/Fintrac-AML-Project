import Link from "next/link";
import type { Metadata } from "next";
import { AssistNote } from "@/components/Assist";
import { CrossBorderBoard } from "@/components/CrossBorderBoard";
import { PageIntro, Shell } from "@/components/Shell";
import { MapStage } from "@/components/MapStage";
import { FATF_AS_OF } from "@/lib/fatf";
import { data } from "@/lib/snapshot";

export const metadata: Metadata = { title: "Geography" };

function tone(value: number) {
  if (value >= 75) return "var(--color-critical)";
  if (value >= 50) return "var(--color-high)";
  if (value >= 25) return "var(--color-brass)";
  return "var(--color-low)";
}

export default function GeographyPage() {
  const geo = data.geography;
  const names = new Map(geo.countries.map((country) => [country.code, country]));
  const corridors = data.transactions.flatMap((txn) => {
    const context = txn.context ?? {};
    const code = typeof context.counterparty_country === "string"
      ? context.counterparty_country
      : typeof context.beneficiary_country === "string"
        ? context.beneficiary_country
        : "";
    if (!code || code === "CA") return [];
    const country = names.get(code);
    return [{
      id: txn.id,
      ref: txn.transaction_id,
      at: txn.occurred_at,
      direction: txn.direction,
      instrument: txn.instrument,
      cad: Number(txn.cad_value),
      asset: txn.asset,
      customer: txn.customer_name ?? "Customer",
      customerId: txn.customer_id,
      country: code,
      countryName: country?.name ?? code,
      highRiskPlaceholder: Boolean(country?.high_risk_jurisdiction),
    }];
  });
  return (
    <Shell>
      <PageIntro
        kicker="4 · Cross-border"
        title="From Canada to the counterparty"
        lede={`${geo.disclaimer} Select a corridor to read incoming and outgoing CAD and the transactions behind them. The atlas is a bundled Natural Earth map. FATF call-for-action and increased-monitoring shading uses the ${FATF_AS_OF} public lists. That shading is not the AML-VC-009 placeholder and not a sanctions list.`}
      />
      <AssistNote title="Two different country signals">
        Transaction exposure is the CAD on a corridor. Geographic risk in the rule catalogue is a placeholder list. A country can have a large outgoing sum and no placeholder flag, or the reverse. Do not describe either one as a FATF finding.
      </AssistNote>
      <CrossBorderBoard rows={corridors} asOf={data.meta.as_of} fatfAsOf={FATF_AS_OF} />
      <div className="mt-6">
        <MapStage countries={geo.countries} />
      </div>
      <div className="table-shell mt-6">
        <div className="px-4 pt-4">
          <h2 className="font-display text-2xl text-spruce">Onboarding provinces</h2>
          <p className="mt-1 text-sm text-muted">Province is the customer address, not a wire destination. The bar is mean residual risk.</p>
        </div>
        <table className="data-table min-w-full">
          <caption className="sr-only">Customers and alerts by province</caption>
          <thead>
            <tr>
              <th scope="col">Province</th>
              <th scope="col">Customers</th>
              <th scope="col">Alerts</th>
              <th scope="col">High residual</th>
              <th scope="col">Mean residual</th>
            </tr>
          </thead>
          <tbody>
            {geo.provinces.map((row) => (
              <tr key={row.code}>
                <td>
                  <Link href={`/customers?province=${row.code}`} className="font-semibold hover:underline">{row.name}</Link>
                  <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(4, Math.min(100, row.mean_residual))}%`, background: tone(row.mean_residual) }} />
                  </div>
                </td>
                <td className="num">{row.customers}</td>
                <td className="num">{row.alerts}</td>
                <td className="num">{row.high_residual}</td>
                <td className="num">{row.mean_residual}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
