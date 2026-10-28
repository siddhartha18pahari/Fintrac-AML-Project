"use client";

import { useEffect, useState } from "react";

type Hit = { id: string; title: string; source: string; score?: number; text: string };

type Reply = {
  answer: string;
  mode: string;
  hits: Hit[];
};

const SUGGESTIONS = [
  "When does a large cash transaction have to be reported?",
  "How is a suspicious transaction report different from a threshold report?",
  "What does minimal casino play indicate?",
  "What belongs on an international wire under the travel rule?",
];

export function CopilotChat({
  customers,
  cases,
}: {
  customers: { id: number; name: string }[];
  cases: { id: number; reference: string; customer_name: string | null }[];
}) {
  const [question, setQuestion] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [caseId, setCaseId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [reply, setReply] = useState<Reply | null>(null);
  const [streamed, setStreamed] = useState("");
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    if (!reply) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setStreamed(reply.answer);
      setStreaming(false);
      return;
    }
    setStreamed("");
    setStreaming(true);
    let index = 0;
    const timer = window.setInterval(() => {
      index = Math.min(reply.answer.length, index + 6);
      setStreamed(reply.answer.slice(0, index));
      if (index >= reply.answer.length) {
        window.clearInterval(timer);
        setStreaming(false);
      }
    }, 16);
    return () => window.clearInterval(timer);
  }, [reply]);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setQuestion(trimmed);
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          customerId: customerId ? Number(customerId) : null,
          caseId: caseId ? Number(caseId) : null,
        }),
      });
      if (!response.ok) throw new Error("The copilot could not answer.");
      setReply((await response.json()) as Reply);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The copilot could not answer.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <form
        className="space-y-3 rounded-2xl border border-line bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
      >
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Customer context</span>
          <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} className="field">
            <option value="">None</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.name}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Case context</span>
          <select value={caseId} onChange={(event) => setCaseId(event.target.value)} className="field">
            <option value="">None</option>
            {cases.map((row) => (
              <option key={row.id} value={row.id}>{row.reference} · {row.customer_name}</option>
            ))}
          </select>
        </label>
        <p className="text-xs leading-relaxed text-muted">
          Context is the synthetic book: the case score, the open alerts, and neighbouring graph entities. Guidance still comes from the bundled notes.
        </p>
      </form>
      <div>
        <form
          className="rounded-2xl border border-line bg-card p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(question);
          }}
        >
          <label htmlFor="copilot-question" className="sr-only">Question</label>
          <textarea
            id="copilot-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={3}
            placeholder="Ask about a threshold, an indicator, or a typology"
            className="field border-0"
          />
          <div className="mt-2 flex justify-end">
            <button type="submit" disabled={pending} className="rounded-md bg-spruce px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {pending ? "Searching notes…" : "Ask"}
            </button>
          </div>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => void ask(suggestion)} className="rounded-full border border-line bg-card px-3 py-1.5 text-left text-xs font-semibold hover:border-brass">
              {suggestion}
            </button>
          ))}
        </div>
        <div className="mt-4" aria-live="polite">
          {pending ? (
            <div className="space-y-2 rounded-2xl border border-line bg-card p-5" aria-busy="true">
              <div className="h-3 w-2/3 animate-pulse rounded bg-line" />
              <div className="h-3 w-full animate-pulse rounded bg-line" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-line" />
              <p className="text-sm text-muted">Retrieving guidance notes.</p>
            </div>
          ) : null}
          {error ? <p className="rounded-2xl border border-line bg-card p-4 text-sm text-critical">{error}</p> : null}
          {!pending && !reply && !error ? (
            <p className="rounded-2xl border border-dashed border-line p-6 text-sm text-muted">
              No question yet. The copilot answers from bundled summaries of public FINTRAC guidance and cites each note. Without a model key it stays extractive.
            </p>
          ) : null}
          {reply && !pending ? (
            <article className="rise rounded-2xl border border-line bg-card p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-brass">
                {reply.mode === "extractive" ? "Extractive answer" : `Model answer · ${reply.mode}`}
              </p>
              <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
                {streamed}
                {streaming ? <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-brass align-middle" aria-hidden="true" /> : null}
              </div>
              {!streaming ? (
                <ul className="mt-5 flex flex-wrap gap-2" aria-label="Citations">
                  {reply.hits.map((hit) => (
                    <li key={hit.id}>
                      <a href={hit.source} className="inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-paper px-3 py-1.5 text-xs font-semibold text-info hover:border-brass">
                        <span className="truncate">{hit.title}</span>
                        <span className="num text-muted">{hit.score ?? ""}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ) : null}
        </div>
      </div>
    </div>
  );
}
