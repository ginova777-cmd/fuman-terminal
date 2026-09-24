"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const runId = "strategy3v2-recovery-replay-20260911-20260911084738";
const personal = "U" + "a".repeat(32), group = "C" + "b".repeat(32);
async function simulate(sentTargets) {
  let calls = 0, recipients = [], receipt;
  const proc = { argv: ["node", "sender", "--recovery-replay"], env: { FUMAN_LINE_CHANNEL_ACCESS_TOKEN: "test-token", FUMAN_LINE_TO_USER: personal, FUMAN_LINE_TO_GROUP: group }, exit: code => { throw Error(`exit:${code}`); } };
  const fakeFs = { readFileSync: file => {
    if (file.endsWith("sent-notifications.jsonl")) return sentTargets.map(target => JSON.stringify({ channel: "line", target, status: "sent", idempotencyKey: `strategy3-v2-recovery-replay:${runId}` })).join("\n");
    throw Error("not found");
  } };
  const contract = { taipeiDate: () => "2026-09-11", nowTaipeiIso: () => "2026-09-11T17:00:00+08:00", readJson: () => ({ ok: true, status: "RECOVERY_REPLAY_COMPLETE", apply: true, run_id: runId, trade_date: "2026-09-11", result_count: 0, results: [] }), lineReceiptPath: () => "test-receipt", writeJson: (file, data) => { receipt = data; return file; }, failClosed: (reason, data) => ({ ...data, ok: false, reason }) };
  const ctx = { process: proc, console: { log() {}, error() {} }, require: name => {
    if (name === "fs") return fakeFs;
    if (name === "path") return path;
    if (name === "child_process") return { execFileSync: () => "" };
    if (name === "./strategy3-v2-contract") return contract;
    if (name === "./line-push") return { sendLineFlex: async () => { calls++; recipients = proc.env.LINE_TO.split(","); return recipients.map(target => ({ target, sent: true })); } };
    throw Error(`unexpected require ${name}`);
  } };
  const code = fs.readFileSync(path.join(__dirname, "send-strategy3-v2-line-card.js"), "utf8").replace("main().catch", "globalThis.task = main().catch");
  vm.runInNewContext(code, ctx);
  await ctx.task;
  return { calls, recipients, receipt };
}
test("already sent recovery batch does not resend", async () => {
  const x = await simulate([personal, group]); assert.equal(x.calls, 0); assert.equal(x.receipt.ok, true);
});
test("retry sends only missing group", async () => {
  const x = await simulate([personal]); assert.equal(x.calls, 1); assert.deepEqual(x.recipients, [group]); assert.equal(x.receipt.line_push_personal_ok, true); assert.equal(x.receipt.line_push_group_ok, true);
});
test("fresh batch sends both destinations", async () => {
  const x = await simulate([]); assert.equal(x.calls, 1); assert.deepEqual(x.recipients.sort(), [personal, group].sort()); assert.equal(x.receipt.ok, true);
});
