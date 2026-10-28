export function parseBook(iso: string): number {
  const value = iso.endsWith("Z") ? iso : `${iso}Z`;
  return Date.parse(value);
}

export function addHours(iso: string, hours: number): string {
  return new Date(parseBook(iso) + hours * 3600_000).toISOString().replace(/\.\d{3}Z$/, "");
}

export function formatRemaining(deadline: string, now: string): { text: string; breached: boolean; ms: number } {
  const delta = parseBook(deadline) - parseBook(now);
  const abs = Math.abs(delta);
  const hours = Math.floor(abs / 3600_000);
  const minutes = Math.floor((abs % 3600_000) / 60_000);
  const text = hours >= 48 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h ${minutes}m`;
  if (delta >= 0) return { text: `${text} left`, breached: false, ms: delta };
  return { text: `${text} over`, breached: true, ms: delta };
}

const TIER_HOURS: Record<string, number> = {
  critical: 4,
  high: 24,
  medium: 72,
  low: 120,
  reporting: 120,
};

export function hoursFor(value: string): number {
  return TIER_HOURS[value.toLowerCase()] ?? 72;
}

export function caseDeadline(
  row: { id: number; due_at: string | null; risk_tier: string },
  alerts: { case_id: number | null; occurred_at: string }[],
  asOf: string,
): string {
  if (row.due_at) return row.due_at;
  const related = alerts
    .filter((alert) => alert.case_id === row.id)
    .map((alert) => alert.occurred_at)
    .sort();
  return addHours(related.at(-1) ?? asOf, hoursFor(row.risk_tier));
}

export function alertDeadline(alert: { occurred_at: string; severity: string }): string {
  return addHours(alert.occurred_at, hoursFor(alert.severity));
}
