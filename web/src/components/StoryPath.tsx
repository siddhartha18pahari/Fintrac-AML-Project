"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const STEPS = [
  { href: "/dashboard", label: "Portfolio", match: ["/dashboard"] },
  { href: "/alerts", label: "Alerts", match: ["/alerts", "/triage"] },
  { href: "/customers", label: "Customer", match: ["/customers", "/transactions"] },
  { href: "/graph", label: "Network", match: ["/graph", "/network"] },
  { href: "/geography", label: "Cross-border", match: ["/geography"] },
  { href: "/rules", label: "Rules", match: ["/rules"] },
  { href: "/cases", label: "Case", match: ["/cases", "/reports", "/filings"] },
  { href: "/statistics", label: "Tune", match: ["/statistics", "/performance", "/simulator"] },
];

export function StoryPath() {
  const path = usePathname() || "/";
  return (
    <nav aria-label="Investigation path" className="mb-4 flex gap-1 overflow-x-auto pb-1">
      {STEPS.map((step, index) => {
        const current = step.match.some((root) => path === root || path.startsWith(`${root}/`));
        return (
          <Link
            key={step.href}
            href={step.href}
            aria-current={current ? "step" : undefined}
            className="story-step whitespace-nowrap rounded-md border border-line px-2 py-1 text-xs text-muted"
          >
            <span className="num mr-1">{index + 1}</span>
            {step.label}
          </Link>
        );
      })}
    </nav>
  );
}
