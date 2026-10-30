import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { searchPassages, type Passage } from "@/lib/bm25";
import { data } from "@/lib/snapshot";
import { computeStats, entityDetail, explainRule, graphQuery, listAlerts, mentionedCustomers } from "@/lib/studio-query";

const GUARD =
  "Indicators only. Do not state that a person committed money laundering, terrorist financing, or is a listed person. A reporting threshold is not suspicion.";

const RULE = /aml-[a-z]+-\d+/i;

export type Trace = { name: string; input: Record<string, unknown>; output: string };
export type Citation = { id: string; title: string; source: string; text: string; score?: number };
export type ChatEvent =
  | { type: "mode"; mode: string; framework: string }
  | { type: "tool"; name: string; input: Record<string, unknown>; output: string }
  | { type: "citation"; id: string; title: string; source: string; text: string; score?: number }
  | { type: "token"; text: string }
  | { type: "error"; message: string };

function clip(value: string, limit = 1200) {
  return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;
}

function guidance(question: string) {
  return searchPassages(question, data.guidance as Passage[], 4);
}

export function buildTools() {
  const queryAlerts = tool(
    async ({ severity, ruleId, query, limit }) => JSON.stringify(listAlerts({ severity, ruleId, q: query, limit })),
    {
      name: "query_alerts",
      description: "List synthetic monitoring alerts. Filter by severity, rule id, or a name fragment.",
      schema: z.object({
        severity: z.string().default(""),
        ruleId: z.string().default(""),
        query: z.string().default(""),
        limit: z.number().int().min(1).max(20).default(8),
      }),
    },
  );
  const lookupEntity = tool(async ({ query }) => JSON.stringify(entityDetail(query) ?? { entities: [] }), {
    name: "lookup_entity",
    description: "Look up a customer or graph entity by name, reference, or id.",
    schema: z.object({ query: z.string() }),
  });
  const graphPath = tool(async ({ source, target, ego }) => JSON.stringify(graphQuery({ source, target, ego, depth: 2 })), {
    name: "graph_path",
    description: "Find a knowledge-graph path between two names, or the ego network of one.",
    schema: z.object({
      source: z.string().default(""),
      target: z.string().default(""),
      ego: z.string().default(""),
    }),
  });
  const explain = tool(async ({ ruleId }) => JSON.stringify(explainRule(ruleId)), {
    name: "explain_rule",
    description: "Explain one catalogue rule, for example AML-FI-003.",
    schema: z.object({ ruleId: z.string().default("") }),
  });
  const stats = tool(async ({ metric }) => JSON.stringify(computeStats(metric)), {
    name: "compute_stats",
    description: "Compute a book statistic: overview, benford, velocity, peers, roc, or anomaly.",
    schema: z.object({ metric: z.string().default("overview") }),
  });
  const retrieve = tool(async ({ question }) => JSON.stringify(guidance(question)), {
    name: "retrieve_guidance",
    description: "Retrieve FINTRAC guidance notes bundled with this project.",
    schema: z.object({ question: z.string() }),
  });
  return [queryAlerts, lookupEntity, graphPath, explain, stats, retrieve];
}

export function plan(question: string) {
  const lowered = question.toLowerCase();
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rule = question.match(RULE);
  if (rule || (lowered.includes("rule") && lowered.includes("explain"))) {
    calls.push({ name: "explain_rule", args: { ruleId: rule ? rule[0].toUpperCase() : "" } });
  }
  if (["alert", "queue", "severity", "critical", "triage"].some((word) => lowered.includes(word))) {
    const severity = ["critical", "high", "medium", "low", "reporting"].find((level) => lowered.includes(level)) ?? "";
    calls.push({ name: "query_alerts", args: { severity, query: "", limit: 6 } });
  }
  if (["benford", "statistic", "anomaly", "precision", "recall", "velocity", "how many"].some((word) => lowered.includes(word))) {
    const metric = ["benford", "velocity", "peer", "roc", "anomaly"].find((name) => lowered.includes(name)) ?? "overview";
    calls.push({ name: "compute_stats", args: { metric } });
  }
  const names = mentionedCustomers(question);
  if (["path", "connect", "between", "linked"].some((word) => lowered.includes(word)) && names.length >= 2) {
    calls.push({ name: "graph_path", args: { source: names[0], target: names[1], ego: "" } });
  } else if (["connected", "neighbour", "neighbor", "ego", "network"].some((word) => lowered.includes(word)) && names[0]) {
    calls.push({ name: "graph_path", args: { source: "", target: "", ego: names[0] } });
  } else if (names[0]) {
    calls.push({ name: "lookup_entity", args: { query: names[0] } });
  } else if (!calls.length) {
    calls.push({ name: "lookup_entity", args: { query: question.slice(0, 80) } });
  }
  calls.push({ name: "retrieve_guidance", args: { question } });
  const seen = new Set<string>();
  return calls.filter((call) => (seen.has(call.name) ? false : (seen.add(call.name), true))).slice(0, 4);
}

function summarise(trace: Trace) {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(trace.output) as Record<string, unknown>;
  } catch {
    return `${trace.name} returned a result.`;
  }
  if (trace.name === "query_alerts") {
    const alerts = (payload.alerts as { rule_id: string; title: string; customer_name?: string }[]) ?? [];
    if (!alerts.length) return "No alerts matched that filter.";
    const preview = alerts
      .slice(0, 4)
      .map((alert) => `${alert.rule_id} ${alert.title} (${alert.customer_name ?? "customer"})`)
      .join("; ");
    return `${payload.count ?? alerts.length} alerts match. ${preview}.`;
  }
  if (trace.name === "lookup_entity") {
    const customer = (payload.customer as { name?: string; reference?: string; risk?: { residual?: number; tier?: string } } | undefined) ?? undefined;
    if (customer?.name) {
      const alerts = (payload.alerts as unknown[]) ?? [];
      return `${customer.name} (${customer.reference}) is residual ${customer.risk?.residual ?? "unscored"} ${customer.risk?.tier ?? ""}. ${alerts.length} alerts are on the record in this view.`;
    }
    return "No single customer matched that name. The guidance notes are the other place to look.";
  }
  if (trace.name === "graph_path") {
    const path = (payload.path as { label?: string; id?: string }[]) ?? [];
    if (path.length) return `A path on the knowledge graph: ${path.map((node) => node.label || node.id).join(" → ")}.`;
    const focus = (payload.focus as { label?: string } | undefined)?.label;
    const count = ((payload.nodes as unknown[]) ?? []).length;
    if (focus) return `Ego network around ${focus} has ${count} entities in this depth.`;
    return "No path was found between those names.";
  }
  if (trace.name === "explain_rule") {
    if (!payload.found) return "That rule id is not in the in-force catalogue view.";
    return `${payload.rule_id} ${payload.name}. ${payload.description ?? ""}`.trim();
  }
  if (trace.name === "compute_stats") {
    if (payload.benford && typeof payload.benford === "object") {
      const benford = payload.benford as { mad: number; conformity: string; n: number };
      return `Benford MAD is ${benford.mad.toFixed(4)} (${benford.conformity}) on ${benford.n} amounts.`;
    }
    return `The book has ${payload.transactions} transactions. Benford conformity is ${payload.benford_conformity}. Mean anomaly score is ${
      typeof payload.mean_anomaly === "number" ? payload.mean_anomaly.toFixed(3) : "unavailable"
    }.`;
  }
  return `${trace.name} completed.`;
}

function retrievalQuery(question: string, traces: Trace[]) {
  const rule = traces.find((trace) => trace.name === "explain_rule");
  if (!rule) return question;
  try {
    const payload = JSON.parse(rule.output) as { name?: string; description?: string };
    return `${question} ${payload.name ?? ""} ${payload.description ?? ""}`.slice(0, 1200);
  } catch {
    return question;
  }
}

function compose(question: string, traces: Trace[], passages: Passage[]) {
  const lines = [`Question: ${question.trim()}`, ""];
  for (const trace of traces) {
    if (trace.name === "retrieve_guidance") continue;
    lines.push(summarise(trace), "");
  }
  if (passages.length) {
    lines.push("Guidance notes:");
    for (const passage of passages.slice(0, 3)) {
      let snippet = passage.text.replace(/\s+/g, " ").trim();
      if (snippet.length > 380) snippet = `${snippet.slice(0, 377)}...`;
      lines.push(`[${passage.id}] ${passage.title}. ${snippet}`);
    }
    lines.push("");
  }
  lines.push(GUARD);
  return lines.join("\n").trim();
}

async function modelAnswer(question: string, history: { role: string; content: string }[], traces: Trace[], passages: Passage[]) {
  const gatewayKey = process.env.AI_GATEWAY_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const apiKey = gatewayKey || openaiKey;
  if (!apiKey) return null;
  const { ChatOpenAI } = await import("@langchain/openai");
  const { HumanMessage, SystemMessage } = await import("@langchain/core/messages");
  const model = new ChatOpenAI({
    model: gatewayKey ? "openai/gpt-5.4" : process.env.SENTINEL_CHAT_MODEL || "gpt-5.4",
    apiKey,
    temperature: 0,
    configuration: gatewayKey ? { baseURL: process.env.AI_GATEWAY_BASE_URL || "https://ai-gateway.vercel.sh/v1" } : undefined,
  });
  const notes = passages.map((hit) => `[${hit.id}] ${hit.title}\n${hit.text}`).join("\n\n");
  const tools = traces.map((trace) => `${trace.name}: ${trace.output}`).join("\n");
  const messages = [
    new SystemMessage(
      `You are the Sentinel investigator copilot. Answer only from the tool results and guidance notes. Cite passage ids in brackets. ${GUARD}`,
    ),
    ...history
      .filter((turn) => turn.role === "user" && turn.content)
      .slice(-6)
      .map((turn) => new HumanMessage(turn.content.slice(0, 2000))),
    new HumanMessage(`Question: ${question}\n\nTool results:\n${tools}\n\nGuidance notes:\n${notes}`),
  ];
  const result = await model.invoke(messages);
  const content = result.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : "text" in part ? String(part.text) : ""))
      .join(" ")
      .trim();
  }
  return "";
}

export async function runTurn(
  message: string,
  history: { role: "user" | "assistant"; content: string }[],
  emit: (event: ChatEvent) => void,
) {
  const tools = new Map<string, { invoke: (input: Record<string, unknown>) => Promise<unknown> }>();
  for (const item of buildTools()) {
    tools.set(item.name, item as { invoke: (input: Record<string, unknown>) => Promise<unknown> });
  }
  const traces: Trace[] = [];
  for (const call of plan(message)) {
    const selected = tools.get(call.name);
    if (!selected) continue;
    const output = await selected.invoke(call.args);
    const text = typeof output === "string" ? output : JSON.stringify(output);
    const trace = { name: call.name, input: call.args, output: text };
    traces.push(trace);
    emit({ type: "tool", name: trace.name, input: trace.input, output: clip(text) });
  }
  const passages = guidance(retrievalQuery(message, traces));
  for (const passage of passages) {
    emit({
      type: "citation",
      id: passage.id,
      title: passage.title,
      source: passage.source,
      text: passage.text,
      score: passage.score,
    });
  }
  let mode = "deterministic";
  let body = compose(message, traces, passages);
  if (process.env.OPENAI_API_KEY || process.env.AI_GATEWAY_API_KEY) {
    try {
      const generated = await modelAnswer(message, history, traces, passages);
      if (generated) {
        body = generated;
        mode = "langchain";
      }
    } catch {
      mode = "deterministic";
    }
  }
  emit({ type: "mode", mode, framework: "langchain" });
  const step = 72;
  for (let index = 0; index < body.length; index += step) emit({ type: "token", text: body.slice(index, index + step) });
  return { answer: body, mode, traces, citations: passages };
}
