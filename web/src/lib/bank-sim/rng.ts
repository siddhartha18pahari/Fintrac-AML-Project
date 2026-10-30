/** Uint32 PRNG shared with app/services/bank_engine.py. Do not retune the mixer. */

export type Rng = {
  rand: () => number;
  gauss: (center: number, sigma: number) => number;
  int: (span: number) => number;
};

function quant(value: number) {
  return Math.round(value * 1e9) / 1e9;
}

export function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  const rand = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = (center: number, sigma: number) => {
    const u = Math.max(1e-9, rand());
    const v = rand();
    const z = quant(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
    return quant(center + sigma * z);
  };
  const int = (span: number) => Math.floor(rand() * span);
  return { rand, gauss, int };
}

export function quantize(value: number) {
  return quant(value);
}
