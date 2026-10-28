import Link from "next/link";
import { NavLinks } from "@/components/Nav";
import { SearchButton } from "@/components/CommandPalette";
import { ThemeToggle } from "@/components/ThemeToggle";
import { data } from "@/lib/snapshot";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="no-print hidden bg-spruce-deep text-[#e7f0eb] md:flex md:max-h-screen md:flex-col md:justify-between md:overflow-y-auto md:px-4 md:py-6">
        <div>
          <Link href="/" className="block px-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brass-soft">Sentinel</span>
            <span className="mt-1 block font-display text-xl text-white">FINTRAC workspace</span>
          </Link>
          <SearchButton className="mt-4 flex w-full items-center justify-between rounded-md border border-white/15 px-3 py-2 text-left text-sm text-[#d7e4de] hover:bg-white/10" />
          <div className="mt-4">
            <NavLinks variant="side" />
          </div>
        </div>
        <div className="mt-6 space-y-3">
          <ThemeToggle />
          <p className="px-3 text-xs leading-relaxed text-[#b7c9c0]">
            Synthetic book as of {data.meta.as_of.replace("T", " ").slice(0, 16)} UTC. Press ? for shortcuts. Not a FINTRAC filing channel.
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
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
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
    <header className="mb-6 max-w-3xl">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brass">{kicker}</p>
      <h1 className="mt-1 font-display text-3xl tracking-tight text-spruce sm:text-4xl">{title}</h1>
      {lede ? <p className="mt-2 text-base leading-relaxed text-muted">{lede}</p> : null}
    </header>
  );
}
