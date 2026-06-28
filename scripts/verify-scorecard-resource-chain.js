"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");
const { spawnSync } = require("child_process");
const { readSnapshot } = require("../lib/supabase-snapshots");
const { serverSupabaseKey, serverSupabaseUrl } = require("../lib/server-supabase-key");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "outputs", "scorecard-resource-chain");
const SNAPSHOT_KEY = process.env.FUMAN_SCORECARD_SNAPSHOT_KEY || "scorecard_latest";
const BASE_URL = (process.env.FUMAN_SCORECARD_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const CHECK_LIVE = !process.argv.includes("--no-live");
const SCORECARD_ROOT = process.env.FUMAN_SCORECARD_ROOT || "C:\\Users\\ginov\\Documents\\Codex\\2026-06-22\\new-chat-7\\outputs\\backtest-scorecard";
const DUCKDB_FILE = process.env.FUMAN_SCORECARD_DUCKDB || path.join(SCORECARD_ROOT, "scorecard.duckdb");
const LOCAL_FILE = path.join(ROOT, "data", "scorecard-latest.json");
const MAX_STALE_DAYS = Number(process.env.FUMAN_SCORECARD_MAX_STALE_DAYS || "2");
const ALLOW_STALE = process.env.FUMAN_SCORECARD_ALLOW_STALE === "1";

function readText(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function rowSource(row = {}) {
  return cleanText(row.source || row.dataSource || row.data_source || row.source_sheet || "");
}

function summarizePayload(payload, source = "") {
  const records = Array.isArray(payload?.records) ? payload.records : [];
  const daily = Array.isArray(payload?.summary?.daily) ? payload.summary.daily : [];
  return {
    ok: Boolean(payload && payload.ok !== false),
    source: payload?.source || source,
    cacheSource: payload?.cacheSource || source,
    latestDate: payload?.latestDate || payload?.summary?.latestDate || "",
    updatedAt: payload?.updatedAt || "",
    days: cleanNumber(payload?.days),
    rows: records.length || cleanNumber(payload?.summary?.rows),
    strategies: new Set(records.map((row) => cleanText(row.strategy || "未分類")).filter(Boolean)).size,
    missingRecordSources: records.filter((row) => !rowSource(row)).length,
    missingDailySources: daily.filter((row) => !rowSource(row)).length,
    missingTicker: records.filter((row) => !cleanText(row.ticker)).length,
    missingName: records.filter((row) => !cleanText(row.name)).length,
    missingDate: records.filter((row) => !cleanText(row.record_date)).length,
  };
}

function parseDateOnly(value) {
  const text = cleanText(value).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function ageDaysFromToday(dateText) {
  const date = parseDateOnly(dateText);
  if (!date) return null;
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.floor((today.getTime() - date.getTime()) / 86400000);
}

function fileInfo(file) {
  try {
    const stat = fs.statSync(file);
    return {
      exists: true,
      path: file,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
    };
  } catch {
    return { exists: false, path: file };
  }
}

async function fetchSupabaseSourceRows(table, query) {
  const url = serverSupabaseUrl();
  const key = serverSupabaseKey();
  if (!url || !key) {
    return { ok: false, table, status: 0, rows: 0, reason: "missing_supabase_credentials" };
  }
  const endpoint = `${url}/rest/v1/${table}?${query}`;
  try {
    const response = await fetch(endpoint, {
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        accept: "application/json",
      },
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : [];
    } catch {
      json = null;
    }
    const rows = Array.isArray(json) ? json : [];
    return {
      ok: response.ok,
      table,
      status: response.status,
      rows: rows.length,
      sample: rows.slice(0, 3),
      reason: response.ok ? "" : (json?.message || text.slice(0, 240)),
    };
  } catch (error) {
    return { ok: false, table, status: 0, rows: 0, reason: error?.message || String(error) };
  }
}

function fetchText(pathname, timeoutMs = 30000) {
  const url = `${BASE_URL}${pathname}${pathname.includes("?") ? "&" : "?"}t=${Date.now()}`;
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

function queryScorecardTask() {
  if (process.platform !== "win32") return { skipped: true, reason: "non_windows" };
  const command = [
    "$task = Get-ScheduledTask -TaskName 'Fuman Scorecard Daily Automation 1400' -ErrorAction SilentlyContinue",
    "if (-not $task) { exit 2 }",
    "$info = Get-ScheduledTaskInfo -TaskName 'Fuman Scorecard Daily Automation 1400'",
    "$row = [pscustomobject]@{",
    "  TaskName = $task.TaskName",
    "  State = [string]$task.State",
    "  Execute = $task.Actions[0].Execute",
    "  Arguments = $task.Actions[0].Arguments",
    "  WorkingDirectory = $task.Actions[0].WorkingDirectory",
    "  LastRunTime = $info.LastRunTime.ToString('o')",
    "  LastTaskResult = $info.LastTaskResult",
    "  NextRunTime = $info.NextRunTime.ToString('o')",
    "  TriggerCount = $task.Triggers.Count",
    "}",
    "$row | ConvertTo-Json -Compress -Depth 4",
  ].join("\n");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
  let parsed = null;
  try {
    parsed = result.stdout ? JSON.parse(result.stdout) : null;
  } catch {}
  return {
    ok: result.status === 0,
    status: parsed?.State || "",
    taskToRun: `${parsed?.Execute || ""} ${parsed?.Arguments || ""}`.trim(),
    startIn: parsed?.WorkingDirectory || "",
    lastRunTime: parsed?.LastRunTime || "",
    lastResult: String(parsed?.LastTaskResult ?? ""),
    nextRunTime: parsed?.NextRunTime || "",
    triggerCount: cleanNumber(parsed?.TriggerCount),
    stderr: String(result.stderr || "").trim(),
  };
}

function addCheck(checks, ok, id, message, detail = {}) {
  checks.push({ id, ok: Boolean(ok), message, detail });
}

async function main() {
  const checks = [];
  const details = {};

  const vercel = JSON.parse(readText("vercel.json"));
  const rewrites = Array.isArray(vercel.rewrites) ? vercel.rewrites : [];
  const headers = Array.isArray(vercel.headers) ? vercel.headers : [];
  const noStore88 = headers.some((entry) =>
    (entry?.source === "/88" || entry?.source === "/88.html")
    && Array.isArray(entry.headers)
    && entry.headers.some((header) => String(header?.key || "").toLowerCase() === "cache-control" && /no-store/i.test(String(header?.value || "")))
  );
  details.route = {
    has88Rewrite: rewrites.some((route) => route?.source === "/88" && route?.destination === "/88.html"),
    hasNoStoreHeader: noStore88,
  };
  addCheck(checks, details.route.has88Rewrite, "route-88-rewrite", "vercel.json keeps /88 -> /88.html", details.route);
  addCheck(checks, details.route.hasNoStoreHeader, "route-88-no-store", "vercel.json keeps /88 no-store headers", details.route);

  const api = readText("api/scorecard.js");
  details.apiContract = {
    hasSnapshotKey: api.includes("scorecard_latest"),
    readsSupabaseSnapshot: api.includes("readSnapshot"),
    keepsFallbackFile: api.includes("scorecard-latest.json"),
    noStore: api.includes("no-store"),
  };
  addCheck(checks, details.apiContract.hasSnapshotKey && details.apiContract.readsSupabaseSnapshot, "api-supabase-snapshot", "api/scorecard.js reads Supabase scorecard_latest", details.apiContract);
  addCheck(checks, details.apiContract.keepsFallbackFile, "api-json-fallback", "api/scorecard.js keeps data/scorecard-latest.json only as fallback/bootstrap", details.apiContract);
  addCheck(checks, details.apiContract.noStore, "api-no-store", "api/scorecard.js uses no-store cache headers", details.apiContract);

  const page = readText("88.html");
  details.uiShell = {
    hasTitle: /輔滿成績單/.test(page),
    callsApi: /\/api\/scorecard/.test(page),
    hasTabs: /id="tabs"|class="tabs"/.test(page),
    hasSearch: /id="search"/.test(page),
    hasFilter: /id="result"|id="resultPills"|data-testid="scorecard-result-pills"/.test(page),
    showsSource: /來源/.test(page),
  };
  addCheck(checks, Object.values(details.uiShell).every(Boolean), "ui-shell-contract", "/88 shell has title, API call, tabs, search/filter, source footer", details.uiShell);

  const runner = readText("run-scorecard-daily-automation.ps1");
  details.runner = {
    terminalSourceFile: "C:\\fuman-runtime\\data\\scorecard-terminal-current.json",
    healthFile: "C:\\fuman-runtime\\data\\scorecard-source-health-latest.json",
    jsonFallbackFile: LOCAL_FILE,
    generatesTerminalSource: runner.includes("generate-terminal-scorecard-source.js"),
    backfillsSupabaseSource: runner.includes("scorecard-source-supabase-ops.js"),
    checksSupabaseSourceHealth: /scorecard-source-supabase-ops\.js[\"']?\s*,?\s*[\"']health/i.test(runner) || runner.includes('"health"'),
    exportsSupabaseSource: runner.includes("export-scorecard-supabase-source.js"),
    publishesSnapshot: runner.includes("publish-scorecard-snapshot.js"),
    verifiesSnapshot: runner.includes("verify-scorecard-snapshot.js"),
    verifiesResourceChain: runner.includes("verify-scorecard-resource-chain.js"),
    supportsNonTradingDayCarryForward: /Get-TradingDayStatus|AllowPreviousTradeDate|allowPreviousForRun/.test(runner),
    noGoogleSheet: !/google\s*sheet/i.test(runner),
    noStreamlit: !/streamlit|8501/i.test(runner),
  };
  addCheck(
    checks,
    details.runner.generatesTerminalSource
      && details.runner.backfillsSupabaseSource
      && details.runner.checksSupabaseSourceHealth
      && details.runner.exportsSupabaseSource
      && details.runner.publishesSnapshot
      && details.runner.verifiesSnapshot
      && details.runner.verifiesResourceChain,
    "runner-export-publish-verify",
    "run-scorecard-daily-automation.ps1 generates terminal source, backfills Supabase, exports, publishes, then verifies",
    details.runner,
  );
  addCheck(
    checks,
    details.runner.supportsNonTradingDayCarryForward,
    "runner-non-trading-day-carry-forward",
    "daily runner allows previous terminal batch only on non-trading days or explicit override",
    details.runner,
  );
  addCheck(checks, details.runner.noGoogleSheet && details.runner.noStreamlit, "runner-no-retired-source", "scorecard runner does not use Google Sheet or Streamlit as production source", details.runner);

  const upstreamRecords = await fetchSupabaseSourceRows("trade_records", "select=record_date,updated_at,source&order=record_date.desc&limit=5");
  const upstreamSummary = await fetchSupabaseSourceRows("strategy_daily_summary", "select=summary_date,strategy,updated_at,source&order=summary_date.desc&limit=5");
  details.supabaseUpstream = {
    expectedTables: ["trade_records", "strategy_daily_summary"],
    tradeRecords: upstreamRecords,
    strategyDailySummary: upstreamSummary,
  };
  addCheck(
    checks,
    upstreamRecords.ok && upstreamRecords.rows > 0 && upstreamSummary.ok && upstreamSummary.rows > 0,
    "scorecard-upstream-supabase-source",
    "scorecard upstream Supabase trade_records and strategy_daily_summary must exist and have rows",
    details.supabaseUpstream,
  );

  const localPayload = readJson(LOCAL_FILE);
  details.localFallback = summarizePayload(localPayload, "json-snapshot");
  addCheck(checks, details.localFallback.ok && details.localFallback.rows > 0, "local-fallback-rows", "data/scorecard-latest.json fallback has rows", details.localFallback);
  addCheck(checks, Boolean(details.localFallback.latestDate), "local-fallback-date", "data/scorecard-latest.json fallback has latestDate", details.localFallback);
  addCheck(checks, details.localFallback.missingRecordSources === 0 && details.localFallback.missingDailySources === 0, "local-fallback-source-fields", "local fallback rows have source fields", details.localFallback);

  const snapshot = await readSnapshot(SNAPSHOT_KEY, { allowLatestFallback: true, timeoutMs: 30000 }).catch((error) => ({ error }));
  const snapshotPayload = snapshot?.payload || null;
  details.supabaseSnapshot = {
    key: snapshot?.key || SNAPSHOT_KEY,
    tradeDate: snapshot?.tradeDate || "",
    updatedAt: snapshot?.updatedAt || "",
    snapshotSource: snapshot?.source || "",
    ...summarizePayload(snapshotPayload, "supabase-snapshot"),
  };
  addCheck(checks, Boolean(snapshotPayload), "supabase-snapshot-exists", "Supabase snapshot scorecard_latest exists", details.supabaseSnapshot);
  addCheck(checks, details.supabaseSnapshot.rows > 0, "supabase-snapshot-rows", "Supabase scorecard_latest has rows", details.supabaseSnapshot);
  addCheck(checks, details.supabaseSnapshot.cacheSource === "supabase-snapshot", "supabase-snapshot-cache-source", "Supabase scorecard_latest payload cacheSource=supabase-snapshot", details.supabaseSnapshot);
  addCheck(checks, details.supabaseSnapshot.missingRecordSources === 0 && details.supabaseSnapshot.missingDailySources === 0, "supabase-snapshot-source-fields", "Supabase scorecard rows have source fields", details.supabaseSnapshot);

  details.schedule = queryScorecardTask();
  addCheck(checks, details.schedule.ok === true, "schedule-exists", "Windows task Fuman Scorecard Daily Automation 1400 exists", details.schedule);
  addCheck(checks, /run-scorecard-daily-automation\.ps1/i.test(details.schedule.taskToRun || ""), "schedule-runner", "scorecard task runs run-scorecard-daily-automation.ps1", details.schedule);
  addCheck(checks, String(details.schedule.lastResult || "").trim() === "0", "schedule-last-result-zero", "scorecard task Last Result=0", details.schedule);

  if (CHECK_LIVE) {
    const liveApi = await fetchJson("/api/scorecard", 35000);
    details.liveApi = {
      status: liveApi.status,
      cacheControl: liveApi.headers["cache-control"] || "",
      ...summarizePayload(liveApi.json, liveApi.json?.cacheSource || "live"),
    };
    addCheck(checks, liveApi.status >= 200 && liveApi.status < 300, "live-api-http", "live /api/scorecard returns 2xx", details.liveApi);
    addCheck(checks, details.liveApi.rows > 0, "live-api-rows", "live /api/scorecard has rows", details.liveApi);
    addCheck(checks, details.liveApi.cacheSource === "supabase-snapshot", "live-api-supabase", "live /api/scorecard uses Supabase snapshot", details.liveApi);
    addCheck(checks, /no-store/i.test(details.liveApi.cacheControl), "live-api-no-store", "live /api/scorecard has no-store cache header", details.liveApi);

    const livePage = await fetchText("/88", 35000);
    details.livePage = {
      status: livePage.status,
      cacheControl: livePage.headers["cache-control"] || "",
      hasTitle: /輔滿成績單|FUMAN SCORECARD/.test(livePage.body),
      callsApi: /\/api\/scorecard/.test(livePage.body),
      hasRowsContainer: /id="rows"/.test(livePage.body),
    };
    addCheck(checks, livePage.status >= 200 && livePage.status < 300, "live-page-http", "live /88 returns 2xx", details.livePage);
    addCheck(checks, details.livePage.hasTitle && details.livePage.callsApi && details.livePage.hasRowsContainer, "live-page-shell", "live /88 renders scorecard shell and calls /api/scorecard", details.livePage);
  }

  const latestDates = [
    details.localFallback.latestDate,
    details.supabaseSnapshot.latestDate,
    CHECK_LIVE ? details.liveApi?.latestDate : "",
  ].filter(Boolean);
  const newestLatestDate = latestDates.sort().at(-1) || "";
  const sourceAgeDays = ageDaysFromToday(newestLatestDate);
  details.sourceFreshness = {
    latestDate: newestLatestDate,
    maxStaleDays: MAX_STALE_DAYS,
    ageDays: sourceAgeDays,
    allowStale: ALLOW_STALE,
    localLatestDate: details.localFallback.latestDate,
    supabaseLatestDate: details.supabaseSnapshot.latestDate,
    liveLatestDate: CHECK_LIVE ? details.liveApi?.latestDate || "" : "skipped",
    terminalSourceFile: details.runner.terminalSourceFile,
    healthFile: details.runner.healthFile,
    jsonFallbackFile: details.runner.jsonFallbackFile,
  };
  addCheck(
    checks,
    ALLOW_STALE || (Number.isFinite(sourceAgeDays) && sourceAgeDays <= MAX_STALE_DAYS),
    "scorecard-source-freshness",
    `scorecard source latestDate must be within ${MAX_STALE_DAYS} days unless FUMAN_SCORECARD_ALLOW_STALE=1`,
    details.sourceFreshness,
  );

  const retiredFiles = [
    "run-scorecard.ps1",
    "run-scorecard-initial.ps1",
    "run-scorecard-final.ps1",
    "run-preopen-strategy-scorecard.ps1",
    "run-upload-trade-manager-google-sheet.ps1",
    "run-upload-backtest-google-sheet.ps1",
  ];
  details.retiredFlows = Object.fromEntries(retiredFiles.map((file) => {
    const text = fs.existsSync(path.join(ROOT, file)) ? readText(file) : "";
    return [file, /retired|disabled|Google Sheet.*retired|source of truth/i.test(text)];
  }));
  addCheck(checks, Object.values(details.retiredFlows).every(Boolean), "retired-flows-disabled", "retired Google Sheet/Streamlit scorecard flows remain disabled", details.retiredFlows);

  const ok = checks.every((check) => check.ok);
  const report = {
    ok,
    checkedAt: new Date().toISOString(),
    contract: "scorecard-resource-chain-v1",
    snapshotKey: SNAPSHOT_KEY,
    checks,
    details,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "scorecard-resource-chain.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "scorecard-resource-chain.md"), [
    "# Scorecard Resource Chain",
    "",
    `ok: ${ok}`,
    `checkedAt: ${report.checkedAt}`,
    `snapshotKey: ${SNAPSHOT_KEY}`,
    "",
    ...checks.map((check) => `- ${check.ok ? "OK" : "FAIL"} ${check.id}: ${check.message}`),
    "",
  ].join("\n"), "utf8");
  console.log(`[scorecard-chain] wrote ${path.join(OUT_DIR, "scorecard-resource-chain.md")}`);
  if (!ok) {
    checks.filter((check) => !check.ok).forEach((check) => console.error(`- ${check.id}: ${check.message}`));
    process.exit(1);
  }
  console.log("[scorecard-chain] ok");
}

main().catch((error) => {
  console.error(`[scorecard-chain] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
