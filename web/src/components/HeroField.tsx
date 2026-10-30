"use client";

import { useEffect, useRef } from "react";

export function HeroField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const points = Array.from({ length: 42 }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.00035,
      vy: (Math.random() - 0.5) * 0.00035,
    }));
    let frame = 0;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      if (!reduce) {
        for (const point of points) {
          point.x += point.vx;
          point.y += point.vy;
          if (point.x < 0 || point.x > 1) point.vx *= -1;
          if (point.y < 0 || point.y > 1) point.vy *= -1;
        }
      }
      for (let i = 0; i < points.length; i += 1) {
        for (let j = i + 1; j < points.length; j += 1) {
          const dx = (points[i].x - points[j].x) * rect.width;
          const dy = (points[i].y - points[j].y) * rect.height;
          const distance = Math.hypot(dx, dy);
          if (distance > 150) continue;
          context.strokeStyle = `rgba(231, 211, 164, ${0.28 * (1 - distance / 150)})`;
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(points[i].x * rect.width, points[i].y * rect.height);
          context.lineTo(points[j].x * rect.width, points[j].y * rect.height);
          context.stroke();
        }
      }
      for (const point of points) {
        context.fillStyle = "rgba(246, 243, 234, 0.85)";
        context.beginPath();
        context.arc(point.x * rect.width, point.y * rect.height, 1.6, 0, Math.PI * 2);
        context.fill();
      }
      if (!reduce) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />;
}

export function StatCounter({ value, label }: { value: number; label: string }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      node.textContent = String(value);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 900);
      const eased = 1 - (1 - progress) ** 3;
      node.textContent = String(Math.round(value * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <div className="rounded-2xl border border-white/20 bg-[#10211c]/80 px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.28)] backdrop-blur-md">
      <dt className="text-[11px] uppercase tracking-[0.16em] text-[#d5e3dc]">{label}</dt>
      <dd ref={ref} className="num mt-1 text-3xl tracking-tight text-white">
        0
      </dd>
    </div>
  );
}
