import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { NavLinks } from "@/components/Nav";
import { SearchButton } from "@/components/CommandPalette";
import { ThemeToggle } from "@/components/ThemeToggle";
import { data } from "@/lib/snapshot";

export function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[268px_1fr]">
      <aside className="no-print relative hidden border-r border-white/10 bg-spruce-deep text-[#e7f0eb] shadow-[16px_0_50px_rgba(7,20,16,0.28)] md:flex md:max-h-screen md:flex-col md:justify-between md:overflow-x-hidden md:overflow-y-auto md:px-4 md:py-6">
        <div className="pointer-events-none absolute -left-10 top-0 h-40 w-40 rounded-full bg-[#3dbea0]/20 blur-3xl" aria-hidden="true" />
        <div className="relative">
          <Link href="/" className="block px-3">
            <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-brass-soft">
              <span className="inline-block h-2 w-2 rounded-full bg-[#e2c48a] shadow-[0_0_12px_#e2c48a]" />
              Sentinel
            </span>
            <span className="mt-1 block font-display text-2xl tracking-tight text-white">FINTRAC workspace</span>
          </Link>
          <SearchButton className="mt-4 flex w-full items-center justify-between rounded-2xl border border-white/15 bg-white/5 px-3 py-2.5 text-left text-sm text-[#d7e4de] backdrop-blur hover:bg-white/10" />
          <div className="mt-5">
            <NavLinks variant="side" />
          </div>
        </div>
        <div className="relative mt-6 space-y-3">
          <ThemeToggle />
          <p className="px-3 text-xs leading-relaxed text-[#b7c9c0]">
            Synthetic book as of <span className="num">{data.meta.as_of.replace("T", " ").slice(0, 16)}</span> UTC. Press ? for shortcuts. Not a FINTRAC filing channel.
          </p>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="no-print border-b border-line bg-spruce-deep px-4 py-3 text-[#e7f0eb] md:hidden">
          <div className="mb-3 flex items-center justify-between gap-3">
            <Link href="/" className="font-display text-lg text-white">
              Sentinel
            </Link>
            <ThemeToggle compact />
          </div>
          <NavLinks variant="top" />
        </header>
        <main className={wide ? "px-4 py-6 sm:px-6 lg:px-8" : "mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8"}>
          <Breadcrumbs />
          {children}
        </main>
      </div>
    </div>
  );
}

export function PageIntro({
  kicker,
  title,
  lede,
}: {
  kicker: string;
  title: string;
  lede?: string;
}) {
  return (
    <header className="rise mb-6 max-w-3xl">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brass">{kicker}</p>
      <h1 className="mt-2 font-display text-4xl tracking-[-0.04em] text-spruce sm:text-5xl">{title}</h1>
      {lede ? <p className="mt-3 text-base leading-relaxed text-muted">{lede}</p> : null}
    </header>
  );
}
