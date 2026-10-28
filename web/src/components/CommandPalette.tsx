"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

export type CommandEntry = {
  href: string;
  label: string;
  hint: string;
  keywords: string;
};

export function CommandPalette({ entries }: { entries: CommandEntry[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = needle
      ? entries.filter((entry) => `${entry.label} ${entry.hint} ${entry.keywords}`.toLowerCase().includes(needle))
      : entries.slice(0, 8);
    return pool.slice(0, 12);
  }, [entries, query]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("sentinel-command", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("sentinel-command", onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const timer = window.setTimeout(() => input.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  function go(entry: CommandEntry | undefined) {
    if (!entry) return;
    setOpen(false);
    router.push(entry.href);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh]" role="presentation" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-title"
        className="rise w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-card shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="command-title" className="sr-only">Command palette</h2>
        <input
          ref={input}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => Math.min(results.length - 1, index + 1));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(0, index - 1));
            }
            if (event.key === "Enter") go(results[active]);
          }}
          placeholder="Jump to a page, customer, alert, or rule"
          className="w-full border-0 bg-transparent px-4 py-4 text-base outline-none"
          aria-activedescendant={results[active] ? `command-${active}` : undefined}
          aria-controls="command-list"
        />
        <ul id="command-list" role="listbox" className="max-h-80 overflow-auto border-t border-line">
          {results.length === 0 ? (
            <li className="px-4 py-6 text-sm text-muted">Nothing matches. Try a customer name or a rule id.</li>
          ) : (
            results.map((entry, index) => (
              <li key={`${entry.href}-${entry.label}`} id={`command-${index}`} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => go(entry)}
                  className={`flex w-full items-baseline justify-between gap-3 px-4 py-2.5 text-left text-sm ${index === active ? "bg-line/70" : ""}`}
                >
                  <span className="font-semibold">{entry.label}</span>
                  <span className="text-xs text-muted">{entry.hint}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

export function openCommandPalette() {
  window.dispatchEvent(new Event("sentinel-command"));
}

export function SearchButton({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => openCommandPalette()}
      className={className}
    >
      Search
      <kbd className="rounded border border-white/20 px-1.5 text-[10px]">Ctrl K</kbd>
    </button>
  );
}
