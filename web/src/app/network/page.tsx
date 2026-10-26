import type { Metadata } from "next";
import { NetworkGraph } from "@/components/NetworkGraph";
import { PageIntro, Shell } from "@/components/Shell";
import { data } from "@/lib/snapshot";

export const metadata: Metadata = { title: "Network" };

function focusedGraph() {
  const nodes = data.network.nodes;
  const edges = data.network.edges;
  const walletCustomers = new Map<string, Set<number>>();
  for (const node of nodes) {
    if (node.kind !== "wallet") continue;
    const customers = new Set<number>();
    for (const edge of edges) {
      const otherId = edge.source === node.id ? edge.target : edge.target === node.id ? edge.source : null;
      if (!otherId?.startsWith("customer:")) continue;
      const customer = nodes.find((item) => item.id === otherId);
      if (typeof customer?.customer_id === "number") customers.add(customer.customer_id);
    }
    walletCustomers.set(node.id, customers);
  }
  const kept = nodes.filter((node) => {
    if (node.kind !== "wallet") return true;
    const shared = (walletCustomers.get(node.id)?.size ?? 0) >= 2;
    const hot = (node.external_risk_score ?? 0) >= 70;
    const tags = Array.isArray(node.risk_tags) ? node.risk_tags.length > 0 : false;
    return shared || hot || tags;
  });
  const ids = new Set(kept.map((node) => node.id));
  return {
    nodes: kept,
    edges: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
  };
}

export default function NetworkPage() {
  const clusters = data.links.clusters;
  const graph = focusedGraph();
  return (
    <Shell>
      <PageIntro
        kicker="Linked accounts"
        title="Who shares a wallet, a device, or a beneficiary"
        lede={`${graph.nodes.length} nodes in view — customers on the ring, shared or higher-risk wallets pulled in beside them. ${data.links.link_count} shared keys, ${clusters.length} clusters. A cluster is a reason to look together. It is not a finding.`}
      />
      <NetworkGraph nodes={graph.nodes} edges={graph.edges} />
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
