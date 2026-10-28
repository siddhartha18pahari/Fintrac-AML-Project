import type { Metadata } from "next";
import { KnowledgeGraph } from "@/components/KnowledgeGraph";
import { PageIntro, Shell } from "@/components/Shell";
import { data } from "@/lib/snapshot";

export const metadata: Metadata = { title: "Graph" };

export default function GraphPage() {
  const graph = data.knowledge_graph;
  return (
    <Shell>
      <PageIntro
        kicker={`${graph.nodes.length} entities`}
        title="Follow a connection"
        lede="Customers, cases, alerts, rules, wallets, devices and beneficiaries in one graph. Zoom, drag, expand a node, or ask for a path. Colour is risk."
      />
      <KnowledgeGraph nodes={graph.nodes} edges={graph.edges} disclaimer={graph.disclaimer} />
    </Shell>
  );
}
