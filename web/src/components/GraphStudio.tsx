"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { KnowledgeGraph, type GraphEdge, type GraphNode } from "@/components/KnowledgeGraph";
import { KnowledgeGraph3D } from "@/components/KnowledgeGraph3D";
import type { EdgeFact } from "@/lib/graph-evidence";

export function GraphStudio({
  nodes,
  edges,
  disclaimer,
  alertTimes,
  facts,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  disclaimer: string;
  alertTimes: Record<string, string>;
  facts: Record<string, EdgeFact>;
}) {
  const params = useSearchParams();
  const initial = params.get("view");
  const focus = params.get("focus");
  const [view, setView] = useState<"pyvis" | "explore" | "orbit">(initial === "explore" || (!initial && focus) ? "explore" : initial === "orbit" ? "orbit" : "pyvis");

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Graph view" className="inline-flex rounded-full border border-line bg-card/80 p-1">
          <button
            type="button"
            role="tab"
            aria-selected={view === "pyvis"}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${view === "pyvis" ? "bg-spruce text-white" : "text-muted hover:text-ink"}`}
            onClick={() => setView("pyvis")}
          >
            PyVis
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "explore"}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${view === "explore" ? "bg-spruce text-white" : "text-muted hover:text-ink"}`}
            onClick={() => setView("explore")}
          >
            Explore
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "orbit"}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${view === "orbit" ? "bg-spruce text-white" : "text-muted hover:text-ink"}`}
            onClick={() => setView("orbit")}
          >
            3D
          </button>
        </div>
        <p className="max-w-xl text-xs leading-relaxed text-muted">
          {view === "pyvis"
            ? "PyVis is the bundled physics HTML. Shapes are entity types. A halo is stored risk, not a payment. Open Explore to read whether an edge is an observed ledger row or a derived case, alert, or catalogue link."
            : view === "orbit"
              ? "3D shows one neighbourhood. Letters are entity types. Colour is stored risk. A path here is a connection to inspect. Amounts and observed-versus-derived notes are on Explore and in the trace above."
              : "Explore. Solid edges were seen on a transaction. Dashed edges are derived. Select one for the count, CAD, window, and sample rows."}
        </p>
      </div>
      {view === "orbit" ? <KnowledgeGraph3D nodes={nodes} edges={edges} alertTimes={alertTimes} /> : null}
      {view === "pyvis" ? (
        <iframe
          title="PyVis entity graph"
          src="/graph/entity-graph.html"
          className="h-[min(82vh,920px)] w-full rounded-md border border-line bg-card"
        />
      ) : null}
      {view === "explore" ? <KnowledgeGraph nodes={nodes} edges={edges} disclaimer={disclaimer} facts={facts} focusId={focus} /> : null}
    </div>
  );
}
