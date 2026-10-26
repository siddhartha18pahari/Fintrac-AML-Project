import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-6 py-24">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brass">Sentinel</p>
      <h1 className="mt-2 font-display text-4xl text-spruce">That record is not in the snapshot</h1>
      <p className="mt-3 text-muted">The bundled book is a fixed synthetic extract. The id in the address does not match a customer, alert, transaction or draft.</p>
      <Link href="/dashboard" className="mt-6 inline-block text-sm font-semibold text-info underline">Back to the overview</Link>
    </div>
  );
}
