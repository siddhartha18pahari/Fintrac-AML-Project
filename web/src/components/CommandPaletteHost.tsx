import { CommandPalette, type CommandEntry } from "@/components/CommandPalette";
import { NAV } from "@/lib/nav";
import { data } from "@/lib/snapshot";

export function CommandPaletteHost() {
  const entries: CommandEntry[] = [
    ...NAV.map((link) => ({ href: link.href, label: link.label, hint: "Page", keywords: link.group })),
    ...data.customers.map((customer) => ({
      href: `/customers/${customer.id}`,
      label: customer.name,
      hint: "Customer",
      keywords: `${customer.customer_id} ${customer.profile.city ?? ""} ${customer.occupation_or_business}`,
    })),
    ...data.alerts.slice(0, 40).map((alert) => ({
      href: `/alerts/${alert.id}`,
      label: alert.title,
      hint: alert.rule_id,
      keywords: `${alert.customer_name ?? ""} ${alert.severity}`,
    })),
    ...data.cases.map((row) => ({
      href: `/cases/${row.id}`,
      label: row.reference,
      hint: row.customer_name ?? "Case",
      keywords: `${row.risk_tier} ${row.status}`,
    })),
    ...data.rules.filter((rule) => rule.in_force).map((rule) => ({
      href: "/rules",
      label: rule.name,
      hint: rule.rule_id,
      keywords: rule.category,
    })),
  ];
  return <CommandPalette entries={entries} />;
}
