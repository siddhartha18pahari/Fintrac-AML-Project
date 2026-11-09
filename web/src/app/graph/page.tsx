import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { AssistNote } from "@/components/Assist";
import { GraphStudio } from "@/components/GraphStudio";
import { PageIntro, Shell } from "@/components/Shell";
import { explainEdges } from "@/lib/graph-evidence";
import { money } from "@/lib/format";
import { data } from "@/lib/snapshot";
import { traceFunds } from "@/lib/trace-funds";

export const metadata: Metadata = { title: "Graph" };

export default async function GraphPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const query = await searchParams;
  const trace = query.from && query.to ? traceFunds(query.from, query.to) : null;
  const graph = data.knowledge_graph;
  const facts = explainEdges(
    graph.edges,
    data.transactions.map((txn) => ({
      id: txn.id,
      transaction_id: txn.transaction_id,
      customer_id: txn.customer_id,
      occurred_at: txn.occurred_at,
      cad_value: Number(txn.cad_value),
      asset: txn.asset,
      direction: txn.direction,
      instrument: txn.instrument,
      wallet_from: txn.wallet_from,
      wallet_to: txn.wallet_to,
      blockchain: txn.blockchain,
      beneficiary_id: txn.beneficiary_id,
      third_party_id: txn.third_party_id,
      device_id: typeof txn.context?.device_id === "string" ? txn.context.device_id : null,
    })),
    data.alerts.map((alert) => ({
      id: alert.id,
      rule_id: alert.rule_id,
      rule_version: alert.rule_version,
      title: alert.title,
      customer_id: alert.customer_id,
      case_id: alert.case_id,
      evidence_txn_ids: alert.evidence_txn_ids,
    })),
  );
  return (
    <Shell wide>
      <PageIntro
        kicker="4 · Network"
        title="Follow a connection"
        lede="PyVis keeps the physics layout. Explore is the evidence view: type, stored direction, and either ledger rows or a labelled derived link. 3D remains an ego network. A path is something to inspect, not a finding."
      />
      <AssistNote title="Reading an edge">
        Open Explore. Solid lines were seen on a transaction: wallet, device, beneficiary, or third party. Dashed lines are the case, the alert, or a catalogue label, and they do not carry a payment unless the inspector lists evidence transactions. If a count is zero, the identifier is on the graph but no row matched.
      </AssistNote>
      <form method="get" className="panel mb-4 grid gap-3 p-4 md:grid-cols-[1fr_1fr_auto]" role="search">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">From</span>
          <input className="field" name="from" defaultValue={query.from ?? ""} placeholder="Customer or wallet" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">To</span>
          <input className="field" name="to" defaultValue={query.to ?? ""} placeholder="Rule, case, or customer" />
        </label>
        <div className="flex items-end gap-2">
          <input type="hidden" name="view" value="explore" />
          <button className="btn btn-primary" type="submit">Trace</button>
        </div>
      </form>
      {trace ? (
        <article className="panel mb-4 p-4 text-sm">
          <h2 className="text-base font-semibold">Path</h2>
          <p className="mt-1 text-muted">{trace.reason}</p>
          {trace.found ? (
            <>
              <p className="mt-2">{trace.path.map((node) => node.label || node.id).join(" → ")}</p>
              <p className="num mt-1">Observed CAD on this path: {trace.observedCad == null ? "—" : money(trace.observedCad)}. Derived steps contribute nothing to that sum.</p>
              <ul className="mt-3 space-y-2">
                {trace.steps.map((step, index) => (
                  <li key={`${step.from}-${step.to}-${index}`} className="border-t border-line pt-2">
                    <span className="font-semibold">{step.basis === "observed" ? "Observed" : "Derived"} · {step.relation}</span>
                    {step.basis === "observed" && step.fact?.count != null ? <span className="num"> · {step.fact.count} ledger rows · {money(step.fact.cad)}</span> : null}
                    {step.basis === "derived" && step.fact?.count != null ? <span className="num"> · {step.fact.count} evidence rows, not added to the path sum</span> : null}
                    <ul className="mt-1">
                      {(step.fact?.samples ?? []).map((sample) => (
                        <li key={sample.id}><Link className="text-info underline" href={`/transactions/${sample.id}`}>{sample.ref}</Link></li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </article>
      ) : null}
      <Suspense fallback={<p className="text-sm text-muted">Loading the graph.</p>}>
        <GraphStudio
          nodes={graph.nodes}
          edges={graph.edges}
          disclaimer={graph.disclaimer}
          facts={facts}
          alertTimes={Object.fromEntries(data.alerts.map((alert) => [`alert:${alert.id}`, alert.occurred_at]))}
        />
      </Suspense>
    </Shell>
  );
}
