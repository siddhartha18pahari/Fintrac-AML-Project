"use client";

import { useEffect } from "react";

export function Spotlight({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) return;

    function onMove(event: PointerEvent) {
      const target = (event.target as HTMLElement | null)?.closest?.(".panel, .spotlight");
      if (!(target instanceof HTMLElement)) return;
      const rect = target.getBoundingClientRect();
      target.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      target.style.setProperty("--my", `${event.clientY - rect.top}px`);
    }

    document.addEventListener("pointermove", onMove, { passive: true });
    return () => document.removeEventListener("pointermove", onMove);
  }, []);

  return children;
}
