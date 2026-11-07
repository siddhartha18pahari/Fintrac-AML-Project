import Link from "next/link";
import { AssistToggle } from "@/components/Assist";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MobileNav, NavLinks } from "@/components/Nav";
import { SearchButton } from "@/components/CommandPalette";
import { StoryPath } from "@/components/StoryPath";
import { ThemeToggle } from "@/components/ThemeToggle";
import { data } from "@/lib/snapshot";

export function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  const asOf = data.meta.as_of.replace("T", " ").slice(0, 16);
  return (
    <div className="app-shell">
      <aside className="app-side">
        <div className="border-b border-line px-4 py-4">
          <Link href="/dashboard" className="block">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">FINTRAC Sentinel</span>
            <span className="mt-0.5 block text-base font-semibold tracking-tight text-ink">Investigation book</span>
          </Link>
          <p className="mt-2 text-xs leading-5 text-muted">Synthetic snapshot. Not a filing channel.</p>
        </div>
        <div className="app-side-nav">
          <NavLinks variant="side" />
        </div>
        <div className="app-side-foot space-y-3">
          <AssistToggle />
          <ThemeToggle />
          <p className="text-xs leading-5 text-muted">
            Book as of <span className="num">{asOf}</span> UTC. Catalogue {data.meta.catalogue_version}.
          </p>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-top no-print">
          <MobileNav />
          <div className="min-w-0 flex-1">
            <Breadcrumbs />
            <SearchButton
              label="Search customers, alerts, rules"
              className="command-trigger mt-1 flex w-full max-w-xl items-center justify-between rounded-md px-3 py-1.5 text-left text-sm"
            />
          </div>
          <p className="hidden text-xs text-muted xl:block">
            As of <span className="num">{data.meta.as_of.slice(0, 10)}</span>
          </p>
          <div className="hidden md:block">
            <AssistToggle compact />
          </div>
          <ThemeToggle compact />
        </header>
        <div className="app-scroll">
          <main className={wide ? "px-4 py-5 sm:px-6 lg:px-8" : "mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8"}>
            <StoryPath />
            {children}
          </main>
        </div>
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
    <header className="mb-5 max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{kicker}</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      {lede ? <p className="mt-2 text-sm leading-6 text-muted">{lede}</p> : null}
    </header>
  );
}
