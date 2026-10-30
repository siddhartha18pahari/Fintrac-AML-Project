"use client";

import { useEffect, useState } from "react";
import { money, when } from "@/lib/format";
import { readSimCases, type SimCaseFile } from "@/lib/sim-cases";

export function SimulatorInbox() {
  const [cases, setCases] = useState<SimCaseFile[]>([]);
  useEffect(() => {
    setCases(readSimCases());
  }, []);
  if (!cases.length) return null;
  return (
    <section className="mb-6 rounded-2xl border border-line bg-card p-4" data-testid="sim-inbox">
      <h2 className="font-display text-2xl text-spruce">Sent from the simulator</h2>
      <p className="mt-1 text-sm text-muted">These files were exported from a synthetic run in this browser. They are not detection cases from the snapshot.</p>
      <ul className="mt-3 space-y-2">
        {cases.map((file) => (
          <li key={file.id} className="rounded-xl border border-line px-3 py-2 text-sm">
            <p className="font-semibold">{file.reference} · {file.customer}</p>
            <p className="text-muted">{file.ruleId} · {file.typology.replaceAll("_", " ")} · {money(file.cad)} · {when(file.at)}</p>
            <p>{file.caught}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
