"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const WRITE_RECEIPT = process.argv.includes("--write-receipt");
const writerPath = path.join(ROOT, "scripts", "run-daytrade-source-writer.js");
const manifestPath = path.join(RUNTIME, "cache", "intraday", "fugle-daytrade-ws-priority-symbols.json");
const logDir = path.join(RUNTIME, "logs");
const checks = [];
const add = (ok, name, detail) => checks.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) });
const taipeiParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).formatToParts(new Date()).reduce((out, item) => ({ ...out, [item.type]: item.value }), {});
const tradeDate = `${taipeiParts.year}-${taipeiParts.month}-${taipeiParts.day}`;
const minute = Number(taipeiParts.hour) * 60 + Number(taipeiParts.minute);
const writer = fs.readFileSync(writerPath, "utf8");

add(writer.includes('"fugle_daytrade_intraday_1m_status_cache"'), "preopen_status_cache_source_present");
add(writer.includes('"dedicated_daytrade_intraday_1m_status_cache_previous_trading_day_warmup"'), "preopen_warmup_source_label_present");
add(writer.includes('"get_fugle_daytrade_intraday_1m_latest_n"'), "canonical_latest_n_rpc_present");
add(writer.includes("symbols.slice(index, index + 40)") && writer.includes("bars_per_symbol: 25"), "ma20_rpc_is_bounded_and_batched");
add(writer.includes("row.synthetic !== true && row.is_synthetic !== true"), "synthetic_candles_rejected");
add(writer.includes("numberValue(row.continuous_candle_count) >= 20"), "ma20_requires_twenty_natural_candles");
add(/naturalWarmupRows\s*=\s*\[\.\.\.grouped\.values\(\)\]\.filter\([\s\S]{0,180}continuous_candle_count[\s\S]{0,80}>=\s*20/.test(writer), "incomplete_ma20_rows_excluded_from_map");
add(writer.includes("7 * 24 * 60 * 60"), "ma20_latest_natural_candle_age_bounded");
add(writer.includes("today_candle_count: 0"), "previous_day_candles_never_counted_as_today");
add(writer.includes("latestPriorTradeDate") && writer.includes("value < tradeDate"), "only_prior_trade_date_accepted");
add(writer.includes("ageDays >= 1 && ageDays <= 7"), "prior_session_age_bounded");
add(!/synthetic[^\n]{0,80}ready_ma20_continuous\s*:\s*true/i.test(writer), "synthetic_ma20_force_ready_absent");
const scopedFetches = writer.match(/fetchIntradayStatus\(priorityRows\)/g) || [];
add(scopedFetches.length === 2, "initial_and_post_sync_ma20_use_current_dynamic_mother_pool", scopedFetches.length);
add(!writer.includes("fetchIntradayStatus(activeSymbols)"), "full_market_ma20_query_removed");

let manifest = null;
try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch {}
add(Boolean(manifest), "runtime_manifest_readable", manifestPath);
if (manifest) {
  add(manifest.tradeDate === tradeDate, "runtime_trade_date_today", manifest.tradeDate);
  add(manifest.canonicalRunId === `fugle_daytrade_source:${tradeDate.replace(/-/g, "")}:canonical`, "runtime_canonical_run_id_today", manifest.canonicalRunId);
}

let latestLog = "";
let latestLogPath = "";
try {
  const files = fs.readdirSync(logDir)
    .filter((name) => /^daytrade-source-writer-.*\.stdout\.log$/.test(name))
    .map((name) => ({ name, file: path.join(logDir, name), stat: fs.statSync(path.join(logDir, name)) }))
    .filter((item) => item.stat.size > 0)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  for (const item of files) {
    const candidate = fs.readFileSync(item.file, "utf8");
    if (!candidate.includes('"motherPoolSymbols"') || !candidate.includes('"errors"')) continue;
    latestLogPath = item.file;
    latestLog = candidate;
    break;
  }
} catch {}
add(Boolean(latestLog), "latest_writer_log_readable", latestLogPath);
const readNumber = (key) => Number(latestLog.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`))?.[1] || 0);
const readString = (key) => latestLog.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`))?.[1] || "";
const motherPool = readNumber("motherPoolSymbols");
const readyMa20 = readNumber("readyMa20Continuous");
const readinessSource = readString("intraday1mReadinessSource");
const coverage = motherPool > 0 ? readyMa20 / motherPool : 0;
add(motherPool > 0, "mother_pool_present", motherPool);
add(readyMa20 <= motherPool, "ma20_ready_not_above_pool", { readyMa20, motherPool });
if (minute < 9 * 60) {
  add(readinessSource === "dedicated_daytrade_intraday_1m_latest_25_batched_natural_warmup", "preopen_uses_batched_natural_warmup", readinessSource);
  add(coverage >= 0.9, "preopen_ma20_coverage_at_least_90_percent", { readyMa20, motherPool, coverage });
}
add(/"errors"\s*:\s*\[\s*\]/.test(latestLog), "writer_errors_empty");

const failedChecks = checks.filter((item) => !item.ok);
let receipt = {
  ok: failedChecks.length === 0,
  complete: failedChecks.length === 0,
  contract: "daytrade_ma20_preopen_natural_warmup_runner_verifier_receipt_v1",
  checkedAt: new Date().toISOString(),
  tradeDate,
  phase: minute < 9 * 60 ? "preopen" : "intraday",
  motherPool,
  readyMa20,
  coverage,
  readinessSource,
  latestWriterLog: latestLogPath,
  checks,
  failedChecks: failedChecks.map((item) => item.name),
  firstBlocker: failedChecks[0]?.name || null,
  syntheticAllowed: false,
  createsFormalCandidate: false,
  publishAllowed: false,
};
if (WRITE_RECEIPT) {
  const receiptPath = path.join(RUNTIME, "data", "scan-receipts", `daytrade-ma20-preopen-warmup-${tradeDate.replace(/-/g, "")}.json`);
  receipt = { ...receipt, receiptPath };
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
process.exitCode = receipt.complete ? 0 : 1;
