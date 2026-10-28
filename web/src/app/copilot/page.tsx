import type { Metadata } from "next";
import { CopilotChat } from "@/components/CopilotChat";
import { PageIntro, Shell } from "@/components/Shell";
import { data } from "@/lib/snapshot";

export const metadata: Metadata = { title: "Copilot" };

export default function CopilotPage() {
  return (
    <Shell>
      <PageIntro
        kicker={`${data.guidance.length} guidance notes`}
        title="Ask, and read the citation"
        lede="The copilot retrieves Sentinel's own summaries of public FINTRAC guidance. A model writes the reply only when an AI Gateway or OpenAI key is configured. Otherwise you get the notes themselves."
      />
      <CopilotChat
        customers={data.customers.map((customer) => ({ id: customer.id, name: customer.name }))}
        cases={data.cases.map((row) => ({ id: row.id, reference: row.reference, customer_name: row.customer_name }))}
      />
    </Shell>
  );
}
