#!/usr/bin/env node
const assert = require("assert");
const { normalizeFugleAggregate } = require("../lib/fugle-websocket-quotes");

function aggregate(overrides = {}) {
  return normalizeFugleAggregate({ data: { symbol: "2481", previousClose: 100, ...overrides } });
}

const formal = aggregate({ closePrice: 103, lastTrial: { price: 102 }, referencePrice: 100 });
assert.equal(formal.close, 103, "formal price must win");
assert.equal(formal.formalLastPrice, 103);
assert.equal(formal.trialPrice, 102);
assert.equal(formal.referencePrice, 100);
assert.equal(formal.isTrial, false);

const trial = aggregate({ closePrice: 0, lastTrial: { price: 102 }, referencePrice: 100 });
assert.equal(trial.close, 102, "trial price must warm the preopen quote");
assert.equal(trial.formalLastPrice, null);
assert.equal(trial.isTrial, true);

const reference = aggregate({ closePrice: 0, lastTrial: { price: 0 }, referencePrice: 100 });
assert.equal(reference.close, 100, "reference price must keep the warmup row visible");
assert.equal(reference.isTrial, false);

function formalGate(row, now = "09:00:00") {
  return now >= "09:00:00" && Number(row?.formalLastPrice) > 0 && row?.isTrial !== true;
}
assert.equal(formalGate(trial), false, "trial must not satisfy the post-open formal gate");
assert.equal(formalGate(reference), false, "reference warmup must not satisfy the post-open formal gate");
assert.equal(formalGate(formal), true, "formal trade remains acceptable after open");

console.log(JSON.stringify({
  ok: true,
  checks: ["formal-priority", "trial-fallback", "reference-warmup", "postopen-formal-gate"],
}));
