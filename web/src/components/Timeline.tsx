import Link from "next/link";
import { when } from "@/lib/format";

export type TimelineEvent = {
  at: string;
  kind: string;
  title: string;
  detail?: string;
  href?: string;
};

const DOT: Record<string, string> = {
  critical: "bg-critical",
  high: "bg-high",
  medium: "bg-medium",
  low: "bg-low",
  reporting: "bg-info",
  due: "bg-brass",
  case: "bg-spruce",
};

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted">No activity on this relationship in the snapshot.</p>;
  }
  const ordered = [...events].sort((left, right) => right.at.localeCompare(left.at));
  return (
    <ol className="relative space-y-5 pl-1">
      <span className="absolute bottom-2 left-[7px] top-2 w-px bg-gradient-to-b from-brass via-line to-transparent" aria-hidden="true" />
      {ordered.map((event, index) => (
        <li key={`${event.kind}-${event.at}-${event.title}`} className="relative pl-7">
          <span
            className={`absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full ring-4 ring-paper ${DOT[event.kind.toLowerCase()] ?? "bg-brass"} ${index === 0 ? "step-pulse" : ""}`}
            aria-hidden="true"
          />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brass">
            {event.kind} · <time dateTime={event.at}>{when(event.at)}</time>
          </p>
          {event.href ? (
            <Link href={event.href} className="font-semibold hover:underline">
              {event.title}
            </Link>
          ) : (
            <p className="font-semibold">{event.title}</p>
          )}
          {event.detail ? <p className="text-sm leading-relaxed text-muted">{event.detail}</p> : null}
        </li>
      ))}
    </ol>
  );
}

const PIPELINE = ["NEW", "TRIAGE", "UNDER_REVIEW", "ESCALATED", "DECISION", "APPROVED", "CLOSED_NO_FILING"] as const;

export function StatusRail({ status }: { status: string }) {
  const current = status.toUpperCase();
  return (
    <ol className="flex gap-3 overflow-x-auto pb-1" aria-label="Case status">
      {PIPELINE.map((step) => {
        const on = step === current;
        return (
          <li key={step} aria-current={on ? "step" : undefined} className="flex min-w-fit items-center gap-2 text-[11px] font-semibold uppercase tracking-wider">
            <span className={`h-2.5 w-2.5 rounded-full ${on ? "bg-brass step-pulse" : "bg-line"}`} aria-hidden="true" />
            <span className={on ? "text-ink" : "text-muted"}>{step.replaceAll("_", " ")}</span>
          </li>
        );
      })}
    </ol>
  );
}
