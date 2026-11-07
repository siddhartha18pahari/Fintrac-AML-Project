"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { money, when } from "@/lib/format";

export type CorridorTxn = {
  id: number;
  ref: string;
  at: string;
  direction: string;
  instrument: string;
  cad: number;
  asset: string;
  customer: string;
  customerId: number;
  country: string;
  countryName: string;
  highRiskPlaceholder: boolean;
};

export function CrossBorderBoard({
  rows,
  asOf,
  fatfAsOf,
}: {
  rows: CorridorTxn[];
  asOf: string;
  fatfAsOf: string;
}) {
  const corridors = useMemo(() => {
    const map = new Map<string, { code: string; name: string; incoming: number; outgoing: number; count: number; highRiskPlaceholder: boolean }>();
    for (const row of rows) {
      const current = map.get(row.country) ?? {
        code: row.country,
        name: row.countryName,
        incoming: 0,
        outgoing: 0,
        count: 0,
        highRiskPlaceholder: row.highRiskPlaceholder,
      };
      if (row.direction === "OUTGOING") current.outgoing += row.cad;
      else current.incoming += row.cad;
      current.count += 1;
      current.highRiskPlaceholder = current.highRiskPlaceholder || row.highRiskPlaceholder;
      map.set(row.country, current);
    }
    return [...map.values()].sort((left, right) => right.incoming + right.outgoing - (left.incoming + left.outgoing));
  }, [rows]);
  const [code, setCode] = useState(corridors[0]?.code ?? "");
  const selected = corridors.find((row) => row.code === code) ?? corridors[0];
  const evidence = rows.filter((row) => row.country === selected?.code).sort((left, right) => right.at.localeCompare(left.at));
  const start = rows.reduce((min, row) => (row.at < min ? row.at : min), rows[0]?.at ?? asOf);
  const end = rows.reduce((max, row) => (row.at > max ? row.at : max), rows[0]?.at ?? asOf);

  if (!selected) {
    return <p className="text-sm text-muted">No transaction in the snapshot carries a foreign counterparty country.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted">
        Canada is the book’s home. A corridor is a counterparty country on a transaction, from {start.slice(0, 10)} to {end.slice(0, 10)}. Incoming and outgoing CAD are separate sums. The placeholder higher-risk flag is AML-VC-009’s configured list, not the FATF public lists of {fatfAsOf} and not a sanctions determination.
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        {corridors.map((corridor) => {
          const pressed = corridor.code === selected.code;
          return (
            <button
              key={corridor.code}
              type="button"
              aria-pressed={pressed}
              onClick={() => setCode(corridor.code)}
              className="rounded-md border px-3 py-3 text-left"
              style={{
                borderColor: pressed ? "var(--color-accent)" : "var(--color-line)",
                background: pressed ? "var(--color-selected)" : "var(--color-card)",
              }}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">{corridor.name}</span>
                <span className="num text-xs text-muted">{corridor.code} · {corridor.count}</span>
              </span>
              <span className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <span>In <span className="num">{money(corridor.incoming)}</span></span>
                <span>Out <span className="num">{money(corridor.outgoing)}</span></span>
              </span>
              <span className="mt-1 block text-xs text-muted">
                {corridor.highRiskPlaceholder ? "Placeholder higher-risk jurisdiction on AML-VC-009" : "No placeholder higher-risk flag on this corridor"}
              </span>
            </button>
          );
        })}
      </div>
      <div className="table-shell">
        <div className="px-4 pt-4">
          <h2 className="text-base font-semibold">Canada → {selected.name} evidence</h2>
          <p className="mt-1 text-sm text-muted">
            {evidence.length} transaction{evidence.length === 1 ? "" : "s"}. Amounts are the stored CAD values. Direction is the book’s direction, not a second conversion.
          </p>
        </div>
        <table className="data-table min-w-full">
          <caption className="sr-only">Transactions on the selected corridor</caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Direction</th>
              <th scope="col">Rail</th>
              <th scope="col">CAD</th>
              <th scope="col">Customer</th>
            </tr>
          </thead>
          <tbody>
            {evidence.map((row) => (
              <tr key={row.id}>
                <td className="num">{when(row.at)}</td>
                <td>{row.direction === "OUTGOING" ? "Outgoing" : "Incoming"}</td>
                <td>{row.instrument === "VIRTUAL_CURRENCY" ? row.asset : row.instrument}</td>
                <td className="num">{money(row.cad)}</td>
                <td>
                  <Link href={`/customers/${row.customerId}`} className="font-semibold hover:underline">{row.customer}</Link>
                  <div>
                    <Link href={`/transactions/${row.id}`} className="text-xs text-info underline">{row.ref}</Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
