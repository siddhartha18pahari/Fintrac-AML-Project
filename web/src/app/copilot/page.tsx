import type { Metadata } from "next";
import { AgentChat } from "@/components/AgentChat";
import { AssistNote } from "@/components/Assist";
import { PageIntro, Shell } from "@/components/Shell";
import { data } from "@/lib/snapshot";

export const metadata: Metadata = { title: "Copilot" };

export default function CopilotPage() {
  return (
    <Shell>
      <PageIntro
        kicker={`${data.guidance.length} guidance notes`}
        title="Ask, and watch the tools"
        lede="LangChain tools look up alerts, entities, graph paths, rules and statistics, then a retriever cites the bundled guidance. A model writes the reply only when a key is set. Otherwise the same tools still run."
      />
      <AssistNote title="Deterministic tools versus a model">
        The tools always run against this snapshot: alerts, entities, paths, rules, statistics, and the guidance notes. If no API key is configured, the reply is the tool trace plus those notes. A model is used only when a key is present, and it is instructed to cite the notes. Neither mode files a report or approves a case.
      </AssistNote>
      <AgentChat />
    </Shell>
  );
}
