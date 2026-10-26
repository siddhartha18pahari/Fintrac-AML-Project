import Link from "next/link";
import type { Metadata } from "next";
import { InstrumentTag } from "@/components/Badges";
import { PageIntro, Shell } from "@/components/Shell";
import { money, shortAddress, when } from "@/lib/format";
import type { TransactionRow } from "@/lib/snapshot";
import { filterTransactions } from "@/lib/queries";

export const metadata: Metadata = { title: "Transactions" };

type Search = { q?: string; instrument?: string; direction?: string; min?: string };

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const filters = await searchParams;
  const rows = filterTransactions(filters).slice().reverse();

  function counterparty(txn: TransactionRow) {
    const wallet = txn.direction === "INCOMING" ? txn.wallet_from : txn.wallet_to;
    if (wallet) return shortAddress(wallet);
    const context = txn.context as { counterparty_institution?: string };
    if (context.counterparty_institution) return context.counterparty_institution;
    if (txn.instrument === "CASH") return "Cash receipt";
    if (txn.instrument === "EFT") return "Electronic transfer";
    return "—";
  }

  return (
    <Shell>
      <PageIntro
        kicker="Ledger"
        title="Every movement in the snapshot"
        lede="Virtual currency, cash and wires share one ledger. The CAD figure is the one the threshold rules use."
      />
      <form method="get" className="mb-4 grid gap-3 rounded-2xl border border-line bg-card p-4 md:grid-cols-[1fr_180px_160px_120px_auto]" role="search">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Search</span>
          <input name="q" defaultValue={filters.q ?? ""} placeholder="Name, reference, asset, address" className="w-full rounded-md border border-line bg-white px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Rail</span>
          <select name="instrument" defaultValue={filters.instrument ?? ""} className="w-full rounded-md border border-line bg-white px-3 py-2">
            <option value="">Any</option>
            <option value="VIRTUAL_CURRENCY">Virtual currency</option>
            <option value="CASH">Cash</option>
            <option value="EFT">Electronic transfer</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Direction</span>
          <select name="direction" defaultValue={filters.direction ?? ""} className="w-full rounded-md border border-line bg-white px-3 py-2">
            <option value="">Any</option>
            <option value="INCOMING">Incoming</option>
            <option value="OUTGOING">Outgoing</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Min CAD</span>
          <input name="min" inputMode="decimal" defaultValue={filters.min ?? ""} placeholder="10000" className="w-full rounded-md border border-line bg-white px-3 py-2" />
        </label>
        <div className="flex items-end">
          <button type="submit" className="rounded-md bg-spruce px-4 py-2 text-sm font-semibold text-white">Apply</button>
        </div>
      </form>
      <p className="mb-3 text-sm text-muted">{rows.length} transaction{rows.length === 1 ? "" : "s"}</p>
      <div className="overflow-x-auto rounded-2xl border border-line bg-card">
        <table className="min-w-full text-left text-sm">
          <caption className="sr-only">Filtered transactions</caption>
          <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3" scope="col">When</th>
              <th className="px-4 py-3" scope="col">Customer</th>
              <th className="px-4 py-3" scope="col">Rail</th>
              <th className="px-4 py-3" scope="col">Flow</th>
              <th className="px-4 py-3" scope="col">Counterparty</th>
              <th className="px-4 py-3" scope="col">CAD</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-muted">No transactions match these filters.</td></tr>
            ) : rows.map((txn) => (
              <tr key={txn.id} className="border-b border-line last:border-0">
                <td className="num whitespace-nowrap px-4 py-3">{when(txn.occurred_at)}</td>
                <td className="px-4 py-3">
                  <Link href={`/transactions/${txn.id}`} className="font-semibold hover:underline">{txn.transaction_id}</Link>
                  <p className="text-xs text-muted">{txn.customer_name}</p>
                </td>
                <td className="px-4 py-3"><InstrumentTag value={txn.instrument} /></td>
                <td className="px-4 py-3">{txn.direction === "INCOMING" ? "In" : "Out"} · {txn.asset}</td>
                <td className="px-4 py-3 font-mono text-xs">{counterparty(txn)}</td>
                <td className="num px-4 py-3">{money(txn.cad_value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
