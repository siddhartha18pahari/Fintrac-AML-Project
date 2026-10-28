import Link from "next/link";
import { when } from "@/lib/format";

export type TimelineEvent = {
  at: string;
  kind: string;
  title: string;
  detail?: string;
  href?: string;
};

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted">No activity on this relationship in the snapshot.</p>;
  }
  const ordered = [...events].sort((left, right) => right.at.localeCompare(left.at));
  return (
    <ol className="relative space-y-4 border-l border-line pl-5">
      {ordered.map((event) => (
        <li key={`${event.kind}-${event.at}-${event.title}`} className="relative">
          <span className="absolute -left-[1.45rem] top-1.5 h-2.5 w-2.5 rounded-full bg-brass" aria-hidden="true" />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brass">
            {event.kind} · <time dateTime={event.at}>{when(event.at)}</time>
          </p>
          {event.href ? (
            <Link href={event.href} className="font-semibold hover:underline">{event.title}</Link>
          ) : (
            <p className="font-semibold">{event.title}</p>
          )}
          {event.detail ? <p className="text-sm leading-relaxed text-muted">{event.detail}</p> : null}
        </li>
      ))}
    </ol>
  );
}
