/** Last-N calendar days of incoming value. Zero-activity days stay in the window. */

export type HeatInput = {
  at: string;
  direction: string;
  cad: number;
  instrument: string;
};

export type HeatDay = {
  date: string;
  weekday: number;
  cash: number;
  eft: number;
  virtual: number;
  total: number;
  count: number;
};

export type IncomingHeat = {
  start: string;
  end: string;
  days: number;
  rows: HeatDay[];
  max: number;
  incomingCount: number;
  excludedOutgoing: number;
};

function dayKey(value: string) {
  return value.slice(0, 10);
}

function shift(iso: string, delta: number) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function buildIncomingHeat(rows: HeatInput[], asOf: string, days = 31): IncomingHeat {
  const end = dayKey(asOf);
  const start = shift(end, -(days - 1));
  const buckets = new Map<string, HeatDay>();
  for (let cursor = start; cursor <= end; cursor = shift(cursor, 1)) {
    buckets.set(cursor, {
      date: cursor,
      weekday: new Date(`${cursor}T00:00:00Z`).getUTCDay(),
      cash: 0,
      eft: 0,
      virtual: 0,
      total: 0,
      count: 0,
    });
  }
  let excludedOutgoing = 0;
  let incomingCount = 0;
  for (const row of rows) {
    if (row.direction !== "INCOMING") {
      excludedOutgoing += 1;
      continue;
    }
    const key = dayKey(row.at);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const cad = Number(row.cad) || 0;
    if (row.instrument === "CASH") bucket.cash += cad;
    else if (row.instrument === "EFT") bucket.eft += cad;
    else bucket.virtual += cad;
    bucket.total += cad;
    bucket.count += 1;
    incomingCount += 1;
  }
  const series = [...buckets.values()].map((bucket) => ({
    ...bucket,
    cash: round2(bucket.cash),
    eft: round2(bucket.eft),
    virtual: round2(bucket.virtual),
    total: round2(bucket.total),
  }));
  return {
    start,
    end,
    days: series.length,
    rows: series,
    max: Math.max(0, ...series.map((row) => row.total)),
    incomingCount,
    excludedOutgoing,
  };
}
