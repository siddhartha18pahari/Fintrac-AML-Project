"use client";

import { createContext, useContext, useEffect, useState } from "react";

type AssistMode = "deterministic" | "model" | "unknown";

type AssistValue = {
  enabled: boolean;
  setEnabled: (next: boolean) => void;
  mode: AssistMode;
};

const AssistContext = createContext<AssistValue>({
  enabled: false,
  setEnabled: () => {},
  mode: "unknown",
});

export function AssistProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState(false);
  const [mode, setMode] = useState<AssistMode>("unknown");

  useEffect(() => {
    try {
      setEnabledState(localStorage.getItem("sentinel-assist") === "on");
    } catch {
      setEnabledState(false);
    }
    let cancelled = false;
    fetch("/api/health")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { chat?: string } | null) => {
        if (cancelled || !body) return;
        setMode(body.chat === "model" ? "model" : "deterministic");
      })
      .catch(() => {
        if (!cancelled) setMode("unknown");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function setEnabled(next: boolean) {
    setEnabledState(next);
    try {
      localStorage.setItem("sentinel-assist", next ? "on" : "off");
    } catch {
      /* private mode */
    }
  }

  return <AssistContext.Provider value={{ enabled, setEnabled, mode }}>{children}</AssistContext.Provider>;
}

export function useAssist() {
  return useContext(AssistContext);
}

export function AssistToggle({ compact = false }: { compact?: boolean }) {
  const { enabled, setEnabled } = useAssist();
  return (
    <button
      type="button"
      className={compact ? "btn btn-secondary" : "btn btn-secondary w-full"}
      aria-pressed={enabled}
      onClick={() => setEnabled(!enabled)}
    >
      Assist {enabled ? "on" : "off"}
    </button>
  );
}

export function AssistNote({ title, children }: { title: string; children: React.ReactNode }) {
  const { enabled, mode } = useAssist();
  if (!enabled) return null;
  const modeLabel =
    mode === "model"
      ? "A model key is configured for the copilot. This note is still the written guide, not a model answer, and nothing is filed automatically."
      : mode === "deterministic"
        ? "No model key is configured. Guidance on the page is written into the product. The copilot answers from the bundled notes."
        : "Model availability was not confirmed. This note does not call a model.";
  return (
    <aside className="assist-note mb-4 text-sm leading-6" aria-label="Assist">
      <p className="text-xs font-semibold uppercase tracking-wide text-info">Assist · {title}</p>
      <div className="mt-1 text-ink">{children}</div>
      <p className="mt-2 text-xs text-muted">{modeLabel}</p>
    </aside>
  );
}

export function SourceNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 text-xs leading-5 text-muted">
      <span className="font-semibold text-ink">Source. </span>
      {children}
    </p>
  );
}
