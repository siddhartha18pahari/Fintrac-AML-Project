"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import type { GlobeCountry } from "@/components/globe/coords";

const TransactionGlobe = dynamic(
  () => import("@/components/globe/TransactionGlobe").then((mod) => mod.TransactionGlobe),
  { ssr: false, loading: () => <GlobeFallback /> },
);

class GlobeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <GlobeFallback />;
    return this.props.children;
  }
}

export function GlobeFallback() {
  return (
    <div className="grid h-full w-full place-items-center" aria-hidden="true">
      <div className="relative h-56 w-56 sm:h-72 sm:w-72">
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_32%_30%,rgba(243,226,184,0.55),transparent_36%),radial-gradient(circle_at_60%_62%,rgba(126,224,198,0.35),transparent_42%),#10241e] shadow-[0_0_80px_rgba(61,190,160,0.35)]" />
        <div className="absolute inset-3 rounded-full border border-[#e2c48a]/40" />
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-[#9ad7c4]/30" />
        <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-[#9ad7c4]/30" />
      </div>
    </div>
  );
}

export function GlobeSlot({
  countries,
  variant,
}: {
  countries: GlobeCountry[];
  variant: "hero" | "stage";
}) {
  const root = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [animate, setAnimate] = useState(false);
  const [interactiveLive, setInteractiveLive] = useState(false);
  const [quality, setQuality] = useState<"high" | "low">("low");
  const interactive = variant === "stage";

  useEffect(() => {
    const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const narrowQuery = window.matchMedia("(max-width: 768px)");
    let onScreen = true;
    let hidden = document.hidden;

    const publish = () => {
      const reduce = reduceQuery.matches;
      const narrow = narrowQuery.matches;
      setQuality(narrow ? "low" : "high");
      setAnimate(!reduce && onScreen && !hidden);
      setInteractiveLive(interactive && onScreen && !hidden);
    };

    publish();
    setReady(true);

    const observer = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        publish();
      },
      { threshold: 0.08 },
    );
    if (root.current) observer.observe(root.current);

    const onChange = () => {
      hidden = document.hidden;
      publish();
    };
    document.addEventListener("visibilitychange", onChange);
    reduceQuery.addEventListener("change", publish);
    narrowQuery.addEventListener("change", publish);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onChange);
      reduceQuery.removeEventListener("change", publish);
      narrowQuery.removeEventListener("change", publish);
    };
  }, [interactive]);

  return (
    <div ref={root} className={interactive ? "relative h-full min-h-[420px] w-full" : "pointer-events-none relative h-full w-full"}>
      <p className="sr-only">
        Globe of synthetic cross-border flows touching Canada. Gold arcs leave Canada. Mint arcs arrive.
        {animate ? " The globe is rotating." : " Motion is paused."}
      </p>
      {ready ? (
        <GlobeBoundary>
          <TransactionGlobe countries={countries} interactive={interactiveLive} animate={animate} quality={quality} />
        </GlobeBoundary>
      ) : (
        <GlobeFallback />
      )}
    </div>
  );
}
