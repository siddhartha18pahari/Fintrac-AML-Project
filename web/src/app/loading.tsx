export default function Loading() {
  return (
    <div className="mx-auto flex min-h-screen max-w-7xl gap-6 px-4 py-8" aria-busy="true" aria-live="polite">
      <div className="relative hidden w-64 shrink-0 overflow-hidden rounded-3xl bg-[#071410] p-4 md:block">
        <div className="skeleton h-4 w-24 bg-white/10" />
        <div className="skeleton mt-4 h-10 rounded-full bg-white/10" />
        <div className="mt-6 space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="skeleton h-8 bg-white/10" />
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="skeleton h-11 max-w-xl rounded-full" />
        <div className="skeleton mt-8 h-3 w-40" />
        <div className="skeleton mt-3 h-12 w-2/3 max-w-lg" />
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="skeleton h-28" />
          ))}
        </div>
        <div className="skeleton mt-4 h-64" />
        <p className="mt-6 text-sm text-muted">Loading the book.</p>
      </div>
    </div>
  );
}
