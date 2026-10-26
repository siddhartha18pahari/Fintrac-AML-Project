import { titleCase } from "@/lib/format";

const TIER: Record<string, string> = {
  CRITICAL: "bg-[#8c2f39] text-white",
  HIGH: "bg-[#9a5720] text-white",
  MEDIUM: "bg-[#f3e2b8] text-[#6d5314]",
  LOW: "bg-[#d7ebe3] text-[#145743]",
  REPORTING: "bg-[#d5e4f2] text-[#1c4f78]",
  INFO: "bg-[#efe8da] text-[#5c5346]",
};

export function Badge({ value, tone }: { value: string; tone?: string }) {
  const key = (tone ?? value).toUpperCase();
  const cls = TIER[key] ?? TIER.INFO;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide ${cls}`}>
      {titleCase(value)}
    </span>
  );
}

export function InstrumentTag({ value }: { value: string }) {
  const tone = value === "CASH" ? "HIGH" : value === "EFT" ? "REPORTING" : "LOW";
  return <Badge value={value === "VIRTUAL_CURRENCY" ? "Virtual currency" : value} tone={tone} />;
}
