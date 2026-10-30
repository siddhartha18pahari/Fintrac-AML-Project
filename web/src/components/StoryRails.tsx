"use client";

import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from "framer-motion";
import { useRef } from "react";

export type RailStory = {
  name: string;
  code: string;
  detail: string;
  stat: string;
};

function StoryStep({
  rail,
  index,
  progress,
  reduce,
}: {
  rail: RailStory;
  index: number;
  progress: MotionValue<number>;
  reduce: boolean;
}) {
  const start = 0.06 + index * 0.2;
  const opacity = useTransform(progress, [start, start + 0.16], [0.55, 1]);
  const y = useTransform(progress, [start, start + 0.16], [20, 0]);
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <p className="num text-xs tracking-[0.22em] text-brass">0{index + 1}</p>
        <p className="text-xs font-semibold tracking-[0.16em] text-brass">{rail.code}</p>
      </div>
      <h3 className="mt-3 font-display text-3xl tracking-tight text-spruce">{rail.name}</h3>
      <p className="mt-3 text-sm leading-relaxed text-muted">{rail.detail}</p>
      <p className="mt-4 text-sm font-semibold text-ink">{rail.stat}</p>
    </>
  );
  if (reduce) return <li className="panel glass p-6">{body}</li>;
  return (
    <motion.li style={{ opacity, y }} className="panel glass p-6">
      {body}
    </motion.li>
  );
}

export function StoryRails({ rails }: { rails: RailStory[] }) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion() === true;
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 75%", "end 45%"] });
  const scaleY = useTransform(scrollYProgress, [0, 1], [0.12, 1]);

  return (
    <section ref={ref} className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[0.82fr_1.18fr] lg:py-28">
      <div className="lg:sticky lg:top-24 lg:self-start">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brass">Reporting obligations</p>
        <h2 className="mt-2 font-display text-4xl tracking-[-0.04em] text-spruce sm:text-5xl">Four questions, kept separate</h2>
        <p className="mt-4 max-w-md text-base leading-relaxed text-muted">
          An LVCTR is arithmetic. An STR is a judgement. Mixing them is how a compliance program starts treating every large receipt as suspicious, or waving away a real reporting duty because nobody felt uneasy.
        </p>
        <div className="relative mt-8 hidden h-36 w-px overflow-hidden bg-line lg:block" aria-hidden="true">
          {reduce ? (
            <div className="h-full w-full bg-gradient-to-b from-brass to-[#1d684f]" />
          ) : (
            <motion.div style={{ scaleY }} className="h-full w-full origin-top bg-gradient-to-b from-brass to-[#1d684f]" />
          )}
        </div>
      </div>
      <ol className="space-y-5">
        {rails.map((rail, index) => (
          <StoryStep key={rail.code} rail={rail} index={index} progress={scrollYProgress} reduce={reduce} />
        ))}
      </ol>
    </section>
  );
}
