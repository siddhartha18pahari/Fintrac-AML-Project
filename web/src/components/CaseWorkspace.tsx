"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/Badges";
import { SlideOver } from "@/components/SlideOver";
import { StatusRail, Timeline } from "@/components/Timeline";
import { when } from "@/lib/format";
import { formatRemaining } from "@/lib/sla";
import { ACTORS, APPROVERS, ASSIGNEES, DISPOSITIONS, STATUSES, useWorkspace, type Pin } from "@/lib/workspace-store";

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
                      {overlay.approval.status === "pending" ? <Badge value="Four-eyes" tone="HIGH" /> : null}
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
              <div className="flex justify-between gap-3"><dt className="text-muted">Four-eyes</dt><dd>{activeOverlay.approval.status}</dd></div>
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
  asOf,
  deadline,
}: {
  namespace: string;
  caseId: number;
  status: string;
  disposition: string | null;
  asOf?: string;
  deadline?: string;
}) {
  const workspace = useWorkspace(namespace);
  const overlay = workspace.overlayFor(caseId, status, disposition);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const clock = asOf && deadline ? formatRemaining(deadline, asOf) : null;
  const approver = (APPROVERS as readonly string[]).includes(workspace.actor);

  return (
    <fieldset disabled={!workspace.ready} className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <StatusRail status={overlay.status} />
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Acting as</span>
          <select className="field" value={workspace.actor} onChange={(event) => workspace.setActor(event.target.value)}>
            {ACTORS.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
      </div>
      {clock ? (
        <div className={`rounded-2xl border px-4 py-3 ${clock.breached ? "border-critical/40 bg-critical/10" : "border-low/30 bg-low/10"}`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Book SLA</p>
          <p className={`num mt-1 text-3xl font-semibold ${clock.breached ? "text-critical" : "text-low"}`}>{clock.text}</p>
          <p className="mt-1 text-xs text-muted">Measured from the snapshot clock, so a refresh does not age the case.</p>
        </div>
      ) : null}
      <p className="text-sm text-muted">
        Assignment, notes, evidence and the four-eyes decision stay in this browser. They do not submit a report and they do not change the detection snapshot.
      </p>
      {workspace.notice ? <p className="rounded-xl border border-brass/40 bg-brass/10 px-3 py-2 text-sm" role="status">{workspace.notice}</p> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Assignee</span>
          <select className="field" value={overlay.assignee} onChange={(event) => workspace.assign(caseId, status, disposition, event.target.value)}>
            {ASSIGNEES.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Status</span>
          <select className="field" value={overlay.status} onChange={(event) => workspace.setStatus(caseId, status, disposition, event.target.value)}>
            {STATUSES.map((value) => (
              <option key={value} value={value} disabled={value === "APPROVED"}>{value.replaceAll("_", " ")}{value === "APPROVED" ? " (four-eyes)" : ""}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Disposition</span>
          <select className="field" value={overlay.disposition} onChange={(event) => workspace.setDisposition(caseId, status, disposition, event.target.value)}>
            {DISPOSITIONS.map((value) => (
              <option key={value || "none"} value={value}>{value ? value.replaceAll("_", " ") : "Undecided"}</option>
            ))}
          </select>
        </label>
      </div>
      <section className="rounded-2xl border border-line bg-card/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-xl text-spruce">Four-eyes</h3>
          <Badge value={overlay.approval.status} tone={overlay.approval.status === "approved" ? "LOW" : overlay.approval.status === "rejected" ? "CRITICAL" : "INFO"} />
        </div>
        <p className="mt-1 text-sm text-muted">The requester cannot approve their own case. The second review is L. Chen or D. Vasquez.</p>
        {overlay.approval.requestedBy ? (
          <p className="mt-2 text-sm">Requested by {overlay.approval.requestedBy}{overlay.approval.decidedBy ? ` · decided by ${overlay.approval.decidedBy}` : ""}.</p>
        ) : null}
        {overlay.approval.reason ? <p className="mt-1 text-sm text-muted">{overlay.approval.reason}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="rounded-full bg-spruce px-4 py-2 text-sm font-semibold text-white" onClick={() => workspace.requestApproval(caseId, status, disposition)}>
            Request approval
          </button>
        </div>
        <label className="mt-3 block text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Second-review reason</span>
          <textarea className="field" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={approver ? "Why this decision holds." : "Switch acting-as to an approver to record the decision."} />
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="rounded-full border border-line px-4 py-2 text-sm font-semibold" onClick={() => { workspace.decideApproval(caseId, status, disposition, "approved", reason); setReason(""); }}>
            Approve
          </button>
          <button type="button" className="rounded-full border border-line px-4 py-2 text-sm font-semibold" onClick={() => { workspace.decideApproval(caseId, status, disposition, "rejected", reason); setReason(""); }}>
            Send back
          </button>
        </div>
      </section>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          workspace.addNote(caseId, status, disposition, note);
          setNote("");
        }}
      >
        <label htmlFor={`note-${caseId}`} className="block text-xs font-semibold uppercase tracking-wider text-muted">Add a note</label>
        <textarea id={`note-${caseId}`} value={note} onChange={(event) => setNote(event.target.value)} rows={3} className="field" placeholder="What you looked at, and what you decided." />
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="rounded-md bg-spruce px-4 py-2 text-sm font-semibold text-white">Save note</button>
          <button type="button" onClick={() => workspace.reset(caseId)} className="rounded-md border border-line px-4 py-2 text-sm font-semibold">Reset local record</button>
        </div>
      </form>
      <EvidenceTray
        items={overlay.evidence}
        onAdd={(file) => workspace.addEvidence(caseId, status, disposition, { ...file, author: workspace.actor })}
        onRemove={(id) => workspace.removeEvidence(caseId, status, disposition, id)}
      />
      <section>
        <h3 className="font-display text-xl text-spruce">Notes</h3>
        {overlay.notes.length === 0 ? <p className="mt-2 text-sm text-muted">No notes in this browser yet.</p> : (
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
        <p className="mt-1 text-xs text-muted">Each local action carries a hash of the previous one. It is a browser chain, not the server audit.</p>
        <div className="mt-3">
          {overlay.audit.length === 0 ? <p className="text-sm text-muted">Local actions will appear here, newest first.</p> : (
            <Timeline
              events={overlay.audit.map((item) => ({
                at: item.at,
                kind: "local",
                title: item.action,
                detail: `${item.actor}. ${item.detail}${item.hash ? ` Chain ${item.hash}.` : ""}`,
              }))}
            />
          )}
        </div>
      </section>
    </fieldset>
  );
}

function EvidenceTray({
  items,
  onAdd,
  onRemove,
}: {
  items: { id: string; name: string; mime: string; size: number; note: string; preview: string | null; at: string; author: string }[];
  onAdd: (file: { id: string; at: string; name: string; mime: string; size: number; note: string; preview: string | null }) => void;
  onRemove: (id: string) => void;
}) {
  const [note, setNote] = useState("");
  const caption = useMemo(() => (items.length ? `${items.length} attachment${items.length === 1 ? "" : "s"}` : "No attachments"), [items.length]);
  return (
    <section>
      <h3 className="font-display text-xl text-spruce">Evidence</h3>
      <p className="mt-1 text-sm text-muted">{caption}. Files under 180 KB keep a local preview. Larger files keep the name and size only.</p>
      <label className="mt-3 block text-sm">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Note on the file</span>
        <input className="field" value={note} onChange={(event) => setNote(event.target.value)} placeholder="What this file is for." />
      </label>
      <input
        className="mt-2 block text-sm"
        type="file"
        aria-label="Attach evidence"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const base = { id: `${Date.now().toString(36)}-${file.name}`, at: new Date().toISOString(), name: file.name, mime: file.type || "application/octet-stream", size: file.size, note: note.trim(), preview: null as string | null };
          if (file.size > 180_000) {
            onAdd(base);
            setNote("");
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            onAdd({ ...base, preview: typeof reader.result === "string" ? reader.result : null });
            setNote("");
          };
          reader.readAsDataURL(file);
        }}
      />
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item.id} className="rounded-xl border border-line px-3 py-2 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{item.name}</p>
                <p className="text-xs text-muted">{item.mime} · {item.size.toLocaleString()} bytes · {item.author}</p>
                {item.note ? <p className="mt-1">{item.note}</p> : null}
              </div>
              <button type="button" className="text-xs font-semibold text-info underline" onClick={() => onRemove(item.id)}>Remove</button>
            </div>
            {item.preview?.startsWith("data:image/") ? <img src={item.preview} alt="" className="mt-2 max-h-32 rounded-lg" /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function InvestigationCanvas({
  namespace,
  caseId,
  status,
  disposition,
  seeds,
}: {
  namespace: string;
  caseId: number;
  status: string;
  disposition: string | null;
  seeds: Pin[];
}) {
  const workspace = useWorkspace(namespace);
  const overlay = workspace.overlayFor(caseId, status, disposition);
  const pins = overlay.pins.length ? overlay.pins : seeds;
  return (
    <section className="panel glass overflow-hidden p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brass">Investigation canvas</p>
          <h2 className="font-display text-2xl text-spruce">Pin the evidence where you can see it</h2>
        </div>
        <p className="max-w-md text-xs text-muted">Drag a card. Positions stay in this browser. The pins are a working layout, not a finding.</p>
      </div>
      <div className="relative h-[420px] overflow-hidden rounded-3xl border border-white/10 bg-[#071410] text-[#e7f0ec]" style={{ backgroundImage: "linear-gradient(rgba(226,196,138,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(226,196,138,0.08) 1px, transparent 1px)", backgroundSize: "32px 32px" }}>
        {pins.map((pin) => (
          <article
            key={pin.id}
            className="absolute w-44 cursor-grab rounded-2xl border border-[#e2c48a]/30 bg-[#10211c]/90 p-3 shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
            style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
            onPointerDown={(event) => {
              const board = event.currentTarget.parentElement;
              if (!board) return;
              const rect = board.getBoundingClientRect();
              const originX = event.clientX;
              const originY = event.clientY;
              const start = pins.find((item) => item.id === pin.id) ?? pin;
              const move = (pointer: PointerEvent) => {
                const x = Math.min(78, Math.max(2, start.x + ((pointer.clientX - originX) / rect.width) * 100));
                const y = Math.min(78, Math.max(2, start.y + ((pointer.clientY - originY) / rect.height) * 100));
                workspace.setPins(caseId, status, disposition, pins.map((item) => (item.id === pin.id ? { ...item, x, y } : item)));
              };
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#e2c48a]">{pin.kind}</p>
            <p className="mt-1 text-sm font-semibold leading-snug">{pin.label}</p>
            <p className="mt-1 line-clamp-3 text-xs text-[#b7c7bf]">{pin.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
