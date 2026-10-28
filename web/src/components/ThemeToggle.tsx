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

  function onClick() {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={theme === "dark"}
      className={
        compact
          ? "rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white"
          : "w-full rounded-md px-3 py-2 text-left text-sm text-[#d7e4de] hover:bg-white/10 hover:text-white"
      }
    >
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
