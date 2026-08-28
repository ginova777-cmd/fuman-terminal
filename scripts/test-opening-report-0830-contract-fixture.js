"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "fuman-opening-report-contract-"));
const date = "2026-08-28";
const compact = "20260828";
const reportDir = path.join(runtime, "data", "opening-report-0830");
const stateDir = path.join(runtime, "state");
fs.mkdirSync(reportDir, { recursive: true });
fs.mkdirSync(stateDir, { recursive: true });
const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");

write(path.join(reportDir, `opening-report-0820-preflight-receipt-${compact}.json`), {
  ok: true, date, evidence_cutoff: `${date} 08:20:00 Asia/Taipei`,
});
write(path.join(reportDir, `opening-report-0820-overseas-leaders-${compact}.json`), {
  cutoff: `${date} 08:20:00 Asia/Taipei`,
  industries: Array.from({ length: 19 }, (_, index) => ({
    leaders: index < 5
      ? [{ name: `stale-${index}`, yahoo_symbol: `${String(index).padStart(6, "0")}.KS`, ok: true, source_time: "2026-08-27T06:00:00.000Z" }]
      : [{ name: `fresh-${index}`, yahoo_symbol: `US${index}`, ok: true, source_time: "2026-08-27T20:00:00.000Z" }],
  })),
});
write(path.join(reportDir, `opening-report-0820-market-snapshot-${compact}.json`), {
  cutoff: `${date} 08:20:00 Asia/Taipei`, items: [{}, {}, {}, {}],
});

function run(args) {
  return spawnSync(process.execPath, [path.join(root, "scripts", "verify-opening-report-0830-contract.js"), ...args], {
    cwd: root,
    env: { ...process.env, FUMAN_RUNTIME_DIR: runtime, FUMAN_STATE_DIR: stateDir, FUMAN_TRADE_DATE: date },
    encoding: "utf8",
  });
}

const pre = run(["--pre-delivery"]);
assert.strictEqual(pre.status, 0, pre.stderr || pre.stdout);
const preOutput = JSON.parse(pre.stdout);
const leaderCheck = preOutput.checks.find((item) => item.name === "current_frozen_leaders");
assert.strictEqual(leaderCheck.ok, true);
assert.strictEqual(leaderCheck.source_gap_count, 5);

const runId = "opening-report-0830-20260828-fixture";
const hash = "a".repeat(64);
write(path.join(reportDir, `opening-report-0830-final-receipt-${compact}.json`), {
  report_status: "REPORT_OK", date, run_id: runId, delivery_content_hash: hash,
  formal_candidates: 0, watchlist_only: true,
  terminal_briefing_snapshot: { ok: true, report_run_id: runId, delivery_content_hash: hash },
});
for (let index = 0; index < 19; index += 1) {
  write(path.join(stateDir, `opening_report_0830.industry_bias.FIXTURE_${index}-${compact}.json`), {
    date, run_id: runId, report_time: "08:30", source: "opening_report_0830", mode: "priority_bias_only",
  });
}
write(path.join(reportDir, `opening-report-0830-terminal-briefing-verifier-${compact}.json`), { briefing_status: "PASS", date, run_id: runId, content_hash: hash });
const readonlyClosure = spawnSync(process.execPath, [path.join(root, "scripts", "verify-opening-report-0830-closure-readonly.js"), `--trade-date=${date}`], { cwd: root, env: { ...process.env, FUMAN_RUNTIME_DIR: runtime, FUMAN_OPENING_REPORT_STATE_DIR: stateDir }, encoding: "utf8" });
assert.strictEqual(readonlyClosure.status, 0, readonlyClosure.stderr || readonlyClosure.stdout);
const closure = run(["--require-current"]);
assert.strictEqual(closure.status, 0, closure.stderr || closure.stdout);
console.log(JSON.stringify({ ok: true, contract: "opening_report_0830_contract_fixture_v1", source_gap_count: 5 }, null, 2));
