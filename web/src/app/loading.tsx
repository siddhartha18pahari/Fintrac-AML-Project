export default function Loading() {
  return (
    <div className="mx-auto flex min-h-screen max-w-7xl gap-6 px-4 py-8" aria-busy="true" aria-live="polite">
      <div className="hidden w-56 shrink-0 rounded-3xl bg-spruce-deep/90 p-4 md:block">
        <div className="h-4 w-20 animate-pulse rounded bg-white/20" />
        <div className="mt-6 space-y-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-8 animate-pulse rounded-lg bg-white/10" />
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="h-3 w-40 animate-pulse rounded bg-line" />
        <div className="mt-3 h-10 w-2/3 max-w-md animate-pulse rounded bg-line" />
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="panel h-28 animate-pulse bg-line/70" />
          ))}
        </div>
        <p className="mt-6 text-sm text-muted">Loading the book.</p>
      </div>
    </div>
  );
}