import type { Metadata } from "next";
import { ForceNetwork } from "@/components/ForceNetwork";
import { PageIntro, Shell } from "@/components/Shell";
import { data } from "@/lib/snapshot";

export const metadata: Metadata = { title: "Network" };

export default function NetworkPage() {
  const clusters = data.links.clusters;
  return (
    <Shell>
      <PageIntro
        kicker="Linked accounts"
        title="Follow the money, then the pattern"
        lede="Force layout over the transaction graph. Communities come from Louvain, node size from betweenness, and particles ride the wires. Gold marks a round-trip. The time slider drops transactions outside the window."
      />
      <ForceNetwork nodes={data.network.nodes} edges={data.network.edges} />
      <section className="mt-6">
        <h2 className="mb-3 font-display text-2xl text-spruce">Clusters</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {clusters.map((cluster) => (
            <article key={cluster.id} className="rounded-2xl border border-line bg-card p-4">
              <p className="text-xs uppercase tracking-wider text-muted">{cluster.id} · {cluster.size} customers</p>
              <ul className="mt-2 text-sm font-semibold">
                {cluster.customers.map((customer) => (
                  <li key={customer.id}>
                    <a className="hover:underline" href={`/customers/${customer.id}`}>{customer.name}</a>
                  </li>
                ))}
              </ul>
              <ul className="mt-3 space-y-1 text-xs text-muted">
                {cluster.links.slice(0, 4).map((link) => (
                  <li key={`${link.kind}-${link.key}`}>
                    Shared {link.kind}: {link.label.length > 42 ? `${link.label.slice(0, 18)}…${link.label.slice(-8)}` : link.label}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </Shell>
  );
}
