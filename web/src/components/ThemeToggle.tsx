"use client";

import { useEffect, useState } from "react";
import { applyTheme, currentTheme, type ThemeName } from "@/lib/theme";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<ThemeName>("light");

  useEffect(() => {
    const sync = () => setTheme(currentTheme());
    sync();
    window.addEventListener("sentinel-theme", sync);
    return () => window.removeEventListener("sentinel-theme", sync);
  }, []);

  function choose(next: ThemeName) {
    applyTheme(next);
    setTheme(next);
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => choose(theme === "dark" ? "light" : "dark")}
        aria-pressed={theme === "dark"}
        className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white"
      >
        {theme === "dark" ? "Light mode" : "Dark mode"}
      </button>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-1 rounded-full bg-white/5 p-1" role="group" aria-label="Colour theme">
      {(["light", "dark"] as const).map((name) => (
        <button
          key={name}
          type="button"
          aria-pressed={theme === name}
          onClick={() => choose(name)}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize ${theme === name ? "bg-[#e7d3a4] text-[#12352c]" : "text-[#d7e4de] hover:bg-white/10"}`}
        >
          {name}
        </button>
      ))}
    </div>
  );
}
