/// <reference lib="webworker" />

import { injectPlant, simulateBook } from "../lib/bank-sim/engine";
import type { SimBook } from "../lib/bank-sim/types";

type Inbound =
  | { id: number; type: "simulate"; controls: Record<string, unknown> }
  | { id: number; type: "inject"; book: SimBook; typology: string; at: string };

self.onmessage = (event: MessageEvent<Inbound>) => {
  const message = event.data;
  const book = message.type === "inject" ? injectPlant(message.book, message.typology, message.at) : simulateBook(message.controls);
  self.postMessage({ id: message.id, book });
};
