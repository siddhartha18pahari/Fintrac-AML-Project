import type { Metadata } from "next";
import { AgentChat } from "@/components/AgentChat";
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
      <AgentChat />
    </Shell>
  );
}
