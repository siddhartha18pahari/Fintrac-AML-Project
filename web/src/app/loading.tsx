export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-16" aria-busy="true" aria-live="polite">
      <div className="h-3 w-28 animate-pulse rounded bg-line" />
      <div className="mt-3 h-10 w-2/3 animate-pulse rounded bg-line" />
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <div className="h-28 animate-pulse rounded-2xl bg-line" />
        <div className="h-28 animate-pulse rounded-2xl bg-line" />
        <div className="h-28 animate-pulse rounded-2xl bg-line" />
      </div>
      <p className="mt-6 text-sm text-muted">Loading the book.</p>
    </div>
  );
}
