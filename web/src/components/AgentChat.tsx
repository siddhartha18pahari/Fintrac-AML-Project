"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/motion";

type Citation = { id: string; title: string; source: string; text: string; score?: number };
type Trace = { name: string; input: Record<string, unknown>; output: string };
type Turn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode?: string;
  traces?: Trace[];
  citations?: Citation[];
};

const SUGGESTIONS = [
  "Which high alerts are open?",
  "Explain AML-FI-003",
  "How is Maple Digital Imports connected?",
  "Run Benford on the book",
  "What is the large virtual currency threshold?",
];

const STORAGE = "sentinel-agent-chat";

export function AgentChat() {
  const reduce = useReducedMotion();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE);
      if (raw) setTurns(JSON.parse(raw) as Turn[]);
    } catch {
      setTurns([]);
    }
  }, []);

  useEffect(() => {
    if (turns.length) sessionStorage.setItem(STORAGE, JSON.stringify(turns.slice(-20)));
    if (!reduce) scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [reduce, turns]);

  async function ask(text: string) {
    const message = text.trim();
    if (!message || pending) return;
    setDraft("");
    setError("");
    const history = turns.filter((turn) => turn.role === "user" || turn.content).map((turn) => ({ role: turn.role, content: turn.content }));
    const userTurn: Turn = { id: `u-${Date.now()}`, role: "user", content: message };
    const assistantId = `a-${Date.now()}`;
    setTurns((current) => [...current, userTurn, { id: assistantId, role: "assistant", content: "", traces: [], citations: [] }]);
    setPending(true);
    try {
      const response = await fetch("/api/v2/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, history }),
      });
      if (!response.ok || !response.body) throw new Error("The copilot could not answer.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((item) => item.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as {
            type: string;
            text?: string;
            mode?: string;
            name?: string;
            input?: Record<string, unknown>;
            output?: string;
            id?: string;
            title?: string;
            source?: string;
            score?: number;
            message?: string;
          };
          setTurns((current) =>
            current.map((turn) => {
              if (turn.id !== assistantId) return turn;
              if (event.type === "token") return { ...turn, content: turn.content + (event.text ?? "") };
              if (event.type === "mode") return { ...turn, mode: event.mode };
              if (event.type === "tool" && event.name) {
                return { ...turn, traces: [...(turn.traces ?? []), { name: event.name, input: event.input ?? {}, output: event.output ?? "" }] };
              }
              if (event.type === "citation" && event.id && event.title && event.source) {
                return {
                  ...turn,
                  citations: [...(turn.citations ?? []), { id: event.id, title: event.title, source: event.source, text: event.text ?? "", score: event.score }],
                };
              }
              if (event.type === "error") setError(event.message ?? "The copilot could not finish.");
              return turn;
            }),
          );
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The copilot could not answer.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <section className="panel glass flex min-h-[640px] flex-col p-4">
        <div ref={scroller} className="flex-1 space-y-4 overflow-auto pr-1" aria-live="polite">
          {turns.length === 0 ? (
            <div>
              <p className="text-sm text-muted">
                The agent calls tools for alerts, entities, graph paths, rules and statistics, then retrieves the bundled guidance notes. Without an API key it still routes those tools. It does not decide a filing.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {SUGGESTIONS.map((prompt) => (
                  <button key={prompt} type="button" className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold" onClick={() => ask(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {turns.map((turn) => (
            <article key={turn.id} className={turn.role === "user" ? "ml-8 rounded-2xl bg-spruce px-4 py-3 text-white" : "mr-4 rounded-2xl border border-line bg-card/80 px-4 py-3"}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brass">{turn.role === "user" ? "You" : turn.mode ? `Copilot · ${turn.mode}` : "Copilot"}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{turn.content || (pending ? "Working…" : "")}</p>
              {turn.traces?.length ? (
                <details className="mt-3 text-xs" open>
                  <summary className="cursor-pointer font-semibold">Tool trace ({turn.traces.length})</summary>
                  <ul className="mt-2 space-y-2">
                    {turn.traces.map((trace, index) => (
                      <li key={`${trace.name}-${index}`} className="rounded-xl border border-line px-2 py-2">
                        <p className="font-semibold">{trace.name}</p>
                        <p className="text-muted">{JSON.stringify(trace.input)}</p>
                        <p className="mt-1 line-clamp-4">{trace.output}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {turn.citations?.length ? (
                <ul className="mt-3 space-y-1 text-xs">
                  {turn.citations.map((citation) => (
                    <li key={citation.id}>
                      <a className="font-semibold text-info underline" href={citation.source} target="_blank" rel="noreferrer">[{citation.id}] {citation.title}</a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
        {error ? <p className="mt-2 text-sm text-critical" role="alert">{error}</p> : null}
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(draft);
          }}
        >
          <label className="sr-only" htmlFor="agent-draft">Message</label>
          <input id="agent-draft" className="field" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask about a rule, a customer, or the book." disabled={pending} />
          <button type="submit" className="rounded-full bg-spruce px-4 py-2 text-sm font-semibold text-white" disabled={pending}>Send</button>
        </form>
      </section>
      <aside className="space-y-3">
        <article className="panel glass p-4 text-sm">
          <h2 className="font-display text-xl text-spruce">Tools</h2>
          <ul className="mt-2 space-y-1 text-muted">
            <li>query_alerts</li>
            <li>lookup_entity</li>
            <li>graph_path</li>
            <li>explain_rule</li>
            <li>compute_stats</li>
            <li>retrieve_guidance</li>
          </ul>
          <p className="mt-3 text-xs">LangChain defines the tools. A model is used only when OPENAI_API_KEY or AI_GATEWAY_API_KEY is set.</p>
        </article>
        <button type="button" className="text-sm font-semibold text-info underline" onClick={() => { sessionStorage.removeItem(STORAGE); setTurns([]); }}>
          Clear this chat
        </button>
      </aside>
    </div>
  );
}
