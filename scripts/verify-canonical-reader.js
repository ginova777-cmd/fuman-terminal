"use strict";

const assert = require("assert");
const { buildPublicationEnvelope, readCanonicalBatch, resolveMarketContext } = require("../lib/canonical-reader");

const base = {
  trade_date: "20260908", canonical_run_id: "strategy3:20260908:canonical", verification_run_id: "verify:20260908:001",
  batch_id: "batch:20260908:001", receipt_id: "receipt:001", contract_version: "strategy3-v2", field_version: "fields-v4",
  result_count: 7, status: "complete", complete: true, age_seconds: 60, coverage: { expected: 100, covered: 100 }, fallback_used: false,
};
const surfaces = Object.fromEntries(["desktop", "mobile", "route88", "line", "telegram"].map((name) => [name, { ...base }]));
const policy = { strategy: "strategy3", contract_version: "strategy3-v2", field_version: "fields-v4", requires_intraday_5m: false };

function run(at, changes = {}) {
  return readCanonicalBatch({ now: new Date(at), calendar: { tradeDate: "20260908", isTradingDay: true }, policy: { ...policy, ...(changes.policy || {}) }, receipt: { ...base, ...(changes.receipt || {}) }, surfaces: changes.surfaces || surfaces, resources: changes.resources || {} });
}

for (const [at, expected] of [["2026-09-08T08:30:00+08:00", "preopen"], ["2026-09-08T10:00:00+08:00", "intraday"], ["2026-09-08T14:00:00+08:00", "postmarket"]]) assert.equal(resolveMarketContext({ now: new Date(at), calendar: { isTradingDay: true } }).session, expected);
assert.equal(run("2026-09-08T10:00:00+08:00").publish_allowed, true);
assert.equal(run("2026-09-08T10:00:00+08:00", { receipt: { status: "complete", complete: false, ok: true } }).first_blocker, "receipt_not_complete");
assert.equal(run("2026-09-08T10:00:00+08:00", { receipt: { status: "partial", complete: true, ok: true } }).first_blocker, "receipt_not_complete");
assert.equal(run("2026-09-08T10:00:00+08:00", { receipt: { age_seconds: 181 } }).first_blocker, "freshness_stale");
assert(run("2026-09-08T10:00:00+08:00", { receipt: { coverage: { expected: 100, covered: 94 } } }).reason_codes.includes("coverage_below_threshold"));
assert(run("2026-09-08T10:00:00+08:00", { receipt: { fallback_used: true, fallback_source: "previous_good" } }).reason_codes.includes("fallback_not_allowed"));
const wrongTelegram = { ...surfaces, telegram: { ...base, batch_id: "different-batch" } };
assert(run("2026-09-08T10:00:00+08:00", { surfaces: wrongTelegram }).reason_codes.includes("surface_telegram_batch_id_mismatch"));
assert.equal(run("2026-09-08T10:00:00+08:00", { policy: { requires_intraday_5m: false } }).reason_codes.includes("intraday_5m_required_missing"), false);
assert(run("2026-09-08T10:00:00+08:00", { policy: { requires_intraday_5m: true } }).reason_codes.includes("intraday_5m_required_missing"));
assert.equal(run("2026-09-08T10:00:00+08:00", { policy: { requires_intraday_5m: true }, resources: { intraday_5m: base } }).publish_allowed, true);
const envelope = buildPublicationEnvelope(base, { rows: [{ code: "2330" }] });
assert.equal(envelope.batch_id, base.batch_id);
assert.throws(() => buildPublicationEnvelope({ ...base, complete: false, ok: true }, {}), /canonical_publication_receipt_not_complete/);
assert.throws(() => buildPublicationEnvelope({ trade_date: "20260908" }, {}), /canonical_publication_identity_missing/);
const holiday = readCanonicalBatch({ now: new Date("2026-09-08T10:00:00+08:00"), calendar: { tradeDate: "20260908", isTradingDay: false }, policy, receipt: {}, surfaces: {} });
assert.equal(holiday.status, "not_due");
assert.equal(holiday.reason_codes.length, 0);
console.log(JSON.stringify({ ok: true, contract: "canonical-reader-v1", checks: 18 }, null, 2));
