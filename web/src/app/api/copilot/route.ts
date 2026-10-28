import { createOpenAI } from "@ai-sdk/openai";
import { gateway, generateText } from "ai";
import { extractiveAnswer, searchPassages, type Passage } from "@/lib/bm25";
import { data } from "@/lib/snapshot";

export const runtime = "nodejs";

const MODEL = "openai/gpt-5.4";

function bookContext(customerId: number | null, caseId: number | null) {
  const parts: string[] = [];
  const customer = customerId ? data.customers.find((row) => row.id === customerId) : undefined;
  const caseRow = caseId ? data.cases.find((row) => row.id === caseId) : undefined;
  const subjectId = customer?.id ?? caseRow?.customer_id;
  if (customer) {
    parts.push(
      `${customer.name} (${customer.customer_id}) residual risk ${customer.risk.residual} ${customer.risk.tier}. ${customer.occupation_or_business}.`,
    );
  }
  if (caseRow) {
    parts.push(`Case ${caseRow.reference} score ${caseRow.risk_score} ${caseRow.risk_tier}. Status ${caseRow.status}.`);
  }
  if (subjectId) {
    const alerts = data.alerts.filter((alert) => alert.customer_id === subjectId).slice(0, 6);
    if (alerts.length) {
      parts.push(`Alerts: ${alerts.map((alert) => `${alert.rule_id} ${alert.title}`).join("; ")}.`);
    }
    const node = data.knowledge_graph.nodes.find((item) => item.href === `/customers/${subjectId}`);
    if (node) {
      const neighbourIds = new Set<string>();
      for (const edge of data.knowledge_graph.edges) {
        if (edge.source === node.id) neighbourIds.add(edge.target);
        if (edge.target === node.id) neighbourIds.add(edge.source);
      }
      const labels = [...neighbourIds]
        .map((id) => data.knowledge_graph.nodes.find((item) => item.id === id))
        .filter((item) => item && item.kind !== "alert")
        .slice(0, 8)
        .map((item) => `${item!.kind} ${item!.label}`);
      if (labels.length) parts.push(`Graph neighbours: ${labels.join(", ")}.`);
    }
  }
  return parts.join(" ");
}

async function modelAnswer(question: string, hits: Passage[], context: string) {
  const gatewayKey = process.env.AI_GATEWAY_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!gatewayKey && !openaiKey) return null;
  const notes = hits
    .map((hit) => `[${hit.id}] ${hit.title}\n${hit.text}\nSource: ${hit.source}`)
    .join("\n\n");
  const model = gatewayKey ? gateway(MODEL) : createOpenAI({ apiKey: openaiKey })("gpt-5.4");
  const result = await generateText({
    model,
    instructions:
      "Answer only from the guidance notes and the book context. Cite passage ids in brackets. If the notes do not contain the answer, say so. Never state that a person committed money laundering, terrorist financing, or is a listed person. A reporting threshold is not suspicion.",
    prompt: `Question: ${question}\n\nBook context: ${context || "None."}\n\nNotes:\n${notes}`,
  });
  return { text: result.text, mode: gatewayKey ? "gateway" : "openai" };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    question?: string;
    customerId?: number | null;
    caseId?: number | null;
  };
  const question = String(body.question ?? "").trim();
  if (!question) return Response.json({ error: "A question is required." }, { status: 400 });
  const hits = searchPassages(question, data.guidance as Passage[], 4);
  const context = bookContext(body.customerId ?? null, body.caseId ?? null);
  let answer = extractiveAnswer(question, hits, context);
  let mode = "extractive";
  try {
    const generated = await modelAnswer(question, hits, context);
    if (generated?.text) {
      answer = generated.text;
      mode = generated.mode;
    }
  } catch {
    mode = "extractive";
  }
  return Response.json({
    answer,
    mode,
    hits: hits.map((hit) => ({
      id: hit.id,
      title: hit.title,
      source: hit.source,
      score: hit.score,
      text: hit.text,
    })),
  });
}
