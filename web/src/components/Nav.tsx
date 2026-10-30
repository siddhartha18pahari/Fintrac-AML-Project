"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8eaa9f]">{group}</p>
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
  const reduce = useReducedMotion() === true;
  const base = variant === "side" ? "flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm" : "whitespace-nowrap rounded-full px-3 py-1.5 text-sm";
  const state = active ? "nav-active font-semibold text-white" : "text-[#d7e4de] hover:bg-white/10 hover:text-white";
  return (
    <motion.div whileHover={reduce || variant !== "side" ? undefined : { x: 3 }} transition={{ duration: 0.16 }}>
      <Link href={href} className={`${base} ${state}`} aria-current={active ? "page" : undefined}>
        <span>{label}</span>
        {shortcut ? <span className="num text-[10px] uppercase tracking-wider text-white/35">{shortcut}</span> : null}
      </Link>
    </motion.div>
  );
}
