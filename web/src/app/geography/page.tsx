import Link from "next/link";
import type { Metadata } from "next";
import { GeoMap } from "@/components/GeoMap";
import { PageIntro, Shell } from "@/components/Shell";
import { money } from "@/lib/format";
import { data } from "@/lib/snapshot";

export const metadata: Metadata = { title: "Geography" };

export default function GeographyPage() {
  const geo = data.geography;
  return (
    <Shell>
      <PageIntro
        kicker="Where the book sits"
        title="Provinces at home, countries on the wire"
        lede={geo.disclaimer}
      />
      <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <article className="rounded-2xl border border-line bg-card p-4">
          <h2 className="px-2 font-display text-2xl text-spruce">Canada</h2>
          <p className="px-2 text-sm text-muted">Circle size follows the customer count. Colour follows mean residual risk. The table is the same data, with links.</p>
          <GeoMap provinces={geo.provinces} />
          <ul className="mt-2 flex flex-wrap gap-3 px-2 text-xs text-muted">
            <li><span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#1d684f]" /> Under 25</li>
            <li><span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#9a7433]" /> 25 to 49</li>
            <li><span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#9a5720]" /> 50 to 74</li>
            <li><span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#8c2f39]" /> 75 and above</li>
          </ul>
        </article>
        <article className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-display text-2xl text-spruce">Outside Canada</h2>
          {geo.countries.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No foreign counterparty country was recorded.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {geo.countries.map((country) => (
                <li key={country.code} className="flex items-start justify-between gap-3 py-3">
                  <div>
                    <p className="font-semibold">{country.name}</p>
                    <p className="text-xs text-muted">
                      {country.code} · {country.transactions} transactions
                      {country.high_risk_jurisdiction ? " · on the placeholder higher-risk list" : ""}
                    </p>
                  </div>
                  <p className="num text-sm">{money(country.cad)}</p>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
      <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-card">
        <table className="min-w-full text-left text-sm">
          <caption className="sr-only">Customers and alerts by province</caption>
          <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3" scope="col">Province</th>
              <th className="px-4 py-3" scope="col">Customers</th>
              <th className="px-4 py-3" scope="col">Alerts</th>
              <th className="px-4 py-3" scope="col">High residual</th>
              <th className="px-4 py-3" scope="col">Mean residual</th>
            </tr>
          </thead>
          <tbody>
            {geo.provinces.map((row) => (
              <tr key={row.code} className="border-b border-line last:border-0">
                <td className="px-4 py-3">
                  <Link href={`/customers?province=${row.code}`} className="font-semibold hover:underline">{row.name}</Link>
                </td>
                <td className="num px-4 py-3">{row.customers}</td>
                <td className="num px-4 py-3">{row.alerts}</td>
                <td className="num px-4 py-3">{row.high_residual}</td>
                <td className="num px-4 py-3">{row.mean_residual}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
