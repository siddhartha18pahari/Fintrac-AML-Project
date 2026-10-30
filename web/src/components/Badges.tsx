import { titleCase } from "@/lib/format";

const TIER: Record<string, string> = {
  CRITICAL: "bg-critical/15 text-critical ring-1 ring-critical/30",
  HIGH: "bg-high/15 text-high ring-1 ring-high/30",
  MEDIUM: "bg-medium/15 text-medium ring-1 ring-medium/35",
  LOW: "bg-low/15 text-low ring-1 ring-low/30",
  REPORTING: "bg-info/15 text-info ring-1 ring-info/30",
  INFO: "bg-line text-muted ring-1 ring-line",
};

export function Badge({ value, tone }: { value: string; tone?: string }) {
  const key = (tone ?? value).toUpperCase();
  const cls = TIER[key] ?? TIER.INFO;
  const pulse = key === "CRITICAL" || key === "HIGH" ? "risk-pulse" : "";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide ${cls} ${pulse}`}>
      {titleCase(value)}
    </span>
  );
}

export function InstrumentTag({ value }: { value: string }) {
  const tone = value === "CASH" ? "HIGH" : value === "EFT" ? "REPORTING" : "LOW";
  return <Badge value={value === "VIRTUAL_CURRENCY" ? "Virtual currency" : value} tone={tone} />;
}
