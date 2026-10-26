import Link from "next/link";
import { NavLinks } from "@/components/Nav";
import { data } from "@/lib/snapshot";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
      <aside className="hidden bg-spruce-deep text-[#e7f0eb] md:flex md:flex-col md:justify-between md:px-4 md:py-6">
        <div>
          <Link href="/" className="block px-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brass-soft">Sentinel</span>
            <span className="mt-1 block font-display text-xl text-white">FINTRAC workspace</span>
          </Link>
          <div className="mt-8">
            <NavLinks variant="side" />
          </div>
        </div>
        <p className="px-3 text-xs leading-relaxed text-[#b7c9c0]">
          Synthetic book as of {data.meta.as_of.replace("T", " ").slice(0, 16)} UTC. Not a FINTRAC filing channel.
        </p>
      </aside>
      <div className="min-w-0">
        <header className="border-b border-line bg-spruce-deep px-4 py-3 text-[#e7f0eb] md:hidden">
          <div className="mb-3 flex items-center justify-between">
            <Link href="/" className="font-display text-lg text-white">
              Sentinel
            </Link>
            <span className="text-[11px] uppercase tracking-wider text-brass-soft">Synthetic</span>
          </div>
          <NavLinks variant="top" />
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
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
