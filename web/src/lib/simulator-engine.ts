/** Public entry used by the studio route. The bank lives in bank-sim. */

export type { Evaluation, SimBook, SimControls, SimCustomer, SimHit, SimTxn } from "./bank-sim/types";
export { PRESETS, SIM_DEFAULTS, evaluateBook, fingerprint, injectPlant, scoreBook, simulateBook } from "./bank-sim/engine";
