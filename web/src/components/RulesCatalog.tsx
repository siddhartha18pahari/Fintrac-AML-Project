"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/Badges";
import { AssistNote } from "@/components/Assist";
import { formatInputs, readRule, type CatalogueRule } from "@/lib/rule-guide";

type AlertLink = { id: number; rule_id: string; title: string; customer_name: string | null };

export function RulesCatalog({
  rules,
  alerts,
  version,
}: {
  rules: CatalogueRule[];
  alerts: AlertLink[];
  version: string;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [category, setCategory] = useState("all");
  const [force, setForce] = useState("in-force");
  const categories = useMemo(() => [...new Set(rules.map((rule) => rule.category))].sort(), [rules]);
  const needle = query.trim().toLowerCase();
  const visible = rules.filter((rule) => {
    const reading = readRule(rule);
    if (force === "in-force" && !rule.in_force) return false;
    if (force === "superseded" && rule.in_force) return false;
    if (kind !== "all" && reading.kind !== kind) return false;
    if (category !== "all" && rule.category !== category) return false;
    if (!needle) return true;
    return `${rule.rule_id} ${rule.name} ${rule.description} ${rule.category} ${reading.kindLabel}`.toLowerCase().includes(needle);
  });

  return (
    <div className="space-y-4">
      <AssistNote title="How to read a rule">
        Reporting observations follow a public threshold and still do not decide suspicion. Detection heuristics are catalogue choices. Sample-list rules match fictional names bundled with Sentinel. Open a rule, then the matching alerts, and compare observed values with the inputs before you open a case.
      </AssistNote>
      <section className="panel p-4">
        <h2 className="text-base font-semibold text-ink">Reporting line versus suspicion</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Catalogue {version}. CAD 10,000 on AML-FI-001, AML-FI-002 and AML-VC-012 is the line those observations use for a large cash, international electronic-transfer, or large virtual-currency receipt. It is not a test of suspicion, and staying under it is not a safe harbour for a suspicious transaction report. Public FINTRAC pages were consulted on 7 November 2026; exceptions and the full text stay on those pages. Sentinel does not file.
        </p>
        <ul className="mt-3 space-y-1 text-sm">
          <li>
            <a className="text-info underline" href="https://fintrac-canafe.canada.ca/individuals-individus/rpt-eng">
              FINTRAC — Financial transactions reported
            </a>
          </li>
          <li>
            <a className="text-info underline" href="https://fintrac-canafe.canada.ca/guidance-directives/transaction-operation/lctr-doie/lctr-doie-eng">
              FINTRAC — Reporting large cash transactions
            </a>
          </li>
          <li>
            <a className="text-info underline" href="https://fintrac-canafe.canada.ca/guidance-directives/transaction-operation/24hour/1-eng">
              FINTRAC — The 24-hour rule
            </a>
          </li>
        </ul>
      </section>
      <form className="panel grid gap-3 p-4 md:grid-cols-4" role="search" onSubmit={(event) => event.preventDefault()}>
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Search</span>
          <input className="field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rule id, name, or purpose" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Kind</span>
          <select className="field" value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="all">All kinds</option>
            <option value="reporting-observation">Reporting observations</option>
            <option value="detection-heuristic">Detection heuristics</option>
            <option value="sample-list">Fictional list matches</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Category</span>
          <select className="field" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All categories</option>
            {categories.map((item) => (
              <option key={item} value={item}>{item.replaceAll("_", " ")}</option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-wrap gap-2 md:col-span-4">
          {[
            ["in-force", "In force"],
            ["all", "All versions"],
            ["superseded", "Superseded"],
          ].map(([value, label]) => (
            <button key={value} type="button" className="btn btn-secondary" aria-pressed={force === value} onClick={() => setForce(value)}>
              {label}
            </button>
          ))}
          <p className="self-center text-sm text-muted">{visible.length} version{visible.length === 1 ? "" : "s"}</p>
        </fieldset>
      </form>
      {visible.length === 0 ? <p className="text-sm text-muted">No catalogue versions match these filters.</p> : null}
      <div className="space-y-3">
        {visible.map((rule) => {
          const reading = readRule(rule);
          const matches = alerts.filter((alert) => alert.rule_id === rule.rule_id);
          return (
            <article key={`${rule.rule_id}-${rule.version}`} id={rule.in_force ? rule.rule_id : `${rule.rule_id}-v${rule.version}`} className="panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">{reading.kindLabel} · {rule.category.replaceAll("_", " ")}</p>
                  <h2 className="mt-1 text-base font-semibold text-ink">{rule.name}</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="num text-xs text-muted">{rule.rule_id} v{rule.version}</span>
                  <Badge value={rule.severity} />
                  {rule.in_force ? <Badge value="In force" tone="LOW" /> : <Badge value="Superseded" tone="INFO" />}
                </div>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted">{rule.description}</p>
              <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Logic in this version</dt>
                  <dd className="mt-1">{formatInputs(rule.inputs)}</dd>
                  <p className="mt-1 text-xs text-muted">{rule.score_base} points · dedupe {rule.dedupe} · effective {rule.effective_from?.slice(0, 10) ?? "—"}{rule.effective_to ? ` to ${rule.effective_to.slice(0, 10)}` : ""}</p>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Data the rule needs</dt>
                  <dd className="mt-1 leading-6 text-muted">{reading.prerequisites}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Why this severity</dt>
                  <dd className="mt-1 leading-6 text-muted">
                    Severity {rule.severity} and {rule.score_base} points are catalogue weights for queue ordering. They are not a legal ranking and they do not set the reporting line.
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Limits and false positives</dt>
                  <dd className="mt-1 leading-6 text-muted">{reading.limitations}</dd>
                </div>
              </dl>
              {reading.reference ? (
                <p className="mt-3 text-sm leading-6">
                  <a className="font-semibold text-info underline" href={reading.reference.href}>{reading.reference.label}</a>
                  <span className="mt-1 block text-muted">{reading.reference.note}</span>
                </p>
              ) : (
                <p className="mt-3 text-xs leading-5 text-muted">No external legal citation is attached. This version is an illustrative detection heuristic in catalogue {version}.</p>
              )}
              <div className="mt-3">
                <Link className="btn btn-secondary" href={`/alerts?rule=${encodeURIComponent(rule.rule_id)}`}>
                  {matches.length} matching alert{matches.length === 1 ? "" : "s"}
                </Link>
                {matches[0] ? (
                  <p className="mt-2 text-xs text-muted">
                    Example in this book: <Link className="text-info underline" href={`/alerts/${matches[0].id}`}>{matches[0].title}</Link>
                    {matches[0].customer_name ? ` · ${matches[0].customer_name}` : ""}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted">No alert in the snapshot cites {rule.rule_id}.</p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
