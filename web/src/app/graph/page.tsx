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
        lede="PyVis is the physics layout. Explore is the flat in-app graph. 3D is an ego network with risk halos, type glyphs, a timeline, and an animated path."
      />
      <Suspense fallback={<p className="text-sm text-muted">Loading the graph.</p>}>
        <GraphStudio
          nodes={graph.nodes}
          edges={graph.edges}
          disclaimer={graph.disclaimer}
          alertTimes={Object.fromEntries(data.alerts.map((alert) => [`alert:${alert.id}`, alert.occurred_at]))}
        />
      </Suspense>
    </Shell>
  );
}
