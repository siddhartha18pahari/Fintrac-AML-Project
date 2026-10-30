import type { Metadata } from "next";
import { CaseIndex } from "@/components/CaseWorkspace";
import { SimulatorInbox } from "@/components/SimulatorInbox";
import { PageIntro, Shell } from "@/components/Shell";
import { data } from "@/lib/snapshot";

export const metadata: Metadata = { title: "Cases" };

export default function CasesPage() {
  const namespace = `${data.meta.as_of}:${data.meta.counts.cases}`;
  return (
    <Shell>
      <PageIntro
        kicker="Case management"
        title="One subject, one working file"
        lede="The detection run opened these cases. Assign them, move the status, record a disposition and keep notes. That working record stays in this browser."
      />
      <SimulatorInbox />
      <CaseIndex namespace={namespace} cases={data.cases} />
    </Shell>
  );
}
