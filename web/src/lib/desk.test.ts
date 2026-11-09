import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptWorkspace, persistenceMode, WORKSPACE_UPSERT } from "./case-persistence.ts";
import { csvCell, toCsv } from "./csv.ts";
import { pageWindow, slicePage } from "./page.ts";

test("pages stay inside the requested window", () => {
  const window = pageWindow({ page: "2", pageSize: "10" });
  const page = slicePage(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"], window);
  assert.equal(page.page, 2);
  assert.deepEqual(page.items, ["k"]);
  assert.equal(page.total, 11);
  assert.equal(pageWindow({ page: "-4", pageSize: "500" }).pageSize, 50);
});

test("csv neutralises spreadsheet formulas", () => {
  assert.equal(csvCell("=cmd|calc"), "'=cmd|calc");
  assert.equal(csvCell("+1"), "'+1");
  assert.equal(csvCell("@sum"), "'@sum");
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  const csv = toCsv(["name", "note"], [["Ada", "=HYPERLINK(\"http://evil\")"]]);
  assert.match(csv, /'=HYPERLINK/);
  assert.doesNotMatch(csv, /\r\n=HYPERLINK/);
});

test("only a postgres URL is durable", () => {
  assert.equal(persistenceMode(undefined).mode, "demo-browser");
  assert.equal(persistenceMode("").mode, "demo-browser");
  assert.equal(persistenceMode("sqlite:///tmp/sentinel.db").mode, "demo-browser");
  assert.equal(persistenceMode("file:./cases.sqlite").mode, "demo-browser");
  assert.equal(persistenceMode("postgres://sentinel@db.internal:5432/sentinel").mode, "postgres");
  assert.equal(persistenceMode("postgresql://sentinel@localhost/sentinel").mode, "postgres");
  assert.match(WORKSPACE_UPSERT, /\$1/);
  assert.match(WORKSPACE_UPSERT, /\$2/);
  assert.match(WORKSPACE_UPSERT, /\$3::jsonb/);
});

test("approved decisions are not stored without an authenticated reviewer", () => {
  const notes = acceptWorkspace({
    status: "UNDER_REVIEW",
    assignee: "J. Okafor",
    disposition: "",
    notes: [{ id: "n1", at: "2026-10-01T00:00:00Z", author: "J. Okafor", body: "Opened the cash receipts." }],
    evidence: [{ id: "e1", at: "2026-10-01T00:00:00Z", author: "J. Okafor", name: "receipt.txt", mime: "text/plain", size: 12, note: "", preview: "data:text/plain,hello" }],
    approval: { status: "none", requestedBy: "", decidedBy: "", reason: "", at: "" },
  });
  assert.equal(notes.ok, true);
  if (notes.ok) {
    assert.equal(notes.strippedPreviews, 1);
    assert.equal(notes.record.evidence[0].preview, null);
    assert.equal(notes.record.notes[0].body, "Opened the cash receipts.");
  }
  const approved = acceptWorkspace({
    status: "APPROVED",
    approval: { status: "approved", requestedBy: "J. Okafor", decidedBy: "L. Chen", reason: "Looks fine to me", at: "2026-10-02T00:00:00Z" },
  });
  assert.equal(approved.ok, false);
  if (!approved.ok) assert.equal(approved.code, "approval_unauthenticated");
});
