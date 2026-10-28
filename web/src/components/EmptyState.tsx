import Link from "next/link";

export function EmptyState({
  kicker = "Nothing in view",
  title,
  detail,
  href,
  action,
}: {
  kicker?: string;
  title: string;
  detail: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-line bg-card/70 px-6 py-14 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brass">{kicker}</p>
      <h2 className="mt-2 font-display text-3xl tracking-tight text-spruce">{title}</h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">{detail}</p>
      {href && action ? (
        <Link href={href} className="mt-6 inline-flex rounded-full bg-spruce px-4 py-2 text-sm font-semibold text-white">
          {action}
        </Link>
      ) : null}
    </div>
  );
}
