"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/Badges";
import { when } from "@/lib/format";
import { ASSIGNEES, DISPOSITIONS, STATUSES, useWorkspace } from "@/lib/workspace-store";

export type CaseIndexRow = {
  id: number;
  reference: string;
  customer_id: number;
  customer_name: string | null;
  status: string;
  priority: string;
  risk_tier: string;
  risk_score: number;
  lvctr_required: boolean;
  str_candidate: boolean;
  disposition: string | null;
};

export function CaseIndex({ namespace, cases }: { namespace: string; cases: CaseIndexRow[] }) {
  const workspace = useWorkspace(namespace);
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-card">
      <table className="min-w-full text-left text-sm">
        <caption className="sr-only">Investigation cases</caption>
        <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
          <tr>
            <th className="px-4 py-3" scope="col">Case</th>
            <th className="px-4 py-3" scope="col">Customer</th>
            <th className="px-4 py-3" scope="col">Tier</th>
            <th className="px-4 py-3" scope="col">Flags</th>
            <th className="px-4 py-3" scope="col">Assignee</th>
            <th className="px-4 py-3" scope="col">Status</th>
            <th className="px-4 py-3" scope="col">Disposition</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((row) => {
            const overlay = workspace.overlayFor(row.id, row.status, row.disposition);
            return (
              <tr key={row.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3">
                  <Link href={`/cases/${row.id}`} className="font-semibold hover:underline">{row.reference}</Link>
                  <p className="text-xs text-muted">{row.priority}</p>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/customers/${row.customer_id}`} className="hover:underline">{row.customer_name}</Link>
                </td>
                <td className="px-4 py-3">
                  <Badge value={row.risk_tier} />
                  <span className="num ml-2">{row.risk_score}</span>
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  {row.lvctr_required ? "LVCTR " : ""}
                  {row.str_candidate ? "STR review" : ""}
                </td>
                <td className="px-4 py-3">{overlay.assignee}</td>
                <td className="px-4 py-3">{overlay.status.replaceAll("_", " ")}</td>
                <td className="px-4 py-3">{overlay.disposition ? overlay.disposition.replaceAll("_", " ") : "Undecided"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CaseWorkspace({
  namespace,
  caseId,
  status,
  disposition,
}: {
  namespace: string;
  caseId: number;
  status: string;
  disposition: string | null;
}) {
  const workspace = useWorkspace(namespace);
  const overlay = workspace.overlayFor(caseId, status, disposition);
  const [note, setNote] = useState("");
  const actor = overlay.assignee === "Unassigned" ? "Investigator" : overlay.assignee;

  return (
    <fieldset disabled={!workspace.ready} className="min-w-0 space-y-4">
      <p className="text-sm text-muted">
        Assignment, status, notes and disposition stay in this browser. They do not submit a report and they do not change the detection snapshot.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Assignee</span>
          <select
            className="field"
            value={overlay.assignee}
            onChange={(event) => workspace.assign(caseId, status, disposition, event.target.value)}
          >
            {ASSIGNEES.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Status</span>
          <select
            className="field"
            value={overlay.status}
            onChange={(event) => workspace.setStatus(caseId, status, disposition, event.target.value, actor)}
          >
            {STATUSES.map((value) => (
              <option key={value} value={value}>{value.replaceAll("_", " ")}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Disposition</span>
          <select
            className="field"
            value={overlay.disposition}
            onChange={(event) => workspace.setDisposition(caseId, status, disposition, event.target.value, actor)}
          >
            {DISPOSITIONS.map((value) => (
              <option key={value || "none"} value={value}>{value ? value.replaceAll("_", " ") : "Undecided"}</option>
            ))}
          </select>
        </label>
      </div>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          workspace.addNote(caseId, status, disposition, actor, note);
          setNote("");
        }}
      >
        <label htmlFor={`note-${caseId}`} className="block text-xs font-semibold uppercase tracking-wider text-muted">
          Add a note
        </label>
        <textarea
          id={`note-${caseId}`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          className="field"
          placeholder="What you looked at, and what you decided."
        />
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="rounded-md bg-spruce px-4 py-2 text-sm font-semibold text-white">
            Save note
          </button>
          <button type="button" onClick={() => workspace.reset(caseId)} className="rounded-md border border-line px-4 py-2 text-sm font-semibold">
            Reset local record
          </button>
        </div>
      </form>
      <section>
        <h3 className="font-display text-xl text-spruce">Notes</h3>
        {overlay.notes.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No notes in this browser yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {overlay.notes.map((item) => (
              <li key={item.id} className="rounded-xl border border-line px-3 py-2 text-sm">
                <p>{item.body}</p>
                <p className="mt-1 text-xs text-muted">{item.author} · {when(item.at)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="font-display text-xl text-spruce">Audit trail</h3>
        {overlay.audit.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Local actions will appear here, newest first.</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {overlay.audit.map((item) => (
              <li key={item.id} className="text-sm">
                <span className="font-semibold">{item.action}</span>
                <span className="text-muted"> · {item.actor} · {when(item.at)}</span>
                <p className="text-muted">{item.detail}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </fieldset>
  );
}
