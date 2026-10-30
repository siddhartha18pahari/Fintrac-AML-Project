import Link from "next/link";
import type { Metadata } from "next";
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
  return (
    <Shell>
      <PageIntro
        kicker="Where the book sits"
        title="A real map of the wires"
        lede={`${geo.disclaimer} Counterparties are drawn on a bundled Natural Earth atlas, with animated arcs to and from Canada. The 3D globe orbits the same flows. FATF call-for-action and increased-monitoring countries use the ${FATF_AS_OF} public lists, which are not the AML-VC-009 placeholder and not a sanctions list.`}
      />
      <MapStage countries={geo.countries} />
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
