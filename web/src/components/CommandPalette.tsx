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
  const [shortcut, setShortcut] = useState("Ctrl K");
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = needle
      ? entries.filter((entry) => `${entry.label} ${entry.hint} ${entry.keywords}`.toLowerCase().includes(needle))
      : entries.slice(0, 8);
    return pool.slice(0, 12);
  }, [entries, query]);

  useEffect(() => {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    setShortcut(mac ? "⌘K" : "Ctrl K");
  }, []);

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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[#071410]/70 p-4 pt-[12vh] backdrop-blur-md" role="presentation" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-title"
        className="rise w-full max-w-xl overflow-hidden rounded-3xl border border-white/10 bg-[#10211c]/95 text-[#e7f0ec] shadow-[0_30px_80px_rgba(0,0,0,0.45)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="command-title" className="sr-only">Command palette</h2>
        <div className="flex items-center gap-3 px-4">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[#e2c48a]" aria-hidden="true">Go</span>
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
            className="w-full border-0 bg-transparent py-4 text-base text-white outline-none placeholder:text-[#8eaa9f]"
            aria-activedescendant={results[active] ? `command-${active}` : undefined}
            aria-controls="command-list"
          />
        </div>
        <ul id="command-list" role="listbox" className="max-h-80 overflow-auto border-t border-white/10">
          {results.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-[#b7c7bf]">
              Nothing matches. Try a customer name, a province, or a rule id.
            </li>
          ) : (
            results.map((entry, index) => (
              <li key={`${entry.href}-${entry.label}`} id={`command-${index}`} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => go(entry)}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm ${index === active ? "bg-white/10" : ""}`}
                >
                  <span className="font-semibold text-white">{entry.label}</span>
                  <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-[#d5e3dc]">{entry.hint}</span>
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="flex items-center justify-between border-t border-white/10 px-4 py-2 text-[11px] text-[#8eaa9f]">
          <span>↑↓ to move · Enter to open</span>
          <span>Esc to close · {shortcut}</span>
        </div>
      </div>
    </div>
  );
}

export function openCommandPalette() {
  window.dispatchEvent(new Event("sentinel-command"));
}

export function SearchButton({ className = "" }: { className?: string }) {
  const [shortcut, setShortcut] = useState("Ctrl K");
  useEffect(() => {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    setShortcut(mac ? "⌘K" : "Ctrl K");
  }, []);
  return (
    <button
      type="button"
      onClick={() => openCommandPalette()}
      className={className}
    >
      Search the book
      <kbd className="rounded-md border border-white/20 px-1.5 py-0.5 font-mono text-[10px]">{shortcut}</kbd>
    </button>
  );
}
