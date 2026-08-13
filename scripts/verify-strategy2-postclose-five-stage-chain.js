"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const REPORT_PATH = path.join(RUNTIME_DIR, "data", "strategy2-ps1-backtest-latest.json");
const DIAGNOSTIC_API = require(path.join(ROOT, "api", "strategy2-ps1-backtest.js"));
const FORMAL_API = require(path.join(ROOT, "api", "strategy2-latest.js"));
const REQUIRE_FORMAL = process.argv.includes("--require-formal");

function count(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function clean(value) {
  return String(value ?? "").trim();
}

function rowsFrom(payload) {
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.matches)) return payload.matches;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function dateOf(value) {
  const match = clean(value).match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function minuteOf(value) {
  const match = clean(value).match(/(\d{2}:\d{2})(?::\d{2})?/);
  return match ? match[1] : "";
}

function invoke(handler, request = {}) {
  return new Promise((resolve, reject) => {
    const result = { statusCode: 0, body: null };
    const response = {
      setHeader() {},
      status(value) { result.statusCode = value; return this; },
      json(value) { result.body = value; resolve(result); return this; },
      send(value) { result.body = value; resolve(result); return this; },
      end(value) { result.body = value; resolve(result); return this; },
    };
    Promise.resolve(handler({
      method: "GET",
      headers: { host: "localhost", "x-strategy2-closure": "1" },
      url: "/",
      query: {},
      fumanInternalVerify: true,
      ...request,
    }, response)).catch(reject);
  });
}

function sourceText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assertFormalPayload(payload, today) {
  const formalRows = rowsFrom(payload);
  const formalCount = count(payload?.count ?? payload?.resultCount ?? payload?.total ?? formalRows.length);
  const quality = payload?.run_quality_at_publish && typeof payload.run_quality_at_publish === "object"
    ? payload.run_quality_at_publish
    : {};

  const formalReason = clean(payload?.reason || payload?.detail || payload?.error || payload?.blockedReason || payload?.scanner_block_reason || "unknown");
  assert.equal(payload?.ok, true, "formal Strategy2 API must be ok: " + formalReason);
  assert.equal(dateOf(payload?.usedDate || payload?.tradeDate || payload?.sourceDate), today, "formal Strategy2 date must be today");
  assert.ok(clean(payload?.runId || payload?.transport?.runId), "formal Strategy2 requires a runId");
  assert.equal(payload?.publishAllowed === true || quality.publishAllowed === true, true, "formal Strategy2 must be publishAllowed");
  assert.equal(payload?.latestOverwriteAllowed === true || quality.latestOverwriteAllowed === true, true, "formal Strategy2 must allow latest overwrite");
  assert.equal(clean(payload?.unattendedStatus || payload?.unattended?.status || quality.unattendedStatus), "YES", "formal Strategy2 must be unattended YES");
  assert.equal(payload?.preservePreviousGood === true || quality.preservePreviousGood === true, false, "formal Strategy2 cannot preserve previous good");
  assert.equal(payload?.fallbackUsed === true || quality.fallbackUsed === true, false, "formal Strategy2 cannot use fallback");
  assert.ok(formalCount >= formalRows.length, "formal Strategy2 count cannot be smaller than its returned rows");
  return { runId: clean(payload?.runId || payload?.transport?.runId), count: formalCount, rows: formalRows.length };
}

(async () => {
  assert.ok(fs.existsSync(REPORT_PATH), "Strategy2 diagnostic report must exist");
  const report = JSON.parse(fs.readFileSync(REPORT_PATH, "utf8"));
  const today = DIAGNOSTIC_API.taipeiDate();
  const reportRows = Array.isArray(report?.matches) ? report.matches : [];

  // Stage 1: water -> full scan. The diagnostic chain proves readback, never formal publish.
  assert.equal(report?.ok, true, "water-to-scan report must be successful");
  assert.equal(report?.kind, "validation_backtest", "diagnostic report must remain validation-only");
  assert.equal(report?.formalRun, false, "diagnostic report cannot become a formal run");
  assert.equal(report?.publishAllowed, false, "diagnostic report cannot be published");
  assert.equal(clean(report?.tradeDate), today, "diagnostic report must be today in Taipei");
  assert.ok(clean(report?.runId), "diagnostic report needs a runId");
  assert.ok(count(report?.scannedSymbols) > 0, "full scan needs at least one symbol");
  assert.equal(count(report?.sourceChain?.motherPool?.count), count(report?.scannedSymbols), "mother pool count must equal full scan count");
  assert.equal(count(report?.symbolsWithTodayCandles), count(report?.scannedSymbols), "every scanned symbol needs today 1m evidence");
  assert.equal(reportRows.length, count(report?.matchCount), "full scan record count must be exact");
  assert.ok(reportRows.every((row) => {
    const minute = minuteOf(row?.entryAt);
    return minute >= "09:00" && minute <= "12:00";
  }), "diagnostic records must be in the 09:00-12:00 window");

  // Stage 2: same date, runId and count must reach the shared desktop/mobile API.
  const diagnosticResult = await invoke(DIAGNOSTIC_API);
  assert.equal(diagnosticResult.statusCode, 200, "diagnostic shared API must be readable today");
  const diagnosticPayload = diagnosticResult.body;
  assert.equal(diagnosticPayload?.runId, report.runId, "diagnostic API runId must match the scan");
  assert.equal(diagnosticPayload?.tradeDate, report.tradeDate, "diagnostic API date must match the scan");
  assert.equal(rowsFrom(diagnosticPayload).length, count(report?.matchCount), "diagnostic API must expose every detected record");
  assert.equal(diagnosticPayload?.validationDisplayAllowed, true, "diagnostic API may display only");
  assert.equal(diagnosticPayload?.formalRun, false, "diagnostic API cannot identify as formal");
  assert.equal(diagnosticPayload?.publishAllowed, false, "diagnostic API cannot allow publish");
  assert.ok(clean(diagnosticPayload?.expiresAt), "diagnostic API must expire at Taipei midnight");

  // Stage 3: desktop has latest ten expanded cards plus the entire latest-first history table.
  const desktop = sourceText("terminal-desktop-fast-shell.js");
  assert.ok(desktop.includes("function strategy2LatestCardsHtml"), "desktop needs the dedicated latest-ten card renderer");
  assert.ok(desktop.includes("const latestRows = rows.slice(0, 10);"), "desktop latest card area must be limited to ten records");
  assert.ok(desktop.includes('strategy2RowsHtml(rows, "history")'), "desktop must retain the full chronological history");
  assert.ok(desktop.includes("strategy2-history-table"), "desktop history must remain a table");
  assert.ok(desktop.includes("/api/strategy2-ps1-backtest"), "desktop must read the shared diagnostic endpoint");
  assert.ok(desktop.includes('return minute >= "09:00" && minute <= "12:00";'), "desktop must retain the 09:00-12:00 timeline only");
  assert.ok(desktop.includes("sort(strategy2SortRows)"), "desktop records must be latest-first");

  // Stage 4: authenticated mobile reads that same diagnostic chain only post-close.
  const mobile = sourceText(path.join("api", "mobile-fragment.js"));
  assert.ok(mobile.includes("fetchStrategy2BacktestInternal"), "mobile needs the shared diagnostic reader");
  assert.ok(mobile.includes("shouldUseStrategy2PostcloseValidation"), "mobile must switch post-close only");
  assert.ok(mobile.includes("validationDisplayAllowed"), "mobile must retain the non-formal label");
  assert.ok(mobile.includes("fetchStrategy2Internal"), "mobile needs the Strategy2 routing entrypoint");

  // Stage 5: /88 is formal-only and must not ingest the diagnostic endpoint.
  const scorecard = sourceText(path.join("api", "scorecard.js"));
  const scorecardPage = sourceText("88.html");
  assert.ok(scorecard.includes('"策略2成績單": "/api/strategy2-latest"'), "/88 formal source must be strategy2-latest");
  assert.ok(scorecard.includes("function buildStrategy2SourceReport"), "/88 must record Strategy2 runId, date and count");
  assert.ok(scorecard.includes("publishAllowed"), "/88 source report must enforce publishAllowed");
  assert.ok(scorecard.includes("unattendedStatus"), "/88 source report must enforce unattended status");
  assert.ok(scorecard.includes("preservePreviousGood"), "/88 must expose preserve-previous-good blockers");
  assert.ok(scorecard.includes('cleanText(payload?.qualityStatus) !== "complete"'), "/88 requires a complete scorecard payload");
  assert.ok(!scorecard.includes("strategy2-ps1-backtest"), "/88 must never read diagnostic data");
  assert.ok(!scorecardPage.includes("策略2盤後回測"), "/88 must not render a separate diagnostic scorecard");
  assert.ok(!scorecardPage.includes("loadStrategy2Backtest"), "/88 page must not load diagnostic data");

  let formal = { required: REQUIRE_FORMAL, status: "NOT_RUN", rule: "same_day_complete_runId_count_desktop_mobile_scorecard" };
  if (REQUIRE_FORMAL) {
    const formalResult = await invoke(FORMAL_API, {
      url: "/api/strategy2-latest?canvas=1&compact=1&shell=1&today=1&verify=1",
      query: { canvas: "1", compact: "1", shell: "1", today: "1", verify: "1" },
    });
    assert.equal(formalResult.statusCode, 200, "formal Strategy2 API must be readable");
    formal = { required: true, status: "PASS", ...assertFormalPayload(formalResult.body, today) };
  }

  console.log(JSON.stringify({
    ok: true,
    status: REQUIRE_FORMAL ? "FORMAL_CLOSURE_PASS" : "DIAGNOSTIC_CHAIN_PASS_FORMAL_NOT_RUN",
    contract: "strategy2-water-scan-surface-scorecard-v2",
    tradeDate: report.tradeDate,
    runId: report.runId,
    water: {
      motherPool: count(report?.sourceChain?.motherPool?.count),
      today1mReady: count(report?.symbolsWithTodayCandles),
      quoteRows: count(report?.sourceChain?.quotes?.count),
      fugle1mRows: count(report?.sourceChain?.intraday1m?.count),
    },
    fullScan: {
      scannedSymbols: count(report?.scannedSymbols),
      matchedSymbols: count(report?.matchedSymbols),
      records: count(report?.matchCount),
      dataGapCount: count(report?.dataGapCount),
    },
    desktop: { status: "PASS", latestCards: 10, fullTimeline: count(report?.matchCount) },
    mobile: { status: "PASS", runId: diagnosticPayload.runId, records: rowsFrom(diagnosticPayload).length },
    scorecard88: {
      status: "FORMAL_ONLY",
      endpoint: "/api/strategy2-latest",
      diagnosticBacktestExcluded: true,
      formalRequirements: ["today", "runId", "count", "publishAllowed", "latestOverwriteAllowed", "unattendedStatus=YES", "no_preserve", "no_fallback"],
    },
    formal,
    expiresAt: diagnosticPayload.expiresAt,
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
