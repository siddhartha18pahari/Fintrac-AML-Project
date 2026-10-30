"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { KnowledgeGraph, type GraphEdge, type GraphNode } from "@/components/KnowledgeGraph";
import { KnowledgeGraph3D } from "@/components/KnowledgeGraph3D";

export function GraphStudio({
  nodes,
  edges,
  disclaimer,
  alertTimes,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  disclaimer: string;
  alertTimes: Record<string, string>;
}) {
  const params = useSearchParams();
  const initial = params.get("view");
  const [view, setView] = useState<"pyvis" | "explore" | "orbit">(initial === "explore" ? "explore" : initial === "orbit" ? "orbit" : "pyvis");

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
            ? "Self-contained HTML from scripts/build_pyvis_graph.py. Shapes follow entity type, halos follow risk, edges follow the relation."
            : view === "orbit"
              ? "WebGL ego network. Glyphs are entity types, halos are risk, and particles run along a path you pick."
              : "In-app graph. Cluster by type, search to focus, dim the rest of the neighbourhood, filter risk and type, or trace a path to a sanctions node."}
        </p>
      </div>
      {view === "orbit" ? <KnowledgeGraph3D nodes={nodes} edges={edges} alertTimes={alertTimes} /> : null}
      {view === "pyvis" ? (
        <iframe
          title="PyVis entity graph"
          src="/graph/entity-graph.html"
          className="h-[min(82vh,920px)] w-full rounded-3xl border border-white/10 bg-[#071410] shadow-[0_24px_80px_rgba(0,0,0,0.28)]"
        />
      ) : null}
      {view === "explore" ? <KnowledgeGraph nodes={nodes} edges={edges} disclaimer={disclaimer} /> : null}
    </div>
  );
}
