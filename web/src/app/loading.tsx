export default function Loading() {
  return (
    <div className="mx-auto flex min-h-screen max-w-7xl gap-6 px-4 py-8" aria-busy="true" aria-live="polite">
      <div className="relative hidden w-64 shrink-0 overflow-hidden rounded-3xl bg-spruce-deep p-4 md:block">
        <div className="shimmer h-4 w-24 rounded bg-white/15" />
        <div className="mt-6 space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="shimmer h-8 rounded-xl bg-white/10" />
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="shimmer h-3 w-40 rounded bg-line" />
        <div className="shimmer mt-3 h-12 w-2/3 max-w-lg rounded bg-line" />
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="panel h-28 shimmer" />
          ))}
        </div>
        <p className="mt-6 text-sm text-muted">Loading the book.</p>
      </div>
    </div>
  );
}
