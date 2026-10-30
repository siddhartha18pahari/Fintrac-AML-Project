"use client";

import { useEffect, useId, useRef } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export function SlideOver({
  open,
  title,
  kicker,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  kicker?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const root = panel.current;
    const previously = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initial = root?.querySelector<HTMLElement>(FOCUSABLE);
    (initial ?? root)?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previously?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-[#071410]/70 backdrop-blur-sm" aria-label="Close details" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="slide-panel relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-line bg-paper text-ink shadow-[-28px_0_80px_rgba(7,20,16,0.35)] outline-none"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-paper/90 px-5 py-4 backdrop-blur">
          <div>
            {kicker ? <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brass">{kicker}</p> : null}
            <h2 id={titleId} className="mt-1 font-display text-2xl tracking-tight text-spruce">
              {title}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-line px-3 py-1 text-xs font-semibold">
            Close
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}
