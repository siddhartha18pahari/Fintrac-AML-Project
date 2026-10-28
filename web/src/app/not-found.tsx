import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-24">
      <div className="w-full">
        <EmptyState
          kicker="Sentinel"
          title="That record is not in the snapshot"
          detail="The bundled book is a fixed synthetic extract. The id in the address does not match a customer, alert, transaction, or draft."
          href="/dashboard"
          action="Back to the overview"
        />
        <p className="mt-4 text-center text-sm text-muted">
          <Link href="/geography" className="font-semibold text-info underline">Geography</Link>
          <span> · </span>
          <Link href="/graph" className="font-semibold text-info underline">Graph</Link>
        </p>
      </div>
    </div>
  );
}
