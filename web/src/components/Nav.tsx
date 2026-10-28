"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/nav";

export { NAV };

export function NavLinks({ variant }: { variant: "side" | "top" }) {
  const path = usePathname();
  const groups = variant === "side" ? ["Work", "Subjects", "Reporting"] : [];
  const links = variant === "side" ? groups.flatMap((group) => NAV.filter((link) => link.group === group)) : NAV;

  return (
    <nav aria-label="Workspace" className={variant === "top" ? "flex gap-1 overflow-x-auto" : "flex flex-col gap-1"}>
      {variant === "side"
        ? groups.map((group) => (
            <div key={group} className="mb-2">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8eaa9f]">{group}</p>
              {NAV.filter((link) => link.group === group).map((link) => (
                <NavItem key={link.href} href={link.href} label={link.label} active={path === link.href || path.startsWith(`${link.href}/`)} variant={variant} />
              ))}
            </div>
          ))
        : links.map((link) => (
            <NavItem key={link.href} href={link.href} label={link.label} active={path === link.href || path.startsWith(`${link.href}/`)} variant={variant} />
          ))}
    </nav>
  );
}

function NavItem({ href, label, active, variant }: { href: string; label: string; active: boolean; variant: "side" | "top" }) {
  const base = variant === "side" ? "block rounded-md px-3 py-1.5 text-sm" : "whitespace-nowrap rounded-full px-3 py-1.5 text-sm";
  const state = active ? "bg-[#e7d3a4] text-[#12352c] font-semibold" : "text-[#d7e4de] hover:bg-white/10 hover:text-white";
  return (
    <motion.div whileHover={{ x: variant === "side" ? 3 : 0 }} transition={{ duration: 0.16 }}>
      <Link href={href} className={`${base} ${state}`} aria-current={active ? "page" : undefined}>
        {label}
      </Link>
    </motion.div>
  );
}
