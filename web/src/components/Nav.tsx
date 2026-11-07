"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AssistToggle } from "@/components/Assist";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NAV } from "@/lib/nav";

export { NAV };

export function NavLinks({ variant }: { variant: "side" | "top" }) {
  const path = usePathname();
  const groups = variant === "side" ? ["Work", "Subjects", "Reporting"] : [];

  return (
    <nav aria-label="Workspace" className={variant === "top" ? "flex gap-1 overflow-x-auto" : "flex flex-col gap-1"}>
      {variant === "side"
        ? groups.map((group) => (
            <div key={group} className="mb-3">
              <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{group}</p>
              {NAV.filter((link) => link.group === group).map((link) => (
                <NavItem
                  key={link.href}
                  href={link.href}
                  label={link.label}
                  shortcut={link.key}
                  active={path === link.href || path.startsWith(`${link.href}/`)}
                  variant={variant}
                />
              ))}
            </div>
          ))
        : NAV.map((link) => (
            <NavItem
              key={link.href}
              href={link.href}
              label={link.label}
              active={path === link.href || path.startsWith(`${link.href}/`)}
              variant={variant}
            />
          ))}
    </nav>
  );
}

function NavItem({
  href,
  label,
  active,
  variant,
  shortcut,
}: {
  href: string;
  label: string;
  active: boolean;
  variant: "side" | "top";
  shortcut?: string;
}) {
  const base = variant === "side" ? "flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm" : "whitespace-nowrap rounded-md px-2.5 py-1 text-sm";
  const state = active ? "nav-active" : "nav-idle";
  return (
    <Link href={href} className={`${base} ${state}`} aria-current={active ? "page" : undefined}>
      <span>{label}</span>
      {shortcut && variant === "side" ? <span className="num text-[10px] uppercase text-muted">{shortcut}</span> : null}
    </Link>
  );
}

export function MobileNav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [path]);

  return (
    <>
      <button type="button" className="btn btn-secondary md:hidden" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen(true)}>
        Menu
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div id="mobile-nav" className="relative flex h-dvh w-[min(100%,18rem)] flex-col border-r border-line bg-side text-ink">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="text-sm font-semibold">FINTRAC Sentinel</p>
              <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <NavLinks variant="side" />
            </div>
            <div className="space-y-3 border-t border-line p-3">
              <AssistToggle />
              <ThemeToggle />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
