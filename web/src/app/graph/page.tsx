import { Suspense } from "react";
import type { Metadata } from "next";
import { AssistNote } from "@/components/Assist";
import { GraphStudio } from "@/components/GraphStudio";
import { PageIntro, Shell } from "@/components/Shell";
import { explainEdges } from "@/lib/graph-evidence";
import { data } from "@/lib/snapshot";

export const metadata: Metadata = { title: "Graph" };

export default function GraphPage() {
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
