type Province = {
  code: string;
  name: string;
  customers: number;
  alerts: number;
  high_residual: number;
  mean_residual: number;
};

const PLACES: Record<string, { x: number; y: number }> = {
  YT: { x: 118, y: 92 },
  NT: { x: 210, y: 86 },
  NU: { x: 360, y: 78 },
  BC: { x: 128, y: 188 },
  AB: { x: 196, y: 176 },
  SK: { x: 262, y: 168 },
  MB: { x: 330, y: 176 },
  ON: { x: 455, y: 230 },
  QC: { x: 545, y: 200 },
  NB: { x: 640, y: 228 },
  PE: { x: 668, y: 210 },
  NS: { x: 688, y: 250 },
  NL: { x: 700, y: 150 },
};

function tone(value: number) {
  if (value >= 75) return "#8c2f39";
  if (value >= 50) return "#9a5720";
  if (value >= 25) return "#9a7433";
  return "#1d684f";
}

export function GeoMap({ provinces }: { provinces: Province[] }) {
  const byCode = new Map(provinces.map((row) => [row.code, row]));
  const described = provinces
    .filter((row) => row.code !== "—")
    .map((row) => `${row.name}: ${row.customers} customers, ${row.alerts} alerts, mean residual ${row.mean_residual}`)
    .join(". ");

  return (
    <svg viewBox="0 0 780 420" role="img" aria-labelledby="canada-map-title" className="h-auto w-full text-spruce">
      <title id="canada-map-title">Customer activity by province</title>
      <desc>{described || "No provincial activity in this book."}</desc>
      <path
        d="M70 150 C90 70 180 40 280 55 C340 20 420 30 470 70 C520 40 600 55 650 90 C700 120 730 150 710 190 C760 210 750 270 690 290 C650 330 560 300 500 320 C430 360 300 330 230 300 C150 280 80 240 70 150 Z"
        fill="currentColor"
        opacity="0.08"
      />
      {Object.entries(PLACES).map(([code, place]) => {
        const row = byCode.get(code);
        const customers = row?.customers ?? 0;
        const radius = customers ? 10 + Math.min(18, customers) : 5;
        const label = row ? `${row.name}, ${row.customers} customers, ${row.alerts} alerts` : `${code}, no customers in this book`;
        return (
          <g key={code}>
            {row ? (
              <circle cx={place.x} cy={place.y} r={radius} fill={tone(row.mean_residual)}>
                <title>{label}</title>
              </circle>
            ) : (
              <circle cx={place.x} cy={place.y} r={radius} fill="currentColor" opacity="0.25">
                <title>{label}</title>
              </circle>
            )}
            <text x={place.x} y={place.y + radius + 12} textAnchor="middle" fontSize="11" fill="currentColor">
              {code}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
