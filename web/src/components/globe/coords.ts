/** Approximate centroids for counterparties in the bundled snapshot. */
export const COUNTRY_LL: Record<string, [number, number]> = {
  AE: [24.2, 54.3],
  CA: [56.1, -96.5],
  CN: [35.8, 104.2],
  DE: [51.2, 10.4],
  FR: [46.2, 2.2],
  GB: [54.5, -2.5],
  IR: [32.4, 53.7],
  MX: [23.6, -102.5],
  NG: [9.1, 8.7],
  US: [39.8, -98.6],
};

/** Ottawa, so arcs leave a recognisable Canadian point rather than the geometric centre. */
export const CANADA_LL: [number, number] = [45.42, -75.69];

export type GlobeCountry = {
  code: string;
  name: string;
  incoming_cad: number;
  outgoing_cad: number;
};
