import type { Metadata } from "next";
import { Badge } from "@/components/Badges";
import { PageIntro, Shell } from "@/components/Shell";
import { data } from "@/lib/snapshot";

export const metadata: Metadata = { title: "Rules" };

const ORDER = ["threshold", "screening", "terrorist_property", "travel_rule", "trade", "typology", "structuring", "velocity", "behavioural", "transaction_size", "customer_inconsistency", "network", "counterparty", "third_party", "obfuscation", "geography"];

export default async function RulesPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  const showAll = all === "1";
  const rules = data.rules.filter((rule) => showAll || rule.in_force);
  const groups = ORDER.filter((category) => rules.some((rule) => rule.category === category));
  const extras = [...new Set(rules.map((rule) => rule.category))].filter((category) => !groups.includes(category));

  return (
    <Shell>
      <PageIntro
        kicker={`Catalogue ${data.meta.catalogue_version}`}
        title="Rules in force"
        lede="A rule publishes a new version when a threshold changes. Superseded versions stay in the catalogue so an old case can be reproduced. An indicator contributes points. It does not file a report."
      />
      <p className="mb-4 text-sm">
        {showAll ? (
          <a className="text-info underline" href="/rules">Show in-force versions only</a>
        ) : (
          <a className="text-info underline" href="/rules?all=1">Include superseded versions</a>
        )}
      </p>
      <div className="space-y-8">
        {[...groups, ...extras].map((category) => (
          <section key={category}>
            <h2 className="mb-3 font-display text-2xl text-spruce">{category.replaceAll("_", " ")}</h2>
            <div className="space-y-3">
              {rules.filter((rule) => rule.category === category).map((rule) => (
                <article key={`${rule.rule_id}-${rule.version}`} className="rounded-2xl border border-line bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">{rule.name}</h3>
                    <div className="flex items-center gap-2">
                      <span className="num text-xs text-muted">{rule.rule_id} v{rule.version}</span>
                      <Badge value={rule.severity} />
                      {rule.in_force ? <Badge value="In force" tone="LOW" /> : <Badge value="Superseded" tone="INFO" />}
                    </div>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{rule.description}</p>
                  <p className="mt-2 text-xs text-muted">
                    {rule.score_base} points · dedupe {rule.dedupe}
                    {Object.keys(rule.inputs).length ? ` · ${Object.entries(rule.inputs).map(([key, value]) => `${key} ${Array.isArray(value) ? value.join("/") : value}`).join(" · ")}` : ""}
                  </p>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Shell>
  );
}
