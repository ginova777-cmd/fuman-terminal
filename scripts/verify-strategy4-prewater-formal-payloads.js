"use strict";

const { attachRunTimeSourceEvidence } = require("../lib/run-time-source-snapshot-contract");
const strategy4Api = require("../api/strategy4-latest");
const {
  buildSupabaseRunRow,
  buildSupabaseScanRows,
} = require("./scan-strategy4-cache");
const { verify } = require("./verify-strategy4-prewater-fixture");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSourceCoverage() {
  return {
    ok: true,
    ready: true,
    status: "ready",
    fresh_quote_coverage_120s: 0.96,
    quote_age_seconds: 30,
    intraday_1m_ok: true,
    intraday_1m_status: "ready",
    today_1m_symbols: 1583,
    ready_ge_35: 1583,
    intraday_1m_stale_seconds: 60,
    ma_status: "ready",
    ready_ma20_continuous: 1583,
    ready_ma35_continuous: 1583,
    preopenOk: true,
    preopenRows: 1000,
    preopenCoverage: 1,
    futoptReady: 1,
    dailyVolumeOk: true,
    dailyVolumeFreshness: "fresh",
  };
}

function baseMatch(code, rank) {
  return {
    code,
    name: `S${code}`,
    market: "TSE",
    rank,
    close: 50 + rank,
    price: 50 + rank,
    percent: 2.1,
    volume: 5000 + rank,
    value: 250000,
    swingScore: 88 - rank,
    score: 88 - rank,
    swingZone: rank % 3 === 0 ? "C" : rank % 2 === 0 ? "B" : "A",
    swingZoneLabel: "A",
    reason: "formal Strategy4 business signal",
    date: "2026-07-04",
    usedDate: "2026-07-04",
    priceSource: "official-daily-k",
    signals: [{ id: "wallet_strong_buy", title: "wallet strong buy", reason: "sample" }],
    wallet: {
      mf: 1,
      controlLine: 1,
      obvLine: 1,
      volumeMa5: 1,
      volumeMa20: 1,
      volumeMa60: 1,
      isGray: false,
      isStrongMove: true,
      isDangerZone: false,
      syncScore: 1,
      strongBuy: true,
      volumeCrossUp: true,
      strongSell: false,
    },
    mutakiV17: {
      ma5: 1,
      ma10: 1,
      ma20: 1,
      ma60: 1,
      ma120: 1,
      ma240: 1,
      ema21: 1,
      ema21Up: true,
      ma20Heavy: false,
      fib382: 1,
      fib500: 1,
      fib618: 1,
      fibRatio: 1,
      bias20: 1,
      rsi14: 55,
      atr14: 1,
      entryPrice: 51,
      stopPrice: 48,
      targetPrice: 58,
      riskReward: 2,
      trendConfirmed: true,
      isBullTrend: true,
      isRealBody: true,
      isDeepFall: false,
      isGapUp: false,
      isRunawayUp: false,
      isBreakawayUp: false,
    },
  };
}

function buildFormalOutput(overrides = {}) {
  const sourceCoverage = baseSourceCoverage();
  return {
    ok: true,
    strategy: "strategy4",
    runId: "strategy4-formal-prewater-20260704",
    schemaVersion: "strategy4-cache-v3-unit-contract",
    volumeUnit: "lots",
    source: "github-actions",
    dataContractSource: "supabase:stock_daily_volume",
    priceSource: "official-daily-k",
    fallbackUsed: false,
    fallbackScope: [],
    fallbackAllowed: false,
    fallbackDetails: [],
    fallbackContract: "strategy4-fallback-disclosure-v1",
    evidenceStatus: "complete",
    unattendedStatus: "YES",
    publishAllowed: true,
    latestWriteAttempted: true,
    latestPointerUpdated: true,
    blockedReceiptWritten: false,
    previousGoodRunId: "",
    previousGoodPreserved: false,
    generatedAt: "2026-07-04T01:00:00.000Z",
    updatedAt: "2026-07-04T01:00:00.000Z",
    scanStamp: "20260704",
    fullScan: true,
    runMode: "fixture-formal",
    complete: true,
    qualityStatus: "complete",
    sourceCoverage,
    supabaseCoverage: {
      ok: true,
      phase: "complete",
      qualityStatus: "complete",
      coverageRatio: 1,
      remainingMiss: 0,
      insufficientHistoryCount: 0,
      computableUniverse: 1583,
      universe: 1583,
    },
    supabasePublishGate: {
      ok: true,
      status: "ready",
      strategy: "strategy4",
      publishAllowed: true,
      retentionOk: true,
      sourceCoverage,
      issues: [],
      warnings: [],
      writePolicy: {
        allowLatestWrite: true,
        allowCompleteRunWrite: true,
        preservePreviousCompleteRun: false,
        reason: "formal sample publish allowed",
      },
    },
    prePublishSelfTest: { ok: true, issues: [] },
    publishedSelfTest: { ok: true, issues: [] },
    total: 1583,
    scannedCount: 1583,
    count: 12,
    noDataCount: 0,
    errorCount: 0,
    executionRate: 1,
    coverageRatio: 1,
    sourceUniverseTotal: 1583,
    computableUniverseTotal: 1583,
    insufficientHistoryCount: 0,
    insufficientHistory: [],
    sourceWarnings: [],
    yahooSourceCount: 0,
    yahooSourceRatio: 0,
    misSourceCount: 0,
    misSourceRatio: 0,
    dataSourceCounts: { "supabase:stock_daily_volume": 1583 },
    zones: { A: 4, B: 4, C: 4 },
    matches: Array.from({ length: 12 }, (_, index) => baseMatch(String(2301 + index), index + 1)),
    ...overrides,
  };
}

function formalPayloads(output = buildFormalOutput()) {
  const artifacts = formalArtifacts(output);
  return {
    "writer-run-payload": artifacts.writerRunRow.payload,
    "scanner-run-payload": artifacts.writerRunRow.payload,
    "api-latest-payload": artifacts.apiPayload,
  };
}

function formalArtifacts(output = buildFormalOutput()) {
  const runId = "strategy4-formal-prewater-20260704";
  const writerRunRow = buildSupabaseRunRow(output, runId);
  const scannerRows = buildSupabaseScanRows(output, "full", runId, true);
  const apiPayload = attachRunTimeSourceEvidence(
    strategy4Api.buildPayload(scannerRows, output.total, writerRunRow, { canvas: false }),
    { strategy: "strategy4", endpoint: "api/strategy4-latest" }
  );
  const blockedOutput = buildFormalOutput({
    complete: false,
    qualityStatus: "incomplete",
    evidenceStatus: "insufficient",
    unattendedStatus: "NO",
    publishAllowed: false,
    latestWriteAttempted: false,
    latestPointerUpdated: false,
    blockedReceiptWritten: true,
    previousGoodRunId: runId,
    previousGoodPreserved: true,
    blockedReason: "formal blocked sample",
    scanner_block_reason: "formal blocked sample",
    count: 0,
    matches: [],
    supabasePublishGate: {
      ...output.supabasePublishGate,
      ok: false,
      status: "blocked",
      publishAllowed: false,
      issues: [{ id: "source-not-ready", message: "formal blocked sample" }],
      writePolicy: {
        allowLatestWrite: false,
        allowCompleteRunWrite: false,
        preservePreviousCompleteRun: true,
        reason: "formal blocked sample",
      },
    },
  });
  const degradedOutput = buildFormalOutput({
    qualityStatus: "degraded",
    evidenceStatus: "insufficient",
    unattendedStatus: "NO",
    publishAllowed: false,
    latestWriteAttempted: false,
    latestPointerUpdated: false,
    blockedReceiptWritten: true,
    previousGoodRunId: runId,
    previousGoodPreserved: true,
    blockedReason: "formal degraded sample",
    scanner_block_reason: "formal degraded sample",
    supabasePublishGate: {
      ...output.supabasePublishGate,
      ok: false,
      status: "degraded",
      publishAllowed: false,
      issues: [{ id: "fallback-used", message: "formal degraded sample" }],
      writePolicy: {
        allowLatestWrite: false,
        allowCompleteRunWrite: false,
        preservePreviousCompleteRun: true,
        reason: "formal degraded sample",
      },
    },
  });
  return {
    scannerOutput: output,
    writerRunRow,
    resultRows: scannerRows,
    apiPayload,
    blockedReceiptPayload: buildSupabaseRunRow(blockedOutput, `${runId}-blocked`).payload,
    degradedReceiptPayload: buildSupabaseRunRow(degradedOutput, `${runId}-degraded`).payload,
  };
}

function expectPass(label, payload) {
  const result = verify(label, payload);
  if (!result.ok) throw new Error(`${label} expected PASS: ${result.issues.join("; ")}`);
  return result;
}

function expectFail(label, payload, reason) {
  const result = verify(label, payload);
  if (result.ok) throw new Error(`${label} expected FAIL for ${reason}`);
  return result;
}

function mutate(payload, fn) {
  const next = clone(payload);
  fn(next);
  return next;
}

function runMutations(label, payload) {
  return [
    expectFail(`${label}:missing-source-snapshot`, mutate(payload, (item) => { delete item.source_snapshot_captured_at; }), "missing source_snapshot_captured_at"),
    expectFail(`${label}:source-not-ready-writes-latest`, mutate(payload, (item) => {
      item.source_status_at_run.ok = false;
      item.writeBudget.allowLatestWrite = true;
      item.latestWriteAttempted = true;
    }), "source not ready but latest write allowed"),
    expectFail(`${label}:empty-overwrites-previous-good`, mutate(payload, (item) => {
      item.emptyResult = true;
      item.writeBudget.allowLatestWrite = true;
      item.latestWriteAttempted = true;
    }), "empty result overwrites previous good"),
    expectFail(`${label}:fallback-display-only`, mutate(payload, (item) => {
      item.fallbackUsed = true;
      item.fallbackScope = [];
      item.fallbackDetails = [];
      item.run_quality_at_publish.fallbackUsed = true;
      item.run_quality_at_publish.fallbackScope = [];
      item.run_quality_at_publish.fallbackDetails = [];
    }), "fallback display-only"),
    expectFail(`${label}:missing-evidence-status`, mutate(payload, (item) => { delete item.evidenceStatus; }), "missing evidenceStatus"),
    expectFail(`${label}:fake-unattended-yes`, mutate(payload, (item) => {
      item.source_status_at_run.ok = false;
      item.unattendedStatus = "YES";
    }), "fake unattended YES"),
  ];
}

function main() {
  const payloads = formalPayloads();
  const pass = Object.entries(payloads).map(([label, payload]) => expectPass(label, payload));
  const mutationResults = Object.entries(payloads).flatMap(([label, payload]) => runMutations(label, payload));
  console.log(JSON.stringify({
    ok: true,
    formalPayloads: pass,
    mutationCount: mutationResults.length,
    mutationResults,
  }, null, 2));
}

if (require.main === module) main();

module.exports = {
  buildFormalOutput,
  formalArtifacts,
  formalPayloads,
  runMutations,
};
