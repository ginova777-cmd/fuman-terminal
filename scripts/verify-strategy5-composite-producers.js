"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const scanner = require(path.join(ROOT, "scripts", "scan-strategy5-cache"));
const strategy5Api = require(path.join(ROOT, "api", "strategy5-latest"));

function tradingDates(count, start = "2026-08-01") {
  const dates = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function dailyRows(count, customize = () => ({})) {
  const dates = tradingDates(count);
  return dates.map((date, index) => ({
    date,
    open: 20 + index * 0.05,
    high: 20.5 + index * 0.05,
    low: 19.5 + index * 0.05,
    close: 20.2 + index * 0.05,
    volume: 1_000_000 + index * 10_000,
    source: "supabase:fixture_daily_ohlcv",
    ...customize(index, date, dates),
  }));
}

function chipHistory(dates, institutionNets, marginBalances) {
  return {
    institutionRows: dates.map((tradeDate, index) => ({
      tradeDate: tradeDate.replace(/-/g, ""),
      totalNet: institutionNets[index],
      foreign: institutionNets[index] * 0.6,
      trust: institutionNets[index] * 0.4,
      dealer: 0,
      source: "fixture:institution",
    })),
    marginRows: dates.map((tradeDate, index) => ({
      tradeDate: tradeDate.replace(/-/g, ""),
      marginBalance: marginBalances[index],
      source: "fixture:margin",
    })),
  };
}

function verifyMarginProducers() {
  const rows = dailyRows(25, (index) => index === 24 ? { open: 21, close: 22, high: 22.3, low: 20.8 } : {});
  const evidenceDates = rows.slice(-2).map((row) => row.date);
  const expectedDate = rows.at(-1).date.replace(/-/g, "");
  const common = { stock: { code: "1111", close: rows.at(-1).close }, valueRank: 80, volumeRank: 70, rows, runMarketDate: expectedDate };

  const up = scanner.buildMarginPriceInstitutionMatch({
    ...common,
    chipHistory: chipHistory(evidenceDates, [1200, 1800], [10000, 10400]),
    direction: "up",
  });
  assert.ok(up, "margin-up fixture must match");
  assert.strictEqual(up.id, "margin_up_price_up_institutional_continuous_buy");
  assert.strictEqual(up.marginBalanceDelta, 400);
  assert.strictEqual(up.institutionalContinuousBuy, true);
  assert.strictEqual(up.compositeStrategy, "strategy5_margin_price_institutional_continuous_buy");

  const down = scanner.buildMarginPriceInstitutionMatch({
    ...common,
    chipHistory: chipHistory(evidenceDates, [1200, 1800], [10400, 10000]),
    direction: "down",
  });
  assert.ok(down, "margin-down fixture must match");
  assert.strictEqual(down.id, "margin_down_price_up_institutional_continuous_buy");
  assert.strictEqual(down.marginBalanceDelta, -400);

  const oneDayOnly = scanner.buildMarginPriceInstitutionMatch({
    ...common,
    chipHistory: chipHistory(evidenceDates, [-50, 1800], [10000, 10400]),
    direction: "up",
  });
  assert.strictEqual(oneDayOnly, null, "one positive institution day must not match");
  const nonFormalRows = rows.map((row) => ({ ...row, source: "yahoo:daily" }));
  assert.strictEqual(scanner.buildMarginPriceInstitutionMatch({
    ...common,
    rows: nonFormalRows,
    chipHistory: chipHistory(evidenceDates, [1200, 1800], [10000, 10400]),
    direction: "up",
  }), null, "non-Supabase daily fallback must not produce a formal composite match");
  return { up, down };
}

function wNecklineRows() {
  return dailyRows(18, (index) => {
    const base = { open: 11.1, high: 11.5, low: 10.8, close: 11.2, volume: 900_000 };
    if (index === 2) return { ...base, low: 9.5, close: 9.9 };
    if (index === 6) return { ...base, high: 12.5, close: 12.1 };
    if (index === 9) return { ...base, low: 9.7, close: 10.1 };
    if (index === 15) return { ...base, open: 12.2, high: 13, low: 12.1, close: 12.8 };
    if (index === 16) return { ...base, open: 12.7, high: 13, low: 12.78, close: 12.9 };
    if (index === 17) return { ...base, open: 12.8, high: 13.2, low: 12.82, close: 13 };
    return base;
  });
}

function verifyWNecklineProducer() {
  const rows = wNecklineRows();
  const expectedDate = rows.at(-1).date.replace(/-/g, "");
  const match = scanner.buildWNecklineRecentRetestMatch({
    stock: { code: "2222", close: rows.at(-1).close },
    valueRank: 70,
    volumeRank: 65,
    rows,
    runMarketDate: expectedDate,
  });
  assert.ok(match, "W neckline fixture must match");
  assert.strictEqual(match.id, "w_neckline_recent_retest_two_day_hold");
  assert.strictEqual(match.formalDailyOhlcv, true);
  assert.strictEqual(match.twoDayHold, true);
  assert.strictEqual(match.necklineSource, "recent_breakout_close_retest");
  assert.strictEqual(match.holdDates.length, 2);
  assert.strictEqual(match.holdLows.length, 2);

  const broken = rows.map((row) => ({ ...row }));
  broken.at(-1).low = 11;
  assert.strictEqual(scanner.buildWNecklineRecentRetestMatch({
    stock: { code: "2222", close: broken.at(-1).close }, valueRank: 70, volumeRank: 65, rows: broken, runMarketDate: expectedDate,
  }), null, "a broken second-day neckline hold must not match");
  assert.strictEqual(scanner.buildWNecklineRecentRetestMatch({
    stock: { code: "2222", close: rows.at(-1).close },
    valueRank: 70,
    volumeRank: 65,
    rows: rows.map((row) => ({ ...row, source: "yahoo:daily" })),
    runMarketDate: expectedDate,
  }), null, "non-Supabase daily fallback must not produce formal W-neckline evidence");
  return match;
}

function wBottomRows() {
  return dailyRows(30, (index) => {
    const base = { open: 11.4, high: 11.9, low: 11.1, close: 11.5, volume: 850_000 };
    if (index === 8) return { ...base, open: 10.4, high: 10.8, low: 10, close: 10.3 };
    if (index === 15) return { ...base, open: 12.4, high: 13, low: 12.2, close: 12.7 };
    if (index === 24) return { ...base, open: 10.6, high: 10.8, low: 10.2, close: 10.4 };
    if (index >= 25 && index <= 27) return { ...base, open: 10.5 + (index - 25) * 0.2, high: 11.4, low: 10.4, close: 10.9 + (index - 25) * 0.15 };
    if (index === 28) return { ...base, open: 11.2, high: 12.4, low: 11.1, close: 12.2 };
    if (index === 29) return { ...base, open: 12, high: 13, low: 11.9, close: 12.8 };
    return base;
  });
}

function verifyWBottomProducer() {
  const rows = wBottomRows();
  const evidenceDates = rows.slice(-2).map((row) => row.date);
  const expectedDate = rows.at(-1).date.replace(/-/g, "");
  const evidence = chipHistory(evidenceDates, [900, 1500], [10000, 10020]);
  const match = scanner.buildWBottomReboundMatch({
    stock: { code: "3333", close: rows.at(-1).close },
    chipHistory: evidence,
    valueRank: 72,
    volumeRank: 68,
    rows,
    runMarketDate: expectedDate,
  });
  assert.ok(match, "W bottom fixture must match");
  assert.strictEqual(match.id, "w_bottom_rebound_ma3_ma5_ma10_institution_two_day_buy");
  assert.strictEqual(match.formalDailyOhlcv, true);
  assert.strictEqual(match.institutionalTwoDayTotalBuy, true);
  assert.strictEqual(match.institutionalBuyDates.length, 2);
  assert.ok(match.ma3First > 0 && match.ma5Second > 0 && match.ma10Second > 0);

  const negativeInstitution = chipHistory(evidenceDates, [900, -10], [10000, 10020]);
  assert.strictEqual(scanner.buildWBottomReboundMatch({
    stock: { code: "3333", close: rows.at(-1).close }, chipHistory: negativeInstitution, valueRank: 72, volumeRank: 68, rows, runMarketDate: expectedDate,
  }), null, "negative second-day institution total must not match");
  return match;
}

function verifyWiring() {
  const scannerSource = fs.readFileSync(path.join(ROOT, "scripts", "scan-strategy5-cache.js"), "utf8");
  const desktopSource = fs.readFileSync(path.join(ROOT, "terminal-desktop-fast-shell.js"), "utf8");
  const ids = [
    "margin_up_price_up_institutional_continuous_buy",
    "margin_down_price_up_institutional_continuous_buy",
    "w_neckline_recent_retest_two_day_hold",
    "w_bottom_rebound_ma3_ma5_ma10_institution_two_day_buy",
  ];
  ids.forEach((id) => {
    assert.ok(scannerSource.includes(`id: \"${id}\"`) || scannerSource.includes(`\"${id}\"`), `${id} must be produced by scanner`);
    assert.ok(desktopSource.includes(id), `${id} must remain visible in Strategy5 UI`);
  });
  assert.ok(scannerSource.includes("strategy5CompositeRules"), "run payload must publish composite rule contract");
  assert.ok(scannerSource.includes("fetchDailyHistory(stock, runMarketDate)"), "daily history lookup must require the Strategy5 run market date");
}

function verifyCompositeSourceGate() {
  const base = {
    strategy5CompositeRules: { contract: "strategy5-composite-producers-v1" },
    sourceHealth: {
      issuedSharesCount: 1600,
      volumeAverageCount: 1600,
      alignedChipHistoryCodeCount: 1600,
    },
    matches: [],
  };
  const ready = scanner.buildStrategy5CorePublishQuality(base);
  assert.strictEqual(ready.ok, true, "aligned two-day chip history coverage must pass");
  const blocked = scanner.buildStrategy5CorePublishQuality({
    ...base,
    sourceHealth: { ...base.sourceHealth, alignedChipHistoryCodeCount: 1499 },
  });
  assert.strictEqual(blocked.ok, false, "low aligned chip history coverage must fail closed");
  assert.ok(blocked.issues.includes("chip_history_coverage_low:1499/1500"));

  const apiRun = {
    run_id: "strategy5-composite-fixture",
    status: "complete",
    complete: true,
    expected_total: 1,
    scanned_count: 1,
    result_count: 1,
    readback_count: 1,
    payload: base,
  };
  assert.strictEqual(strategy5Api._test.strategy5PublishableRunIssue(apiRun, []), "", "API latest gate must accept ready composite source coverage");
  const blockedApiRun = {
    ...apiRun,
    payload: { ...base, sourceHealth: { ...base.sourceHealth, alignedChipHistoryCodeCount: 1499 } },
  };
  assert.strictEqual(
    strategy5Api._test.strategy5PublishableRunIssue(blockedApiRun, []),
    "chip_history_coverage_low:1499/1500",
    "API latest gate must fail closed on low composite source coverage"
  );
}

function main() {
  const margin = verifyMarginProducers();
  const neckline = verifyWNecklineProducer();
  const bottom = verifyWBottomProducer();
  verifyWiring();
  verifyCompositeSourceGate();
  console.log("[strategy5-composite-producers] PASS");
  console.log(JSON.stringify({
    ok: true,
    marginUp: { score: margin.up.score, delta: margin.up.marginBalanceDelta },
    marginDown: { score: margin.down.score, delta: margin.down.marginBalanceDelta },
    wNeckline: { score: neckline.score, neckline: neckline.necklinePrice },
    wBottom: { score: bottom.score, reboundPct: bottom.reboundPct },
  }, null, 2));
}

async function verifySourceReadback(expectedTradeDate) {
  const date = String(expectedTradeDate || "").replace(/\D/g, "").slice(0, 8);
  assert.match(date, /^\d{8}$/, "--source-readback requires YYYYMMDD");
  const map = await scanner.fetchStrategy5ChipHistoryMap(date);
  const buckets = [...map.values()];
  const institutionTwoDayCodes = buckets.filter((row) => (row.institutionRows?.length || 0) >= 2).length;
  const marginTwoDayCodes = buckets.filter((row) => (row.marginRows?.length || 0) >= 2).length;
  const alignedCodes = buckets.filter((row) => {
    const institutionDates = (row.institutionRows || []).slice(-2).map((item) => String(item.tradeDate || ""));
    const marginDates = (row.marginRows || []).slice(-2).map((item) => String(item.tradeDate || ""));
    return institutionDates.length === 2 && institutionDates.join(",") === marginDates.join(",") && institutionDates.at(-1) === date;
  }).length;
  const minimum = Number(process.env.STRATEGY5_MIN_CHIP_HISTORY_COVERAGE || 1500);
  assert.ok(alignedCodes >= minimum, `aligned chip history coverage ${alignedCodes}/${minimum}`);
  const result = { ok: true, expectedTradeDate: date, codes: map.size, institutionTwoDayCodes, marginTwoDayCodes, alignedCodes, minimum };
  console.log("[strategy5-composite-source-readback] PASS");
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  const sourceArg = process.argv.find((item) => item.startsWith("--source-readback="));
  Promise.resolve(sourceArg ? verifySourceReadback(sourceArg.split("=").slice(1).join("=")) : main()).catch((error) => {
    console.error(`[strategy5-composite-producers] FAIL: ${error.stack || error.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = {
  verifyMarginProducers,
  verifyWNecklineProducer,
  verifyWBottomProducer,
  verifyWiring,
  verifyCompositeSourceGate,
  verifySourceReadback,
  main,
};
