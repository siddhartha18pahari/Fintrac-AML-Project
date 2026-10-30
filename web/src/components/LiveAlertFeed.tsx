"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/Badges";
import { when } from "@/lib/format";

export type FeedAlert = {
  id: number;
  title: string;
  severity: string;
  customer: string;
  rule: string;
  at: string;
  href: string;
};

export function LiveAlertFeed({ alerts }: { alerts: FeedAlert[] }) {
  const [cursor, setCursor] = useState(0);
  const [clock, setClock] = useState<string | null>(null);
  const [motion, setMotion] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const format = () =>
      new Intl.DateTimeFormat("en-CA", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        timeZone: "UTC",
      }).format(new Date());

    const sync = () => setMotion(!reduce.matches);
    sync();
    setClock(format());
    const clockTimer = window.setInterval(() => setClock(format()), 1000);
    reduce.addEventListener("change", sync);
    return () => {
      window.clearInterval(clockTimer);
      reduce.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    if (!motion || alerts.length < 2) return;
    const timer = window.setInterval(() => {
      setCursor((current) => (current + 1) % alerts.length);
    }, 3200);
    return () => window.clearInterval(timer);
  }, [alerts.length, motion]);

  const ordered = alerts.length === 0 ? [] : [...alerts.slice(cursor), ...alerts.slice(0, cursor)];
  const featured = ordered[0];

  return (
    <section className="relative flex h-full min-h-[28rem] flex-col overflow-hidden rounded-[1.6rem] border border-white/10 bg-[#071410] p-5 text-[#e8f3ee] shadow-[0_24px_70px_rgba(7,20,16,0.35)]" aria-labelledby="live-feed-title">
      <div className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-[#1d684f]/40 blur-3xl" aria-hidden="true" />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#e2c48a]">Desk replay</p>
          <h2 id="live-feed-title" className="mt-1 font-display text-2xl text-white">
            Alerts, still moving
          </h2>
        </div>
        <p className="num rounded-full border border-white/15 px-3 py-1 text-xs text-[#d5e3dc]">
          <span className="sr-only">UTC clock </span>
          {clock ?? "--:--:--"}
        </p>
      </div>
      <p className="relative mt-2 text-sm text-[#b7c9c0]">
        The newest rows from the snapshot, cycled on the desk clock. Nothing here is a live feed from a payment rail.
      </p>
      <div className="relative mt-4 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
        {motion && featured ? <div key={featured.id} className="feed-timer h-full rounded-full bg-gradient-to-r from-[#e2c48a] to-[#7ee0c6]" /> : <div className="h-full w-full bg-[#e2c48a]/70" />}
      </div>
      {featured ? (
        <ol className="relative mt-4 space-y-2" aria-live="off">
          {ordered.map((alert, index) => (
            <li key={alert.id} className={index === 0 ? "rise rounded-2xl border border-[#e2c48a]/40 bg-white/10 px-3 py-3" : "rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5"}>
              <div className="flex items-start justify-between gap-3">
                <Link href={alert.href} className="text-sm font-semibold text-white hover:underline">
                  {alert.title}
                </Link>
                <Badge value={alert.severity} />
              </div>
              <p className="mt-1 text-xs text-[#b7c9c0]">
                {alert.customer} · {alert.rule} · {when(alert.at)} UTC
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="relative mt-6 text-sm text-[#b7c9c0]">No alerts in this snapshot.</p>
      )}
    </section>
  );
}
