"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { upsertSnapshot } = require("../lib/supabase-snapshots");
const { isTwseTradingDay } = require("./twse-trading-day");
const { CONTRACT: WATER_CONTRACT, taipeiClock, readFormalWater } = require("./run-strategy2-v3-water-scan");
const { candidateFromWaterRow } = require("../lib/strategy2-v3-signal");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const DATA_DIR = path.join(RUNTIME_DIR, "data");
const SNAPSHOT_KEY = "strategy2_live_v3";
const REPLAY_SNAPSHOT_KEY = "strategy2_live_v3_diagnostic_replay";
const CONTRACT = "strategy2-live-v3-fugle-deep-scan-1m";
const HISTORY_FILE = path.join(DATA_DIR, "strategy2-v3", "live-history.json");

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function eventKey(row) {
  const minute = String(row.entryCandleTime || row.entryAt || "").slice(0, 16);
  return `${row.code}|${row.signalId}|${minute}`;
}

function appendTodayEvents(previous, current, tradeDate) {
  const seen = new Map();
  for (const row of Array.isArray(previous?.events) ? previous.events : []) {
    if (row?.entryTradeDate === tradeDate) seen.set(eventKey(row), row);
  }
  for (const row of current) seen.set(eventKey(row), row);
  return [...seen.values()]
    .sort((left, right) => String(right.entryAt || "").localeCompare(String(left.entryAt || "")))
    .slice(0, 1000);
}

function replayReferenceTime(water, fallbackNow) {
  const latestCandle = [...(water?.candleBySymbol?.values?.() || [])]
    .flat()
    .map((row) => Date.parse(String(row?.candle_time || "")))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];
  return Number.isFinite(latestCandle) ? new Date(latestCandle) : fallbackNow;
}

function diagnosticReplayRow(row) {
  return {
    ...row,
    formalCandidate: false,
    scanMode: "strategy2_v3_diagnostic_replay",
    eventOrigin: "strategy2_v3_diagnostic_replay",
    observationKind: "strategy2_v3_diagnostic_replay",
    state: row.formalCandidate === true ? "回測條件命中，非正式候選" : "回測資料完整，未達正式訊號",
    stateId: "watch",
    stateLabel: row.formalCandidate === true ? "回測條件命中" : "回測觀察",
  };
}

function compactTerminalRow(row = {}) {
  return {
    c: row.code || row.symbol || "", n: row.name || "", t: row.entryAt || row.timestamp || "",
    p: row.entryPrice ?? row.price ?? null, x: row.pct || "", s: row.score ?? null,
    l: row.signalLine || "", r: row.reason || "", u: row.supportPrice ?? null,
    k: row.stopLoss ?? null, o: row.targetPrice ?? null, a: row.entryTradeDate || "",
    m: row.candleCount ?? null, v: row.volumeRatio1m ?? null, f: row.formalCandidate === true,
    sm: row.scanMode || "",
  };
}

function encodeTerminalRows(rows = []) {
  return zlib.gzipSync(Buffer.from(JSON.stringify(rows.map(compactTerminalRow)), "utf8")).toString("base64");
}
function terminalSnapshotPayload(payload = {}) {
  const records = Array.isArray(payload.records) ? payload.records : [];
  const currentCandidates = Array.isArray(payload.currentCandidates) ? payload.currentCandidates : [];
  const recordsGzip = encodeTerminalRows(records);
  const currentCandidatesGzip = encodeTerminalRows(currentCandidates);
  return {
    ok: payload.ok, strategy: payload.strategy, version: payload.version, strategyContract: payload.strategyContract,
    waterContract: payload.waterContract, runId: payload.runId, dataDate: payload.dataDate, date: payload.date,
    tradeDate: payload.tradeDate, updatedAt: payload.updatedAt, trigger: payload.trigger, status: payload.status,
    complete: payload.complete, qualityStatus: payload.qualityStatus, unattendedStatus: payload.unattendedStatus,
    formalDisplayAllowed: payload.formalDisplayAllowed, publishAllowed: payload.publishAllowed,
    latestOverwriteAllowed: payload.latestOverwriteAllowed, preservePreviousGood: false, fallbackUsed: false,
    reason: payload.reason, expectedCount: payload.expectedCount, scannedCount: payload.scannedCount,
    resultCount: payload.resultCount, count: payload.count, readbackCount: payload.readbackCount,
    dataGapCount: payload.dataGapCount, snapshotRecordCount: records.length, snapshotCandidateCount: currentCandidates.length,
    recordsGzip, currentCandidatesGzip, recordsEncoding: "gzip-base64-json-v1", diagnosticReplay: payload.diagnosticReplay,
    replayDisplayAllowed: payload.replayDisplayAllowed, replayReferenceAt: payload.replayReferenceAt,
    displayBlockReason: payload.displayBlockReason, sourceCoverage: payload.sourceCoverage,
    tradingDay: payload.tradingDay, liveWindow: payload.liveWindow, transport: payload.transport,
    snapshotContract: "strategy2-v3-terminal-compact-snapshot-v2",
  };
}

async function main() {
  const now = new Date();
  const clock = taipeiClock(now);
  const diagnostic = process.argv.includes("--diagnostic");
  const displayReplay = process.argv.includes("--display-replay");
  if (displayReplay && !diagnostic) throw new Error("strategy2_v3_display_replay_requires_diagnostic");
  const trigger = process.argv.includes("--source-event") ? "fugle_writer_success" : displayReplay ? "diagnostic_display_replay" : diagnostic ? "diagnostic" : "manual";
  const liveWindow = clock.minuteOfDay >= 9 * 60 && clock.minuteOfDay <= 12 * 60;
  const tradingDay = await isTwseTradingDay(now, { stateDir: path.join(RUNTIME_DIR, "state") });
  const water = await readFormalWater(require("./run-strategy2-v3-water-scan").config(), clock.date);
  const evaluationNow = displayReplay ? replayReferenceTime(water, now) : now;
  const evaluations = water.rows.map((row) => candidateFromWaterRow(
    row,
    water.candleBySymbol.get(String(row.symbol || "")) || [],
    { now: evaluationNow, tradeDate: clock.date },
  ));
  const candidates = evaluations.filter((row) => row.formalCandidate === true)
    .sort((left, right) => right.score - left.score || String(right.entryAt).localeCompare(String(left.entryAt)));
  const dataGaps = evaluations.filter((row) => row.hardGate?.complete !== true);
  const websocketFormalReady = water.websocket?.formalReady === true;
  const complete = websocketFormalReady && water.rows.length > 0 && dataGaps.length === 0;
  const allowed = tradingDay.isTradingDay === true && liveWindow && complete;
  const runId = `strategy2-v3-live-${clock.ymd}-${String(clock.hour).padStart(2, "0")}${String(clock.minute).padStart(2, "0")}${String(clock.second).padStart(2, "0")}`;
  const previous = readJson(HISTORY_FILE, {});
  const events = displayReplay ? [] : appendTodayEvents(previous, candidates, clock.date);
  const replayRows = displayReplay ? evaluations.map(diagnosticReplayRow) : [];
  const displayRows = displayReplay ? replayRows : events;
  const replayWaterAvailable = displayReplay && replayRows.length > 0
    && replayRows.every((row) => row.entryTradeDate === clock.date && row.entryPrice > 0 && row.candleCount >= 35);
  const payload = {
    ok: complete,
    strategy: "strategy2",
    version: "v3",
    strategyContract: CONTRACT,
    waterContract: WATER_CONTRACT,
    runId,
    dataDate: clock.date,
    date: clock.date,
    tradeDate: clock.date,
    updatedAt: now.toISOString(),
    trigger,
    status: displayReplay ? "diagnostic_replay" : diagnostic ? "diagnostic" : allowed ? "complete" : "blocked",
    complete,
    qualityStatus: displayReplay ? "diagnostic" : complete ? "complete" : "blocked",
    unattendedStatus: displayReplay ? "NO" : complete ? "YES" : "NO",
    formalDisplayAllowed: allowed,
    publishAllowed: allowed,
    latestOverwriteAllowed: allowed,
    preservePreviousGood: false,
    fallbackUsed: false,
    reason: displayReplay ? "strategy2_v3_diagnostic_replay_visible_not_formal" : diagnostic ? "strategy2_v3_diagnostic_only" : allowed ? "strategy2_v3_live_complete" : tradingDay.isTradingDay !== true ? "market_closed_no_v3_publish" : !liveWindow ? "outside_strategy2_v3_live_window" : !websocketFormalReady ? (water.websocket?.reason || "fugle_websocket_not_formal_ready") : "strategy2_v3_formal_water_incomplete",
    expectedCount: water.rows.length,
    scannedCount: water.rows.length,
    resultCount: candidates.length,
    count: candidates.length,
    readbackCount: candidates.length,
    dataGapCount: dataGaps.length,
    currentCandidates: candidates,
    observations: evaluations,
    events: displayRows,
    records: displayRows,
    rows: displayRows,
    matches: displayRows,
    diagnosticReplay: displayReplay,
    replayDisplayAllowed: replayWaterAvailable,
    replayReferenceAt: displayReplay ? evaluationNow.toISOString() : "",
    displayBlockReason: displayReplay ? "V3 回測驗證：非正式候選、不發布、不寫入 /88" : "",
    sourceCoverage: {
      motherPool: "fugle_daytrade_priority_pool",
      quote: "fugle_daytrade_websocket_cache",
      intraday1m: "fugle_daytrade_websocket_cache",
      formalDeepScanPoolRows: water.poolRows,
      formalDeepScanQuoteRows: water.quoteRows,
      formalIntradayOneMinuteRows: water.candleRows,
      formalIntradayOneMinuteReadySymbols: water.rows.length - dataGaps.length,
      websocket: water.websocket,
      websocketFormalReady,
      noLegacyReadbackViews: true,
      noTop40Gate: true,
      noPreviousGoodFallback: true,
    },
    tradingDay: { isTradingDay: tradingDay.isTradingDay === true, reason: tradingDay.reason || "" },
    liveWindow,
    transport: { source: "strategy2-v3-live-scan", snapshotKey: displayReplay ? REPLAY_SNAPSHOT_KEY : SNAPSHOT_KEY, runId, via: "run-strategy2-v3-live-scan.js" },
  };

  if (!displayReplay) writeJson(HISTORY_FILE, { dataDate: clock.date, updatedAt: payload.updatedAt, events });
  writeJson(path.join(DATA_DIR, "strategy2-v3", displayReplay ? "latest-replay.json" : "latest-live.json"), payload);
  const snapshotPayload = terminalSnapshotPayload(payload);
  const snapshot = displayReplay
    ? await upsertSnapshot(REPLAY_SNAPSHOT_KEY, snapshotPayload, {
      tradeDate: clock.ymd,
      snapshotId: runId,
      source: "strategy2-v3-diagnostic-replay",
      reason: "strategy2-v3-diagnostic-replay-visible-not-formal",
      timeoutMs: 20000,
    })
    : diagnostic || !allowed
      ? { ok: true, skipped: true, reason: payload.reason }
      : await upsertSnapshot(SNAPSHOT_KEY, snapshotPayload, {
        tradeDate: clock.ymd,
        snapshotId: runId,
        source: "strategy2-v3-live-scan",
        reason: "strategy2-v3-live-complete",
        timeoutMs: 20000,
      });
  const receipt = {
    strategy: "strategy2", version: "v3", strategyContract: CONTRACT, waterContract: WATER_CONTRACT,
    runId, dataDate: clock.date, date: clock.date, tradeDate: clock.date, trigger,
    status: payload.status, complete, qualityStatus: payload.qualityStatus, unattendedStatus: payload.unattendedStatus,
    formalDisplayAllowed: payload.formalDisplayAllowed, publishAllowed: allowed, latestOverwriteAllowed: payload.latestOverwriteAllowed,
    fallbackUsed: false, preservePreviousGood: false,
    expectedCount: payload.expectedCount, scannedCount: payload.scannedCount, resultCount: payload.resultCount,
    dataGapCount: payload.dataGapCount, sourceCoverage: payload.sourceCoverage, snapshot, snapshotContract: snapshotPayload.snapshotContract, snapshotBytes: Buffer.byteLength(JSON.stringify(snapshotPayload)), reason: payload.reason,
    diagnosticReplay: displayReplay, replayDisplayAllowed: payload.replayDisplayAllowed, replayReferenceAt: payload.replayReferenceAt,
    startedAt: now.toISOString(), finishedAt: new Date().toISOString(),
  };
  writeJson(path.join(DATA_DIR, "scan-receipts", displayReplay ? "strategy2-v3-replay.json" : "strategy2-v3-live.json"), receipt);
  if (snapshot.ok === false) throw new Error(`strategy2_v3_snapshot_write_failed:${snapshot.error || snapshot.reason || "unknown"}`);
  console.log(JSON.stringify({ ok: true, runId, status: payload.status, expectedCount: payload.expectedCount, scannedCount: payload.scannedCount, resultCount: payload.resultCount, dataGapCount: payload.dataGapCount, snapshot }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, strategy: "strategy2", version: "v3", reason: error?.message || String(error) }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  compactTerminalRow,
  terminalSnapshotPayload,
};


