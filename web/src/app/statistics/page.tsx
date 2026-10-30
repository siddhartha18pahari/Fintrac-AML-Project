import type { Metadata } from "next";
import { PageIntro, Shell } from "@/components/Shell";
import { StatisticsBoard } from "@/components/StatisticsBoard";
import { data } from "@/lib/snapshot";

export const metadata: Metadata = { title: "Statistics" };

export default function StatisticsPage() {
  return (
    <Shell wide>
      <PageIntro
        kicker="Analytics"
        title="Read the book before you read a score"
        lede="Benford, fences, an isolation-style score, velocity, peers, a correlation heatmap, a weekly decomposition, and a threshold tuner against planted labels."
      />
      <StatisticsBoard
        plantedRecall={data.performance.recall}
        series={data.series.map((point) => ({ date: point.date, total: point.total }))}
        transactions={data.transactions.map((txn) => ({
          customerId: txn.customer_id,
          customer: txn.customer_name ?? "",
          at: txn.occurred_at,
          cad: Number(txn.cad_value),
          scenario: txn.scenario ?? "",
          instrument: txn.instrument,
        }))}
        customers={data.customers.map((customer) => ({
          id: customer.id,
          name: customer.name,
          group: customer.profile.occupation || customer.occupation_or_business || customer.customer_type,
          residual: customer.risk.residual,
          anomaly: data.anomaly.find((row) => row.customer_id === customer.id)?.score ?? 0,
        }))}
      />
    </Shell>
  );
}
