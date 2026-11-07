/** Plain-language reading of the bundled catalogue. Statutory notes are limited to pages checked on 7 November 2026. */

export type CatalogueRule = {
  rule_id: string;
  version: string | number;
  name: string;
  category: string;
  severity: string;
  score_base: number;
  dedupe: string;
  inputs: Record<string, unknown>;
  description: string;
  effective_from: string | null;
  effective_to?: string | null;
  in_force: boolean;
};

export type RuleKind = "reporting-observation" | "detection-heuristic" | "sample-list";

export type RuleReading = {
  kind: RuleKind;
  kindLabel: string;
  prerequisites: string;
  limitations: string;
  reference: { label: string; href: string; note: string } | null;
};

const CONSULTED = "Public FINTRAC pages consulted 7 November 2026. They are not reproduced here, and this catalogue is not a filing channel or a complete statement of the Act.";

const REPORTS = "https://fintrac-canafe.canada.ca/individuals-individus/rpt-eng";
const LCTR = "https://fintrac-canafe.canada.ca/guidance-directives/transaction-operation/lctr-doie/lctr-doie-eng";
const HOURS = "https://fintrac-canafe.canada.ca/guidance-directives/transaction-operation/24hour/1-eng";

const KIND_LABEL: Record<RuleKind, string> = {
  "reporting-observation": "Reporting observation",
  "detection-heuristic": "Detection heuristic",
  "sample-list": "Fictional list match",
};

export function ruleKind(ruleId: string): RuleKind {
  if (ruleId === "AML-SC-001" || ruleId === "AML-SC-002" || ruleId === "AML-TF-001") return "sample-list";
  if (ruleId === "AML-FI-001" || ruleId === "AML-FI-002" || ruleId === "AML-VC-012") return "reporting-observation";
  return "detection-heuristic";
}

function prerequisites(rule: CatalogueRule) {
  const inputs = rule.inputs ?? {};
  const needs = ["A transaction row in the synthetic ledger with a CAD value and a timestamp."];
  if ("threshold_cad" in inputs || rule.category === "threshold") needs.push("CAD value at the catalogue line, after the snapshot valuation.");
  if ("window_hours" in inputs || "window_minutes" in inputs || "window_days" in inputs) needs.push("Timestamps that fall inside the encoded window. The window is the input on the rule, not a clock that keeps running after the snapshot.");
  if (rule.rule_id === "AML-FI-001") needs.push("Instrument cash, direction incoming, and a conductor the aggregator can group.");
  if (rule.rule_id === "AML-FI-002") needs.push("Instrument electronic funds transfer, marked international. Domestic wires are out of scope for this rule.");
  if (rule.rule_id === "AML-VC-012") needs.push("Virtual-currency receipts that share a conductor, beneficiary, or third party.");
  if (rule.category === "screening" || rule.rule_id === "AML-TF-001") needs.push("A party name and the bundled fictional list. There is no live sanctions feed.");
  if ("required_fields" in inputs) needs.push("Originator and beneficiary fields on the international transfer.");
  if (rule.category === "behavioural" || rule.rule_id === "AML-VC-015") needs.push("The customer’s own history or the volume declared at onboarding.");
  if (rule.category === "geography" || "jurisdictions" in inputs) needs.push("A counterparty country code. The jurisdiction list is a placeholder in configuration.");
  return needs.join(" ");
}

function limitations(rule: CatalogueRule) {
  const text = rule.description.trim();
  const base = "A hit contributes points and cites evidence. It does not file a report, approve a case, or establish that money laundering occurred.";
  if (ruleKind(rule.rule_id) === "reporting-observation") {
    return `${text} ${base} CAD 10,000 in this catalogue is a reporting line for the observation. It is not a universal suspicion threshold and it is not a safe harbour for a suspicious transaction report.`;
  }
  if (ruleKind(rule.rule_id) === "sample-list") {
    return `${text} ${base} The list is fictional and bundled with the snapshot. A match is not a legal designation.`;
  }
  return `${text} ${base} Thresholds on heuristic rules are tuning choices in the catalogue, not statutory tests.`;
}

function reference(rule: CatalogueRule): RuleReading["reference"] {
  if (rule.rule_id === "AML-FI-001") {
    return {
      label: "FINTRAC — Reporting large cash transactions, and the 24-hour rule",
      href: LCTR,
      note: `${CONSULTED} The large-cash page describes a report when $10,000 or more in cash is received in one transaction, and when two or more cash amounts total $10,000 or more in a consecutive 24-hour window for the same conductor, third party, or beneficiary. See also ${HOURS}. Exceptions are on those pages. AML-FI-001 is this book’s observation of that line.`,
    };
  }
  if (rule.rule_id === "AML-VC-012") {
    return {
      label: "FINTRAC — Financial transactions reported (large virtual currency)",
      href: REPORTS,
      note: `${CONSULTED} The overview describes a large virtual currency transaction report at $10,000 or more in one receipt or across the 24-hour rule. AML-VC-012 is the catalogue observation. It does not submit a report.`,
    };
  }
  if (rule.rule_id === "AML-FI-002") {
    return {
      label: "FINTRAC — Financial transactions reported (electronic funds transfer)",
      href: REPORTS,
      note: `${CONSULTED} The overview describes an electronic funds transfer report when a reporting entity sends or receives $10,000 or more. AML-FI-002 is narrower than that sentence: international transfers, one direction, domestic wires excluded. Do not treat the catalogue rule as the whole obligation.`,
    };
  }
  if (rule.rule_id === "AML-TF-001") {
    return {
      label: "FINTRAC — Listed person or entity property, for contrast only",
      href: REPORTS,
      note: `${CONSULTED} A listed-person property report is a separate obligation about property the entity knows is owned or controlled by a listed person or terrorist group. AML-TF-001 matches a fictional sample list and the rule text says it does not create that duty.`,
    };
  }
  return null;
}

export function readRule(rule: CatalogueRule): RuleReading {
  const kind = ruleKind(rule.rule_id);
  return {
    kind,
    kindLabel: KIND_LABEL[kind],
    prerequisites: prerequisites(rule),
    limitations: limitations(rule),
    reference: reference(rule),
  };
}

export function formatInputs(inputs: Record<string, unknown>) {
  const entries = Object.entries(inputs ?? {});
  if (!entries.length) return "No numeric inputs on this version. The description is the logic.";
  return entries
    .map(([key, value]) => {
      const rendered = Array.isArray(value) ? value.join(", ") : String(value);
      return `${key.replaceAll("_", " ")}: ${rendered}`;
    })
    .join(" · ");
}
