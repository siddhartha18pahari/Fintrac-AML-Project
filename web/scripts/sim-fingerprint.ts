import { fingerprint, simulateBook } from "../src/lib/bank-sim/engine";

const controls = {
  seed: 11,
  days: 14,
  customers: 12,
  structuring: true,
  layering: true,
  mules: true,
  trade: true,
  offramp: true,
  roundTrip: true,
  funnel: true,
  rapid: true,
  professional: true,
  payroll: true,
  rent: true,
  camouflage: 0,
  intensity: 0.55,
};

process.stdout.write(fingerprint(simulateBook(controls)));
