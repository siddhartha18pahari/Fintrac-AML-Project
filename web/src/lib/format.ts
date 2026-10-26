const cadFormat = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  minimumFractionDigits: 2,
});

const numberFormat = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 });

export function money(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return cadFormat.format(value);
}

export function num(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return numberFormat.format(value);
}

export function when(value: string | null | undefined) {
  if (!value) return "—";
  const [date, time] = value.split("T");
  if (!time) return date;
  return `${date} ${time.slice(0, 5)}`;
}

export function day(value: string | null | undefined) {
  if (!value) return "—";
  return value.slice(0, 10);
}

export function titleCase(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function shortAddress(value: string | null | undefined) {
  if (!value) return "—";
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export function observedEntries(observed: Record<string, unknown>) {
  return Object.entries(observed).filter(([, value]) => value !== null && value !== undefined);
}

export function formatValue(value: unknown): string {
  if (typeof value === "number") return num(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((item) => formatValue(item)).join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "—");
}
