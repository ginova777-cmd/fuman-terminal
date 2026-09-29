"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path");
const { preserveVerifiedPreflight, writePreflightReceipt } = require("../lib/opening-preflight-receipt");
const good = { contract: "opening-report-0830-preflight-v2", ok: true, frozen_market_snapshot_ok: true,
  night_futures_ok: true, overseas_detector_ok: true, within_0830_preflight_window: true,
  run_id: "run-1", date: "2026-09-24", stage: "us_0820" };
const late = { ...good, ok: false, within_0830_preflight_window: false };
test("late retry remains failed without overwriting verified source evidence", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opening-preflight-"));
  const file = path.join(dir, "receipt.json");
  writePreflightReceipt(file, good);
  const prior = fs.readFileSync(file, "utf8");
  const attemptFile = writePreflightReceipt(file, late);
  assert.notEqual(attemptFile, file);
  assert.equal(fs.readFileSync(file, "utf8"), prior);
  const saved = JSON.parse(fs.readFileSync(attemptFile, "utf8"));
  assert.equal(saved.ok, false);
  assert.equal(saved.preserved_verified_receipt, file);
});
test("different identity or unverified previous attempt cannot be reused", () => {
  for (const field of ["run_id", "date", "stage"]) assert.equal(preserveVerifiedPreflight(good, { ...late, [field]: "different" }), false);
  for (const field of ["ok", "frozen_market_snapshot_ok", "night_futures_ok", "overseas_detector_ok", "within_0830_preflight_window"]) {
    assert.equal(preserveVerifiedPreflight({ ...good, [field]: false }, late), false);
  }
  assert.equal(preserveVerifiedPreflight(good, { ...late, within_0830_preflight_window: true }), false);
});
