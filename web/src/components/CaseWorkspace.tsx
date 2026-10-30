"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/Badges";
import { SlideOver } from "@/components/SlideOver";
import { StatusRail, Timeline } from "@/components/Timeline";
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
  opened_at?: string | null;
  due_at?: string | null;
  risk_drivers?: { label: string; points: number; detail?: string }[];
};

export function CaseIndex({ namespace, cases }: { namespace: string; cases: CaseIndexRow[] }) {
  const workspace = useWorkspace(namespace);
  const [activeId, setActiveId] = useState<number | null>(null);
  const active = cases.find((row) => row.id === activeId) ?? null;
  const activeOverlay = active ? workspace.overlayFor(active.id, active.status, active.disposition) : null;

  return (
    <>
      <div className="table-shell">
        <table className="data-table min-w-full">
          <caption className="sr-only">Investigation cases</caption>
          <thead>
            <tr>
              <th scope="col">Case</th>
              <th scope="col">Customer</th>
              <th scope="col">Tier</th>
              <th scope="col">Flags</th>
              <th scope="col">Assignee</th>
              <th scope="col">Status</th>
              <th scope="col">Disposition</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((row) => {
              const overlay = workspace.overlayFor(row.id, row.status, row.disposition);
              return (
                <tr key={row.id}>
                  <td>
                    <Link href={`/cases/${row.id}`} className="font-semibold hover:underline">{row.reference}</Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge value={row.priority} tone={row.priority === "URGENT" ? "CRITICAL" : "INFO"} />
                      <button type="button" className="text-xs font-semibold text-info underline" onClick={() => setActiveId(row.id)}>
                        Preview
                      </button>
                    </div>
                  </td>
                  <td>
                    <Link href={`/customers/${row.customer_id}`} className="hover:underline">{row.customer_name}</Link>
                  </td>
                  <td>
                    <Badge value={row.risk_tier} />
                    <span className="num ml-2">{row.risk_score}</span>
                  </td>
                  <td className="text-xs text-muted">
                    {row.lvctr_required ? "LVCTR " : ""}
                    {row.str_candidate ? "STR review" : ""}
                  </td>
                  <td>{overlay.assignee}</td>
                  <td>{overlay.status.replaceAll("_", " ")}</td>
                  <td>{overlay.disposition ? overlay.disposition.replaceAll("_", " ") : "Undecided"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <SlideOver open={active != null && activeOverlay != null} title={active?.reference ?? "Case"} kicker={active?.customer_name ?? undefined} onClose={() => setActiveId(null)}>
        {active && activeOverlay ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge value={active.risk_tier} />
              <Badge value={active.priority} tone={active.priority === "URGENT" ? "CRITICAL" : "INFO"} />
              <span className="num text-sm text-muted">{active.risk_score}</span>
            </div>
            <StatusRail status={activeOverlay.status} />
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted">Assignee</dt><dd>{activeOverlay.assignee}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Disposition</dt><dd>{activeOverlay.disposition ? activeOverlay.disposition.replaceAll("_", " ") : "Undecided"}</dd></div>
              {active.opened_at ? <div className="flex justify-between gap-3"><dt className="text-muted">Opened</dt><dd>{when(active.opened_at)}</dd></div> : null}
              {active.due_at ? <div className="flex justify-between gap-3"><dt className="text-muted">Filing due</dt><dd>{when(active.due_at)}</dd></div> : null}
            </dl>
            {(active.risk_drivers ?? []).length > 0 ? (
              <ul className="space-y-3">
                {(active.risk_drivers ?? []).slice(0, 4).map((driver) => (
                  <li key={driver.label} className="text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="font-semibold">{driver.label}</span>
                      <span className="num text-muted">+{driver.points}</span>
                    </div>
                    {driver.detail ? <p className="text-muted">{driver.detail}</p> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <Link href={`/cases/${active.id}`} className="inline-flex rounded-full bg-spruce px-4 py-2 text-sm font-semibold text-white">
              Open the working file
            </Link>
          </div>
        ) : null}
      </SlideOver>
    </>
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
      <StatusRail status={overlay.status} />
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
        <div className="mt-3">
          {overlay.audit.length === 0 ? (
            <p className="text-sm text-muted">Local actions will appear here, newest first.</p>
          ) : (
            <Timeline
              events={overlay.audit.map((item) => ({
                at: item.at,
                kind: "local",
                title: item.action,
                detail: `${item.actor}. ${item.detail}`,
              }))}
            />
          )}
        </div>
      </section>
    </fieldset>
  );
}
