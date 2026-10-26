"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/alerts", label: "Alerts" },
  { href: "/customers", label: "Customers" },
  { href: "/transactions", label: "Transactions" },
  { href: "/network", label: "Network" },
  { href: "/reports", label: "STR drafts" },
  { href: "/rules", label: "Rules" },
];

export function NavLinks({ variant }: { variant: "side" | "top" }) {
  const path = usePathname();
  return (
    <nav aria-label="Workspace" className={variant === "top" ? "flex gap-1 overflow-x-auto" : "flex flex-col gap-1"}>
      {LINKS.map((link) => {
        const active = path === link.href || path.startsWith(`${link.href}/`);
        const base =
          variant === "side"
            ? "rounded-md px-3 py-2 text-sm"
            : "whitespace-nowrap rounded-full px-3 py-1.5 text-sm";
        const state = active
          ? "bg-[#e7d3a4] text-[#12352c] font-semibold"
          : "text-[#d7e4de] hover:bg-white/10 hover:text-white";
        return (
          <Link key={link.href} href={link.href} className={`${base} ${state}`} aria-current={active ? "page" : undefined}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
