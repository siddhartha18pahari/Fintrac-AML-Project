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
      <button type="button" className="btn btn-secondary" aria-pressed={theme === "dark"} onClick={() => choose(theme === "dark" ? "light" : "dark")}>
        {theme === "dark" ? "Light" : "Dark"}
      </button>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-1" role="group" aria-label="Colour theme">
      {(["light", "dark"] as const).map((name) => (
        <button key={name} type="button" aria-pressed={theme === name} onClick={() => choose(name)} className="btn btn-secondary capitalize">
          {name}
        </button>
      ))}
    </div>
  );
}
