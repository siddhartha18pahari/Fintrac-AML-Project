import type { Metadata } from "next";
import { PageIntro, Shell } from "@/components/Shell";
import { RulesCatalog } from "@/components/RulesCatalog";
import { data } from "@/lib/snapshot";

export const metadata: Metadata = { title: "Rules" };

export default function RulesPage() {
  return (
    <Shell>
      <PageIntro
        kicker={`5 · Catalogue ${data.meta.catalogue_version}`}
        title="Rules, then the evidence they cite"
        lede="Reporting observations, detection heuristics, and fictional list matches are labelled apart. A version stays in the catalogue after it is superseded so an old alert can be read with the inputs that produced it. An indicator does not file a report."
      />
      <RulesCatalog
        version={data.meta.catalogue_version}
        rules={data.rules}
        alerts={data.alerts.map((alert) => ({
          id: alert.id,
          rule_id: alert.rule_id,
          title: alert.title,
          customer_name: alert.customer_name,
        }))}
      />
    </Shell>
  );
}
