"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");
const { spawnSync } = require("child_process");
const { verifyScorecardStrategyRules } = require("../lib/scorecard-rule-locks");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_SCORECARD_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const CHECK_LIVE = !process.argv.includes("--no-live");
const WRITE_OUTPUT = !process.argv.includes("--no-output");
const CHECK_SCHEDULE = !process.argv.includes("--skip-schedule");
const SNAPSHOT_FILE = argValue("--snapshot-file", process.env.FUMAN_SCORECARD_SNAPSHOT_FILE || "");
const MIN_ROWS = Number(argValue("--min-rows", process.env.FUMAN_SCORECARD_MIN_ROWS || "450")) || 0;
const MIN_ROW_RATIO = Number(argValue("--min-row-ratio", process.env.FUMAN_SCORECARD_MIN_ROW_RATIO || "0.8")) || 0;
const EXPECTED_STRATEGIES = [
  "策略1開盤入成績單",
  "策略2成績單",
  "策略3隔日沖成績單",
  "策略4成績單",
  "策略5成績單",
  "買賣超成績單",
  "權證成績單",
  "CB成績單",
  "即時雷達成績單",
];

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function timeMinutes(value) {
  const match = cleanText(value).match(/(?:^|T|\s)(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function readText(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function fetchText(pathname, timeoutMs = 30000) {
  const url = `${BASE_URL}${pathname}${pathname.includes("?") ? "&" : "?"}rollback=${Date.now()}`;
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: timeoutMs, headers: { "cache-control": "no-cache" } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode || 0, headers: response.headers, body }));
    });
    request.on("timeout", () => request.destroy(new Error(`timeout ${url}`)));
    request.on("error", reject);
  });
}

async function fetchJson(pathname, timeoutMs = 30000) {
  const response = await fetchText(pathname, timeoutMs);
  let json = null;
  try {
    json = JSON.parse(response.body || "null");
  } catch (error) {
    throw new Error(`${pathname} invalid JSON HTTP ${response.status}: ${error.message}`);
  }
  return { ...response, json };
}

function addCheck(checks, ok, id, message, detail = {}) {
  checks.push({ id, ok: Boolean(ok), message, detail });
}

function latestRows(payload) {
  const records = Array.isArray(payload?.records) ? payload.records : [];
  const latestDate = cleanText(payload?.latestDate || payload?.summary?.latestDate);
  return { records, latestDate, rows: records.filter((row) => cleanText(row.record_date) === latestDate) };
}

function rowsByStrategy(rows) {
  const byStrategy = {};
  for (const row of rows) {
    const strategy = cleanText(row.strategy || "未分類");
    byStrategy[strategy] = (byStrategy[strategy] || 0) + 1;
  }
  return byStrategy;
}

function uniqueDates(payload) {
  const records = Array.isArray(payload?.records) ? payload.records : [];
  return [...new Set(records.map((row) => cleanText(row.record_date)).filter(Boolean))].sort().reverse();
}

function verifyPayload(checks, payload, source, baseline = null) {
  const { records, latestDate, rows } = latestRows(payload);
  const byStrategy = rowsByStrategy(rows);
  const missingStrategies = EXPECTED_STRATEGIES.filter((strategy) => !byStrategy[strategy]);
  const summaryRows = cleanNumber(payload?.summary?.rows);
  const cacheSource = cleanText(payload?.cacheSource || payload?.sourceFields?.cacheSource);
  const sourceText = JSON.stringify({
    source: payload?.source,
    cacheSource: payload?.cacheSource,
    exportSource: payload?.exportSource,
    sourceFields: payload?.sourceFields,
  });
  const requiredFieldMissing = rows
    .map((row, index) => ({
      index,
      strategy: cleanText(row.strategy),
      ticker: cleanText(row.ticker),
      missing: [
        ["record_date", cleanText(row.record_date)],
        ["strategy", cleanText(row.strategy)],
        ["ticker", cleanText(row.ticker)],
        ["name", cleanText(row.name)],
        ["entry_time", cleanText(row.entry_time)],
        ["entry_price", cleanNumber(row.entry_price) > 0],
        ["high_price", cleanNumber(row.high_price) > 0],
        ["pnl", row.pnl !== undefined && row.pnl !== null && cleanText(row.pnl) !== ""],
        ["reason", cleanText(row.reason)],
      ].filter(([, ok]) => !ok).map(([field]) => field),
    }))
    .filter((row) => row.missing.length);
  const strategy2OutOfWindow = rows
    .filter((row) => cleanText(row.strategy) === "策略2成績單")
    .filter((row) => {
      const minutes = timeMinutes(row.entry_time);
      return minutes === null || minutes < 9 * 60 || minutes > 12 * 60;
    })
    .map((row) => ({ ticker: cleanText(row.ticker), entry_time: cleanText(row.entry_time) }));
  const strategy3Rows = rows.filter((row) => cleanText(row.strategy) === "策略3隔日沖成績單");
  const strategy3BadEntry = strategy3Rows
    .filter((row) => timeMinutes(row.entry_time) !== 13 * 60)
    .map((row) => ({ ticker: cleanText(row.ticker), entry_time: cleanText(row.entry_time) }));
  const strategy3BadSource = strategy3Rows
    .filter((row) => {
      const sourceDate = cleanText(row.source_date) || cleanText(row.reason).match(/策略3來源日=(\d{4}-\d{2}-\d{2})/)?.[1] || "";
      return !sourceDate || sourceDate === latestDate;
    })
    .map((row) => ({ ticker: cleanText(row.ticker), record_date: cleanText(row.record_date), source_date: cleanText(row.source_date) }));
  const cbBad = rows
    .filter((row) => cleanText(row.strategy) === "CB成績單")
    .filter((row) => !(cleanNumber(row.entry_price) > 0 && cleanNumber(row.high_price) > 0 && Number.isFinite(cleanNumber(row.pnl))))
    .map((row) => ({ ticker: cleanText(row.ticker), entry_price: row.entry_price, high_price: row.high_price, pnl: row.pnl }));
  const dates = uniqueDates(payload);
  const historyDates = Array.isArray(payload?.historyDates) ? payload.historyDates.map(cleanText).filter(Boolean) : dates;

  addCheck(checks, payload?.ok !== false, `${source}-ok`, `${source} ok must not be false`, { ok: payload?.ok });
  addCheck(checks, rows.length >= MIN_ROWS, `${source}-row-floor`, `${source} latestDate rows must not drop below floor`, { rows: rows.length, minRows: MIN_ROWS });
  addCheck(checks, summaryRows === 0 || summaryRows === records.length || summaryRows === rows.length, `${source}-summary-row-match`, `${source} summary.rows must match payload rows`, { summaryRows, records: records.length, latestRows: rows.length });
  addCheck(checks, cacheSource === "supabase-snapshot", `${source}-cache-source`, `${source} cacheSource must be supabase-snapshot`, { cacheSource });
  addCheck(checks, !/google|sheet|streamlit|duckdb|retired/i.test(sourceText), `${source}-no-retired-source`, `${source} must not point to retired source`, { sourceText });
  addCheck(checks, Boolean(latestDate), `${source}-latest-date`, `${source} latestDate exists`, { latestDate });
  addCheck(checks, missingStrategies.length === 0, `${source}-all-strategies`, `${source} must include all 9 strategies`, { byStrategy, missingStrategies });
  addCheck(checks, requiredFieldMissing.length === 0, `${source}-required-fields`, `${source} required fields must be filled`, { missingCount: requiredFieldMissing.length, samples: requiredFieldMissing.slice(0, 20) });
  addCheck(checks, strategy2OutOfWindow.length === 0, `${source}-strategy2-window`, `${source} strategy2 rows must stay within 09:00-12:00`, { strategy2OutOfWindow });
  addCheck(checks, strategy3Rows.length > 0 && strategy3BadEntry.length === 0, `${source}-strategy3-entry`, `${source} strategy3 rows must use 13:00 entry`, { strategy3Rows: strategy3Rows.length, strategy3BadEntry });
  addCheck(checks, strategy3BadSource.length === 0, `${source}-strategy3-source-date`, `${source} strategy3 must use previous trading-day source marker`, { strategy3BadSource });
  addCheck(checks, cbBad.length === 0, `${source}-cb-stock-price`, `${source} CB rows must keep detected stockPrice-based calculable entry`, { cbBad });
  addCheck(checks, historyDates.length > 0, `${source}-history-dates`, `${source} historyDates must exist`, { historyDates, dates });

  const strategyRules = verifyScorecardStrategyRules(payload, {
    source,
    requireContract: source === "candidate-snapshot",
  });
  for (const check of strategyRules.checks) checks.push(check);

  if (baseline) {
    const baselineDates = Array.isArray(baseline.historyDates) ? baseline.historyDates.map(cleanText).filter(Boolean) : uniqueDates(baseline);
    const baselineRows = latestRows(baseline).rows.length;
    const minRowsFromBaseline = Math.floor(baselineRows * MIN_ROW_RATIO);
    addCheck(checks, rows.length >= minRowsFromBaseline, `${source}-row-ratio`, `${source} rows must not suddenly drop against baseline`, { rows: rows.length, baselineRows, minRowsFromBaseline, minRowRatio: MIN_ROW_RATIO });
    if (baselineDates.length > 1) {
      addCheck(checks, historyDates.length > 1, `${source}-history-not-cleared`, `${source} must not clear multi-day history back to one day`, { historyDates, baselineDates });
    }
  }

  return { latestDate, rows: rows.length, byStrategy, historyDates };
}

function verifyHtml(checks, html, source) {
  addCheck(checks, html.includes("scorecard-history-date"), `${source}-history-date`, `${source} must keep history selector`, {});
  addCheck(checks, html.includes("scorecard-theme-toggle"), `${source}-theme-toggle`, `${source} must keep theme toggle`, {});
  addCheck(checks, !html.includes("scorecard-basis"), `${source}-no-basis-panel`, `${source} must not restore scorecard-basis panel`, {});
  addCheck(checks, /PNL_MULTIPLIER\s*=\s*1000/.test(html) && /損益\(元\)/.test(html), `${source}-pnl-multiplier`, `${source} must display pnl * 1000`, {});
  addCheck(checks, html.includes("☀") && html.includes("☾") && html.includes("#facc15"), `${source}-symbol-theme`, `${source} must keep yellow symbol theme toggle`, {});
}

function queryTask(taskName) {
  const escaped = taskName.replace(/"/g, '\\"');
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    [
      `$task = Get-ScheduledTask -TaskName "${escaped}" -ErrorAction SilentlyContinue`,
      "if (-not $task) { 'MISSING' } else {",
      "$action = @($task.Actions)[0]",
      "'FOUND'",
      "[string]$task.State",
      "([string]$action.Execute + ' ' + [string]$action.Arguments).Trim()",
      "}",
    ].join("; "),
  ], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    return null;
  }
  const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== "FOUND") return null;
  return {
    TaskName: taskName,
    State: lines[1] || "",
    TaskToRun: lines.slice(2).join(" "),
  };
}

function verifySchedules(checks) {
  const daily = queryTask("Fuman Scorecard Daily Automation 1400");
  const retired = queryTask("Fuman Scorecard Snapshot 1538");
  const autoRelease = queryTask("Fuman Auto Main Release 1615");
  addCheck(checks, Boolean(daily), "schedule-daily-exists", "Fuman Scorecard Daily Automation 1400 must exist", { daily });
  addCheck(checks, !/disabled/i.test(cleanText(daily?.State)), "schedule-daily-enabled", "Fuman Scorecard Daily Automation 1400 must stay enabled", { state: daily?.State });
  addCheck(checks, /run-scorecard-daily-automation\.ps1/i.test(cleanText(daily?.TaskToRun)), "schedule-daily-runner", "scorecard daily task must run run-scorecard-daily-automation.ps1", { taskToRun: daily?.TaskToRun });
  addCheck(checks, !retired || /disabled/i.test(cleanText(retired.State)), "schedule-retired-1538-disabled", "Fuman Scorecard Snapshot 1538 must not exist or must be disabled", { retired });
  addCheck(checks, !autoRelease || /disabled/i.test(cleanText(autoRelease.State)), "schedule-auto-release-disabled", "Fuman Auto Main Release 1615 must stay disabled", { autoRelease });
}

async function main() {
  const checks = [];
  const details = {};

  verifyHtml(checks, readText("88.html"), "local-88-html");
  if (CHECK_SCHEDULE) {
    verifySchedules(checks);
  }

  let livePayload = null;
  if (CHECK_LIVE) {
    const liveApi = await fetchJson("/api/scorecard", 35000);
    livePayload = liveApi.json;
    details.live = verifyPayload(checks, livePayload, "live-api");
    const liveHtml = await fetchText("/88", 30000);
    addCheck(checks, liveHtml.status >= 200 && liveHtml.status < 300, "live-88-http", "live /88 must return 2xx", { status: liveHtml.status });
    verifyHtml(checks, liveHtml.body, "live-88-html");
  }

  if (SNAPSHOT_FILE) {
    const candidate = readJsonFile(path.resolve(SNAPSHOT_FILE));
    details.candidate = verifyPayload(checks, candidate, "candidate-snapshot", livePayload);
  }

  const failed = checks.filter((check) => !check.ok);
  const report = {
    ok: failed.length === 0,
    checkedAt: new Date().toISOString(),
    contract: "scorecard-no-rollback-v1",
    checks,
    details,
  };
  if (WRITE_OUTPUT) {
    const outDir = path.join(ROOT, "outputs", "scorecard-no-rollback");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "scorecard-no-rollback.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(outDir, "scorecard-no-rollback.md"), [
      "# Scorecard No-Rollback",
      "",
      `ok: ${report.ok}`,
      `checkedAt: ${report.checkedAt}`,
      "",
      ...checks.map((check) => `- ${check.ok ? "OK" : "FAIL"} ${check.id}: ${check.message}`),
      "",
    ].join("\n"), "utf8");
  }

  if (failed.length) {
    console.error("[scorecard-no-rollback] failed");
    for (const check of failed) console.error(`- ${check.id}: ${check.message}`);
    process.exit(1);
  }
  console.log("[scorecard-no-rollback] ok");
}

main().catch((error) => {
  console.error(`[scorecard-no-rollback] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
