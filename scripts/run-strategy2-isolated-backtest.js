"use strict";

const fs = require("fs");
const path = require("path");
const { candidateFromWaterRow } = require("../lib/strategy2-v3-signal");
const { upsertSnapshot } = require("../lib/supabase-snapshots");
const { terminalSnapshotPayload } = require("./run-strategy2-v3-live-scan");
const waterReader = require("./run-strategy2-v3-water-scan");

const REPLAY_SNAPSHOT_KEY = "strategy2_live_v3_diagnostic_replay";

function arg(name, fallback = "") {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`));
  return value ? value.slice(name.length + 3) : fallback;
}
function minuteOfDay(value) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const read = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return read("hour") * 60 + read("minute");
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const tradeDate = arg("trade-date", waterReader.taipeiClock().date);
  const output = path.resolve(arg("output", path.join(process.cwd(), "work", `strategy2-isolated-backtest-${tradeDate}.json`)));
  const publishDiagnostic = process.argv.includes("--publish-diagnostic");
  const water = await waterReader.readFormalWater(waterReader.config(), tradeDate);
  const events = [];
  const symbols = [];
  for (const row of water.rows) {
    const allCandles = water.candleBySymbol.get(row.symbol) || [];
    const replayCandles = allCandles.filter((candle) => {
      const minute = minuteOfDay(candle.candle_time);
      return minute >= 540 && minute < 720;
    });
    let evaluated = 0;
    for (let index = 34; index < replayCandles.length; index += 1) {
      const candles = replayCandles.slice(0, index + 1);
      const current = candles.at(-1);
      const previousClose = Number(row.previousClose || 0);
      const replayRow = {
        ...row,
        price: Number(current.close || 0),
        changePercent: previousClose > 0 ? ((Number(current.close) - previousClose) / previousClose) * 100 : 0,
        quoteSeenAt: current.candle_time,
        formalQuoteReady: true,
        formalOneMinuteReady: true,
      };
      const result = candidateFromWaterRow(replayRow, candles, { now: new Date(current.candle_time), tradeDate });
      evaluated += 1;
      for (const hit of result.strategyHits || []) {
        events.push({ symbol: row.symbol, name: row.name, at: current.candle_time, methodId: hit.id, method: hit.label, priority: hit.priority, formalCapableMethod: hit.formalCapable, price: result.price });
      }
    }
    symbols.push({ symbol: row.symbol, candleCount: allCandles.length, replayCandleCount: replayCandles.length, evaluatedMinutes: evaluated, sourceGaps: row.dataGapReason || "" });
  }
  const deduped = [];
  const lastByKey = new Map();
  for (const event of events.sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
    const key = `${event.symbol}|${event.methodId}`;
    const previous = lastByKey.get(key);
    const currentMs = Date.parse(event.at);
    if (previous && currentMs - previous < 20 * 60 * 1000) continue;
    lastByKey.set(key, currentMs);
    deduped.push(event);
  }
  const methodCounts = {};
  for (const event of deduped) methodCounts[event.methodId] = (methodCounts[event.methodId] || 0) + 1;
  const readySymbols = symbols.filter((row) => row.replayCandleCount >= 35);
  const replayCoverageRatio = symbols.length ? Number((readySymbols.length / symbols.length).toFixed(4)) : 0;
  const report = {
    ok: water.poolRows > 0 && water.quoteRows === water.poolRows && replayCoverageRatio >= 0.9
      && water.rows.every((row) => row.canonicalRunMatches) && water.ancillaryIssues.length === 0,
    contract: "strategy2-isolated-backtest-v1",
    strategy: "strategy2",
    tradeDate,
    mode: "isolated_read_only_method_replay",
    formalCandidate: false,
    publishAllowed: false,
    writes: { supabase: false, productionRuntime: false, latest: false, schedules: false },
    caveat: "Replays Strategy2 methods only. It does not invent historical Gate A and cannot be used as a formal candidate receipt.",
    source: {
      motherPool: "fugle_daytrade_priority_pool",
      quote: "fugle_daytrade_quotes_live",
      intraday1m: "fugle_daytrade_intraday_1m",
      poolRows: water.poolRows,
      quoteRows: water.quoteRows,
      candleRows: water.candleRows,
      expectedCanonicalRunId: water.expectedCanonicalRunId,
      canonicalIdentityMatches: water.rows.every((row) => row.canonicalRunMatches),
      ancillaryIssues: water.ancillaryIssues,
    },
    coverage: {
      symbols: symbols.length,
      grade: replayCoverageRatio >= 0.9 ? "A" : replayCoverageRatio >= 0.7 ? "B" : "C",
      symbolsReady35: readySymbols.length,
      ratio: replayCoverageRatio,
      dataGapSymbols: symbols.filter((row) => row.replayCandleCount < 35),
    },
    evaluatedMinutes: symbols.reduce((sum, row) => sum + row.evaluatedMinutes, 0),
    rawMethodHits: events.length,
    cooldownDedupedHits: deduped.length,
    methodCounts,
    events: deduped,
    symbols,
    generatedAt: new Date().toISOString(),
  };
  const runId = `strategy2-v3-live-${tradeDate.replace(/\D/g, "")}-diagnostic-backtest`;
  const replayRows = deduped.map((event) => ({
    code: event.symbol, symbol: event.symbol, name: event.name, entryAt: event.at, timestamp: event.at,
    entryCandleTime: event.at, entryTradeDate: tradeDate, entryPrice: event.price, price: event.price,
    score: event.priority, strategy: event.method, signalId: event.methodId,
    signalLine: "策略2隔離回測方法命中", reason: "隔離回測；非正式候選",
    state: "回測條件命中，非正式候選", stateId: "watch", stateLabel: "回測觀察",
    formalCandidate: false, FormalEntry: false, observation: true,
    scanMode: "strategy2_v3_diagnostic_replay", eventOrigin: "strategy2_v3_diagnostic_replay",
    observationKind: "strategy2_v3_diagnostic_replay",
  }));
  const replayPayload = {
    ok: true, strategy: "strategy2", version: "v3", strategyContract: "strategy2-live-v3",
    waterContract: waterReader.CONTRACT, runId, dataDate: tradeDate, date: tradeDate, tradeDate,
    updatedAt: report.generatedAt, trigger: "isolated_read_only_method_replay", status: "diagnostic_replay",
    complete: false, qualityStatus: "diagnostic_replay", unattendedStatus: "NO",
    formalDisplayAllowed: false, publishAllowed: false, latestOverwriteAllowed: false,
    preservePreviousGood: false, fallbackUsed: false, reason: "strategy2_isolated_backtest_visible_not_formal",
    expectedCount: water.poolRows, scannedCount: symbols.length, resultCount: replayRows.length, count: replayRows.length,
    readbackCount: replayRows.length, dataGapCount: symbols.length - readySymbols.length,
    currentCandidates: replayRows, records: replayRows, diagnosticReplay: true, replayDisplayAllowed: report.ok,
    replayReferenceAt: replayRows.at(-1)?.entryAt || "", displayBlockReason: "策略2隔離回測：非正式、不發布、不寫入 /88 績效",
    sourceCoverage: { ...report.source, coverageGrade: report.coverage.grade, replayCoverageRatio },
    transport: { source: "strategy2-isolated-backtest", snapshotKey: REPLAY_SNAPSHOT_KEY, runId },
  };
  report.replay = { runId, snapshotKey: REPLAY_SNAPSHOT_KEY, published: false };
  if (publishDiagnostic) {
    const snapshot = await upsertSnapshot(REPLAY_SNAPSHOT_KEY, terminalSnapshotPayload(replayPayload), {
      tradeDate: tradeDate.replace(/\D/g, ""), snapshotId: runId,
      source: "strategy2-isolated-backtest-diagnostic", reason: replayPayload.reason, timeoutMs: 20000,
    });
    if (snapshot.ok !== true) throw new Error(`strategy2_diagnostic_snapshot_write_failed:${snapshot.reason || "unknown"}`);
    report.replay = { runId, snapshotKey: REPLAY_SNAPSHOT_KEY, published: true, snapshot };
  }
  writeJson(output, report);
  console.log(JSON.stringify({ ok: report.ok, tradeDate, runId, diagnosticPublished: report.replay.published, poolRows: report.source.poolRows, quoteRows: report.source.quoteRows, candleRows: report.source.candleRows, ready35: report.coverage.symbolsReady35, evaluatedMinutes: report.evaluatedMinutes, hits: report.cooldownDedupedHits, methodCounts, output }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
