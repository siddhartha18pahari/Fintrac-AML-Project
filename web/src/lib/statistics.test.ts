import assert from "node:assert/strict";
import { test } from "node:test";
import { explainEdges } from "./graph-evidence.ts";
import { buildIncomingHeat } from "./incoming-heat.ts";
import { correlationMatrix, metricsAtThreshold } from "./statistics.ts";

test("selected thresholds classify a planted fixture differently", () => {
  const scores = [0.15, 0.42, 0.58, 0.73, 0.91];
  const labels = [0, 0, 1, 1, 0];
  const loose = metricsAtThreshold(scores, labels, 0.4);
  const tight = metricsAtThreshold(scores, labels, 0.8);
  assert.deepEqual([loose.tp, loose.fp, loose.tn, loose.fn], [2, 2, 1, 0]);
  assert.deepEqual([tight.tp, tight.fp, tight.tn, tight.fn], [0, 1, 2, 2]);
  assert.equal(loose.recall, 1);
  assert.equal(tight.recall, 0);
  assert.notEqual(loose.falsePositiveRate, tight.falsePositiveRate);
  assert.notEqual(loose.precision, tight.precision);
});

test("pearson is undefined for a constant series and exact for a line", () => {
  const matrix = correlationMatrix({
    count: [1, 2, 3, 4],
    total: [2, 4, 6, 8],
    flat: [5, 5, 5, 5],
  });
  assert.equal(matrix.method, "pearson");
  assert.equal(matrix.n, 4);
  assert.ok(matrix.matrix[0][1] != null && Math.abs(matrix.matrix[0][1] - 1) < 1e-9);
  assert.equal(matrix.matrix[0][2], null);
  assert.equal(matrix.matrix[2][2], null);
  assert.equal(correlationMatrix({ a: [1], b: [2] }).matrix[0][1], null);
  assert.equal(correlationMatrix({ a: [1, Number.NaN], b: [2, 3] }).matrix[0][1], null);
});

test("incoming heat is 31 calendar days and ignores outgoing rows", () => {
  const heat = buildIncomingHeat(
    [
      { at: "2026-10-01T12:00:00Z", direction: "INCOMING", cad: 100, instrument: "CASH" },
      { at: "2026-10-01T13:00:00Z", direction: "INCOMING", cad: 40, instrument: "EFT" },
      { at: "2026-09-01T09:00:00Z", direction: "INCOMING", cad: 5, instrument: "VIRTUAL_CURRENCY" },
      { at: "2026-08-01T09:00:00Z", direction: "INCOMING", cad: 999, instrument: "CASH" },
      { at: "2026-10-01T15:00:00Z", direction: "OUTGOING", cad: 80, instrument: "CASH" },
    ],
    "2026-10-01T18:00:00",
    31,
  );
  assert.equal(heat.days, 31);
  assert.equal(heat.start, "2026-09-01");
  assert.equal(heat.end, "2026-10-01");
  assert.equal(heat.rows[0].total, 5);
  assert.equal(heat.rows[0].count, 1);
  const middle = heat.rows.find((row) => row.date === "2026-09-15");
  assert.equal(middle?.total, 0);
  assert.equal(middle?.count, 0);
  const end = heat.rows.at(-1);
  assert.equal(end?.cash, 100);
  assert.equal(end?.eft, 40);
  assert.equal(end?.count, 2);
  assert.equal(heat.excludedOutgoing, 1);
});

test("wallet edges sum only the matching customer ledger rows", () => {
  const facts = explainEdges(
    [{ id: "wallet:customer:7:wallet:ETH:0xabc", source: "customer:7", target: "wallet:ETH:0xabc", relation: "wallet" }],
    [
      {
        id: 1,
        transaction_id: "tx_1",
        customer_id: 7,
        occurred_at: "2026-09-02T00:00:00Z",
        cad_value: 25,
        asset: "ETH",
        direction: "INCOMING",
        instrument: "VIRTUAL_CURRENCY",
        wallet_from: "0xabc",
        wallet_to: null,
        blockchain: "ETH",
        beneficiary_id: null,
        third_party_id: null,
        device_id: null,
      },
      {
        id: 2,
        transaction_id: "tx_2",
        customer_id: 8,
        occurred_at: "2026-09-03T00:00:00Z",
        cad_value: 900,
        asset: "ETH",
        direction: "INCOMING",
        instrument: "VIRTUAL_CURRENCY",
        wallet_from: "0xabc",
        wallet_to: null,
        blockchain: "ETH",
        beneficiary_id: null,
        third_party_id: null,
        device_id: null,
      },
    ],
    [],
  );
  const fact = facts["wallet:customer:7:wallet:ETH:0xabc"];
  assert.equal(fact.basis, "observed");
  assert.equal(fact.count, 1);
  assert.equal(fact.cad, 25);
  assert.equal(fact.currency, "CAD");
  assert.equal(fact.samples[0].ref, "tx_1");
});
