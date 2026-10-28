"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/nav";

const LABELS = new Map(NAV.map((link) => [link.href, link.label]));

export function Breadcrumbs() {
  const path = usePathname() || "/";
  if (path === "/") return null;
  const parts = path.split("/").filter(Boolean);
  const crumbs = parts.map((part, index) => {
    const href = `/${parts.slice(0, index + 1).join("/")}`;
    const known = LABELS.get(href);
    const label = known ?? decodeURIComponent(part).replaceAll("-", " ");
    return { href, label, current: index === parts.length - 1 };
  });

  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        <li>
          <Link href="/dashboard" className="hover:text-ink">
            Workspace
          </Link>
        </li>
        {crumbs.map((crumb) => (
          <li key={crumb.href} className="flex items-center gap-1.5">
            <span aria-hidden="true">/</span>
            {crumb.current ? (
              <span className="font-semibold text-ink" aria-current="page">
                {crumb.label}
              </span>
            ) : (
              <Link href={crumb.href} className="hover:text-ink">
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
