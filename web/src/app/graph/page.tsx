import { Suspense } from "react";
import type { Metadata } from "next";
import { GraphStudio } from "@/components/GraphStudio";
import { PageIntro, Shell } from "@/components/Shell";
import { data } from "@/lib/snapshot";

export const metadata: Metadata = { title: "Graph" };

export default function GraphPage() {
  const graph = data.knowledge_graph;
  return (
    <Shell wide>
      <PageIntro
        kicker={`${graph.nodes.length} entities`}
        title="Follow a connection"
        lede="The PyVis view is a physics layout grouped by entity type. Explore is the in-app graph: clusters, search, neighbour highlight, risk and type filters, and a path to a sanctions node. Colour is risk."
      />
      <Suspense fallback={<p className="text-sm text-muted">Loading the graph.</p>}>
        <GraphStudio nodes={graph.nodes} edges={graph.edges} disclaimer={graph.disclaimer} />
      </Suspense>
    </Shell>
  );
}
