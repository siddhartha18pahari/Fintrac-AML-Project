"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NAV } from "@/lib/nav";
import { toggleTheme } from "@/lib/theme";

const GO = Object.fromEntries(NAV.map((link) => [link.key, link.href]));

export function Shortcuts() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previous = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let buffer = "";
    let timer = 0;

    function typingTarget(target: EventTarget | null) {
      const element = target as HTMLElement | null;
      if (!element) return false;
      const tag = element.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable;
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      const typing = typingTarget(event.target);
      if (event.key === "?" && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }
      if (open || typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "/") {
        const field = document.querySelector<HTMLElement>("input[name='q'], input[type='search']");
        if (field) {
          event.preventDefault();
          field.focus();
        }
        return;
      }
      if (event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        toggleTheme();
        return;
      }
      if (event.key === "g" && !buffer) {
        buffer = "g";
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          buffer = "";
        }, 800);
        return;
      }
      if (buffer === "g") {
        const href = GO[event.key.toLowerCase()];
        buffer = "";
        window.clearTimeout(timer);
        if (href) {
          event.preventDefault();
          router.push(href);
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
    };
  }, [open, router]);

  useEffect(() => {
    if (!open) return;
    previous.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-title"
        className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-2xl border border-line bg-card p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brass">Keyboard</p>
            <h2 id="shortcut-title" className="font-display text-2xl text-spruce">Shortcuts</h2>
          </div>
          <button ref={closeRef} type="button" onClick={() => setOpen(false)} className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold">
            Close
          </button>
        </div>
        <ul className="mt-4 space-y-2 text-sm">
          <li className="flex justify-between gap-3"><span>Open this list</span><kbd className="rounded border border-line px-1.5">?</kbd></li>
          <li className="flex justify-between gap-3"><span>Focus search</span><kbd className="rounded border border-line px-1.5">/</kbd></li>
          <li className="flex justify-between gap-3"><span>Toggle colour theme</span><kbd className="rounded border border-line px-1.5">Shift+D</kbd></li>
          {NAV.map((link) => (
            <li key={link.href} className="flex justify-between gap-3">
              <span>{link.label}</span>
              <kbd className="rounded border border-line px-1.5">g {link.key}</kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
