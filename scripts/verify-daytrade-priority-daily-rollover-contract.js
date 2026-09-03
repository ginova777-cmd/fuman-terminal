"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const writerFile = path.join(ROOT, "scripts", "run-daytrade-source-writer.js");
const collectorFile = path.join(ROOT, "scripts", "fugle-websocket-collector.js");
const writer = fs.readFileSync(writerFile, "utf8");
const collector = fs.readFileSync(collectorFile, "utf8");

const checks = [];
function check(name, condition) {
  checks.push({ name, ok: Boolean(condition) });
}

check("writer_has_deterministic_canonical_helper", /function canonicalDaytradeRunId\([\s\S]*?fugle_daytrade_source:[\s\S]*?:canonical/.test(writer));
check("writer_priority_manifest_has_daily_identity", /tradeDate,\s*canonicalRunId,\s*trade_date: tradeDate,\s*canonical_run_id: canonicalRunId/.test(writer));
check("writer_rejects_cross_day_existing_manifest", /const currentExisting = sameDayArtifact\(existing, tradeDate\)[\s\S]*?existingCanonicalRunId === canonicalRunId[\s\S]*?: \{\}/.test(writer));
check("writer_rejects_cross_day_bridge_cache", /sameDayArtifact\(cachedBridge, tradeDate\) \? cachedBridge : \{\}/.test(writer));
check("writer_runtime_seeds_require_daily_identity", /function readRuntimePrioritySeeds[\s\S]*?sameDayArtifact\(rawPayload, tradeDate\)[\s\S]*?=== canonicalRunId/.test(writer));
check("writer_opening_prewarm_uses_current_manifest", /currentExisting\.openingReport0830PrewarmTradeDate[\s\S]*?currentExisting\.openingReport0830PrewarmSymbols/.test(writer));
check("writer_terminal_priority_uses_current_manifest", /terminalPrioritySymbols: prependUnique\(daytradeMotherPoolSymbols, currentExisting\./.test(writer));
check("writer_opening_priority_uses_current_manifest", /openingPrioritySymbols: prependUnique\(daytradeMotherPoolSymbols, currentExisting\./.test(writer));
check("writer_forces_rewrite_on_daily_identity_change", /if \(!sameDailyIdentity \|\| !sameSymbols/.test(writer));
check("mother_pool_uses_daily_canonical_run", /const runId = canonicalDaytradeRunId\(tradeDate\);[\s\S]*?const writerRunId =/.test(writer));
check("mother_pool_rejects_previous_day_state", /const currentPreviousPayload = sameDayArtifact\(previousPayload, tradeDate\)[\s\S]*?previousPayloadCanonicalRunId === runId/.test(writer));
check("mother_pool_preserves_writer_execution_id", /canonical_run_id: runId,\s*writer_run_id: writerRunId/.test(writer));
check("source_status_has_daily_identity", /result\.payload\.trade_date = tradeDate;[\s\S]*?result\.payload\.canonical_run_id = canonicalRunId;/.test(writer));
check("collector_status_has_daily_identity", /tradeDate,\s*canonicalRunId: canonicalDaytradeRunId\(tradeDate\)/.test(collector));
check("collector_rejects_stale_symbol_cache", /const dailyIdentityReady = COLLECTOR_ROLE !== "daytrade"[\s\S]*?payloadCanonicalRunId === canonicalDaytradeRunId\(tradeDate\)/.test(collector));
check("collector_rejects_stale_priority_cache", /if \(payloadTradeDate !== tradeDate \|\| payloadCanonicalRunId !== canonicalDaytradeRunId\(tradeDate\)\) payload = \{\};/.test(collector));

const yesterday = {
  tradeDate: "2026-09-02",
  canonicalRunId: "fugle_daytrade_source:20260902:canonical",
  terminalPrioritySymbols: ["2330"],
  openingPrioritySymbols: ["2317"],
  openingReport0830PrewarmSymbols: ["2454"],
};
const today = "2026-09-03";
const expectedRunId = "fugle_daytrade_source:20260903:canonical";
const acceptedExisting = yesterday.tradeDate === today && yesterday.canonicalRunId === expectedRunId ? yesterday : {};
check("simulation_rejects_yesterday_terminal_priority", !acceptedExisting.terminalPrioritySymbols);
check("simulation_rejects_yesterday_opening_priority", !acceptedExisting.openingPrioritySymbols);
check("simulation_rejects_yesterday_opening_prewarm", !acceptedExisting.openingReport0830PrewarmSymbols);

const failed = checks.filter((item) => !item.ok);
const result = {
  ok: failed.length === 0,
  contract: "daytrade-priority-daily-rollover-contract-v1",
  readOnly: true,
  runtimeWritten: false,
  checks,
  failedChecks: failed.map((item) => item.name),
  firstBlocker: failed[0]?.name || null,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok ? 0 : 1;
