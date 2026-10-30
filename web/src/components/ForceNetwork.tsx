"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/motion";
import { analyzeNetwork, type NetEdge, type NetNode } from "@/lib/network-model";

type ForceGraph = React.ComponentType<Record<string, unknown>>;

function formatDay(time: number) {
  return new Date(time).toISOString().slice(0, 10);
}

export function ForceNetwork({ nodes, edges }: { nodes: NetNode[]; edges: NetEdge[] }) {
  const reduce = useReducedMotion();
  const [Graph, setGraph] = useState<ForceGraph | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(860);
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<"all" | "cycle" | "round" | "fan">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [failed, setFailed] = useState("");

  useEffect(() => {
    let live = true;
    import("react-force-graph-2d")
      .then((mod) => {
        if (live) setGraph(() => mod.default as ForceGraph);
      })
      .catch(() => {
        if (live) setFailed("The force layout could not start in this browser.");
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(() => {
      if (box.current) setWidth(box.current.clientWidth);
    });
    observer.observe(box.current);
    setWidth(box.current.clientWidth);
    return () => observer.disconnect();
  }, []);

  const model = useMemo(() => analyzeNetwork(nodes, edges, from, to), [nodes, edges, from, to]);
  const graphData = useMemo(
    () => ({
      nodes: model.nodes.map((node) => ({ ...node })),
      links: model.links.map((link) => ({ ...link })),
    }),
    [model],
  );
  const active = model.nodes.find((node) => node.id === selected) ?? null;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          {(
            [
              ["all", "All flow"],
              ["cycle", `Cycles ${model.cycleCount}`],
              ["round", `Round-trips ${model.roundTripCount}`],
              ["fan", `Fan-in/out ${model.fanInCount + model.fanOutCount}`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={highlight === value}
              onClick={() => setHighlight(value)}
              className={`rounded-full px-3 py-1.5 font-semibold ${highlight === value ? "bg-spruce text-white" : "border border-line bg-card"}`}
            >
              {label}
            </button>
          ))}
          <span className="text-xs text-muted">{model.communityCount} Louvain communities · node size is betweenness</span>
        </div>
        {model.maxTime > model.minTime ? (
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted">
              From {from ? formatDay(from) : formatDay(model.minTime)}
              <input
                className="mt-1 w-full"
                type="range"
                min={model.minTime}
                max={model.maxTime}
                value={from ?? model.minTime}
                onChange={(event) => setFrom(Number(event.target.value))}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted">
              To {to ? formatDay(to) : formatDay(model.maxTime)}
              <input
                className="mt-1 w-full"
                type="range"
                min={model.minTime}
                max={model.maxTime}
                value={to ?? model.maxTime}
                onChange={(event) => setTo(Number(event.target.value))}
              />
            </label>
          </div>
        ) : null}
        <div ref={box} className="overflow-hidden rounded-3xl border border-white/10 bg-[#071410]" style={{ height: 680 }}>
          {failed ? <p className="p-6 text-sm text-[#d7e4de]">{failed}</p> : null}
          {!failed && !Graph ? <p className="p-6 text-sm text-[#d7e4de]">Laying out the book…</p> : null}
          {Graph ? (
            <Graph
              graphData={graphData}
              width={width}
              height={680}
              backgroundColor="#071410"
              nodeRelSize={4}
              nodeLabel={(node: { label?: string; kind?: string; patterns?: string[] }) =>
                `${node.label ?? "Entity"} · ${node.kind ?? "node"}${node.patterns?.length ? ` · ${node.patterns.join(", ")}` : ""}`
              }
              nodeColor={(node: { color?: string; patterns?: string[]; id?: string }) => {
                const fan = node.patterns?.some((pattern) => pattern === "fan_in" || pattern === "fan_out");
                if (highlight === "all" || node.id === selected) return node.color ?? "#3dbea0";
                if (highlight === "fan" && fan) return node.color ?? "#3dbea0";
                return "rgba(167,214,196,0.28)";
              }}
              nodeVal={(node: { centrality?: number; patterns?: string[] }) => {
                const base = 1 + (node.centrality ?? 0) * 8;
                return node.patterns?.length ? base + 2 : base;
              }}
              linkColor={(link: { roundTrip?: boolean; cycle?: boolean; flow?: boolean; source?: string; target?: string }) => {
                if (link.roundTrip) return "#e2c48a";
                if (link.cycle) return "#e39a55";
                if (highlight === "cycle" || highlight === "round") return "rgba(167,214,196,0.12)";
                return link.flow ? "rgba(61,190,160,0.55)" : "rgba(167,214,196,0.18)";
              }}
              linkWidth={(link: { roundTrip?: boolean; cycle?: boolean; value?: number }) => (link.roundTrip || link.cycle ? 2.4 : Math.min(3, 0.4 + (link.value ?? 0) / 8000))}
              linkDirectionalParticles={(link: { flow?: boolean; roundTrip?: boolean; cycle?: boolean }) => {
                if (reduce || !link.flow) return 0;
                if (highlight === "round") return link.roundTrip ? 4 : 0;
                if (highlight === "cycle") return link.cycle ? 3 : 0;
                return link.roundTrip ? 3 : 1;
              }}
              linkDirectionalParticleWidth={2.2}
              linkDirectionalParticleSpeed={reduce ? 0 : 0.004}
              linkDirectionalParticleColor={() => "#f4e7c8"}
              cooldownTicks={reduce ? 20 : 140}
              onNodeClick={(node: { id?: string }) => setSelected(node.id ?? null)}
            />
          ) : null}
        </div>
      </div>
      <aside className="panel glass h-fit p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brass">Selection</p>
        {active ? (
          <div className="mt-2 space-y-2 text-sm">
            <h2 className="font-display text-2xl text-spruce">{active.label ?? active.id}</h2>
            <p className="text-muted">{active.kind} · community {active.community}</p>
            <p>Betweenness <span className="num">{active.centrality.toFixed(3)}</span></p>
            <p>{active.patterns.length ? active.patterns.join(", ").replaceAll("_", "-") : "No fan-in or fan-out flag on the visible window."}</p>
            {typeof active.customer_id === "number" ? (
              <a className="text-info underline" href={`/customers/${active.customer_id}`}>Open the customer</a>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">Click a node. Gold edges are round-trips. Amber edges are other cycles. Particles follow transaction value.</p>
        )}
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-muted">Nodes</dt><dd className="num">{model.nodes.length}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">Edges</dt><dd className="num">{model.links.length}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">Fan-in</dt><dd className="num">{model.fanInCount}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">Fan-out</dt><dd className="num">{model.fanOutCount}</dd></div>
        </dl>
      </aside>
    </div>
  );
}
