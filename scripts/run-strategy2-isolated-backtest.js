"use strict";

const fs = require("fs");
const path = require("path");
const { candidateFromWaterRow } = require("../lib/strategy2-v3-signal");
const waterReader = require("./run-strategy2-v3-water-scan");

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
  writeJson(output, report);
  console.log(JSON.stringify({ ok: report.ok, tradeDate, poolRows: report.source.poolRows, quoteRows: report.source.quoteRows, candleRows: report.source.candleRows, ready35: report.coverage.symbolsReady35, evaluatedMinutes: report.evaluatedMinutes, hits: report.cooldownDedupedHits, methodCounts, output }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
