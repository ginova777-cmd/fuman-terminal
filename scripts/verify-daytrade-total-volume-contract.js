"use strict";

const assert = require("assert");

function toLots(totalVolume, unit) {
  if (totalVolume === null || totalVolume === undefined || totalVolume === "") return { available: false, lots: null };
  const value = Number(totalVolume);
  if (!Number.isFinite(value) || value < 0) return { available: false, lots: null };
  if (unit === "lots") return { available: true, lots: value };
  if (unit === "shares") return { available: true, lots: value / 1000 };
  return { available: false, lots: null };
}

function passes(totalVolume, unit) {
  const normalized = toLots(totalVolume, unit);
  return normalized.available && normalized.lots >= 2000;
}

function coveragePass(handledRows, totalRows) {
  return Number.isInteger(handledRows)
    && Number.isInteger(totalRows)
    && totalRows > 0
    && handledRows >= Math.ceil(totalRows * 0.9);
}

assert.strictEqual(passes(1999, "lots"), false);
assert.strictEqual(passes(2000, "lots"), true);
assert.strictEqual(passes(2001, "lots"), true);
assert.strictEqual(passes(1999999, "shares"), false);
assert.strictEqual(passes(2000000, "shares"), true);
assert.strictEqual(passes(2000001, "shares"), true);
assert.strictEqual(passes(2000000, ""), false);
assert.strictEqual(passes(-1, "lots"), false);
assert.strictEqual(passes(null, "lots"), false);
assert.strictEqual(toLots(null, "lots").available, false);
assert.strictEqual(coveragePass(401, 446), false);
assert.strictEqual(coveragePass(402, 446), true);

console.log(JSON.stringify({
  ok: true,
  contract: "daytrade_total_volume_threshold_v1",
  threshold_lots: 2000,
  cases: 12,
  coverage_90: { total: 446, required: 402, below: false, boundary: true },
  boundary: {
    shares_1999999: false,
    shares_2000000: true,
    lots_1999: false,
    lots_2000: true,
  },
}));
