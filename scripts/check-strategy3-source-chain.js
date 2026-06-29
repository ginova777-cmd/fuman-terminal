const {
  fetchStrategy3Intraday1mStatus,
  fetchStrategy3LiveSideVolumeMap,
  fetchStrategy3QuoteLatestReady,
  fetchStrategy3QuoteReady,
} = require("../lib/supabase-public-slot");
const {
  chipTradeExclusion,
  loadChipTradeBlacklist,
} = require("../lib/chip-trade-exclusions");
const { fetchStrategy3TvCandles } = require("../lib/strategy3-tv-candles");
const { analyzeTradingViewOvernightEntry } = require("../lib/strategy3-tv-entry");

const MIN_CHANGE_PERCENT = Number(process.env.STRATEGY3_MIN_CHANGE_PERCENT || 3);
const MAX_CHANGE_PERCENT = Number(process.env.STRATEGY3_MAX_CHANGE_PERCENT || 5);
const MIN_VOLUME_RATIO = Number(process.env.STRATEGY3_MIN_VOLUME_RATIO || 1);
const MIN_TRADE_VOLUME_LOTS = Number(process.env.STRATEGY3_MIN_TRADE_VOLUME_LOTS || 0);
const REQUIRE_OUTSIDE_GT_INSIDE = process.env.STRATEGY3_REQUIRE_OUTSIDE_GT_INSIDE !== "0";
const REQUIRE_NEAR_100_HIGH = process.env.STRATEGY3_REQUIRE_NEAR_100_HIGH === "1";

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function candleMinutes(row) {
  const text = String(row?.candleTime || row?.time || "");
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Taipei",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(parsed));
    const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
    return get("hour") * 60 + get("minute");
  }
  const match = text.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function latestDate(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).slice(0, 10)))].sort().at(-1) || "";
}

function passesFieldGate(quote) {
  const pct = cleanNumber(quote.percent);
  const volumeRatio = cleanNumber(quote.volumeRatio || quote.projectedRatio);
  const volumeLots = cleanNumber(quote.tradeVolume) / 1000;
  const outsideVolume = cleanNumber(quote.outsideVolume ?? quote.cumulativeAskVolume);
  const insideVolume = cleanNumber(quote.insideVolume ?? quote.cumulativeBidVolume);
  const outsideInsideDiff = outsideVolume - insideVolume;
  const outsideInsideRatio = insideVolume > 0
    ? outsideVolume / insideVolume
    : (outsideVolume > 0 ? 99 : 0);
  const ok = pct >= MIN_CHANGE_PERCENT
    && pct <= MAX_CHANGE_PERCENT
    && volumeRatio > MIN_VOLUME_RATIO
    && (MIN_TRADE_VOLUME_LOTS <= 0 || volumeLots >= MIN_TRADE_VOLUME_LOTS)
    && (!REQUIRE_OUTSIDE_GT_INSIDE || (outsideVolume > 0 && insideVolume > 0 && outsideVolume > insideVolume));
  return { ok, pct, volumeRatio, volumeLots, outsideVolume, insideVolume, outsideInsideDiff, outsideInsideRatio };
}

function rankCandidates(quotes) {
  return [...quotes]
    .filter((quote) => cleanNumber(quote.close) > 0 && cleanNumber(quote.tradeVolume) > 0)
    .sort((a, b) => {
      const scoreA = cleanNumber(a.tradeValue || a.value) / 1000000
        + cleanNumber(a.tradeVolume) / 100000
        + Math.max(0, cleanNumber(a.percent)) * 8
        + cleanNumber(a.volumeRatio || a.projectedRatio) * 5
        + Math.max(0, cleanNumber(a.outsideVolume) - cleanNumber(a.insideVolume)) / 500
        + Math.max(0, (cleanNumber(a.insideVolume) > 0 ? cleanNumber(a.outsideVolume) / cleanNumber(a.insideVolume) : 0) - 1) * 16;
      const scoreB = cleanNumber(b.tradeValue || b.value) / 1000000
        + cleanNumber(b.tradeVolume) / 100000
        + Math.max(0, cleanNumber(b.percent)) * 8
        + cleanNumber(b.volumeRatio || b.projectedRatio) * 5
        + Math.max(0, cleanNumber(b.outsideVolume) - cleanNumber(b.insideVolume)) / 500
        + Math.max(0, (cleanNumber(b.insideVolume) > 0 ? cleanNumber(b.outsideVolume) / cleanNumber(b.insideVolume) : 0) - 1) * 16;
      return scoreB - scoreA;
    });
}

async function main() {
  const minIntraday1mCandidates = Math.max(1, Number(process.env.STRATEGY3_MIN_INTRADAY_1M_CANDIDATES || 1000));
  const minIntraday1mCandles = Math.max(1, Number(process.env.STRATEGY3_MIN_INTRADAY_1M_CANDLES || 35));
  const tvLimit = Math.max(1, Number(process.env.STRATEGY3_DIAG_TV_LIMIT || 120));
  const quoteReady = await fetchStrategy3QuoteReady({ minQuotes: 500, timeout: 8000 }).catch((error) => ({
    ok: false,
    error: error?.message || String(error),
    quotes: [],
    source: "v_strategy3_quote_ready",
  }));
  const latest = await fetchStrategy3QuoteLatestReady({ minQuotes: 500, timeout: 20000 });
  const status = await fetchStrategy3Intraday1mStatus(latest.quotes.map((quote) => quote.code));
  const side = await fetchStrategy3LiveSideVolumeMap(latest.quotes.map((quote) => quote.code)).catch(() => ({ byCode: new Map(), ok: false }));
  const blacklistCodes = loadChipTradeBlacklist();
  const merged = latest.quotes.map((quote) => {
    const row = status.byCode.get(quote.code) || {};
    const sideRow = side.byCode.get(quote.code) || {};
    const item = {
      ...quote,
      outsideVolume: cleanNumber(sideRow.outsideVolume),
      insideVolume: cleanNumber(sideRow.insideVolume),
      cumulativeAskVolume: cleanNumber(sideRow.cumulativeAskVolume),
      cumulativeBidVolume: cleanNumber(sideRow.cumulativeBidVolume),
      cumulativeBidAskVolume: cleanNumber(sideRow.cumulativeBidAskVolume),
      intradayCandleCount: cleanNumber(row.today_candle_count ?? row.candle_count ?? row.rows_today),
      latestCandleTime: row.latest_candle_time || quote.latestCandleTime || "",
    };
    const exclusion = chipTradeExclusion(item, blacklistCodes);
    return {
      ...item,
      chipExcluded: exclusion.excluded,
      chipExclusionReasons: exclusion.reasons,
    };
  });
  const chipReady = merged.filter((quote) => !quote.chipExcluded);
  const sessionReady = chipReady.filter((quote) => cleanNumber(quote.intradayCandleCount) >= minIntraday1mCandles || quote.latestCandleTime);
  const fieldReady = sessionReady.filter((quote) => passesFieldGate(quote).ok);
  const ranked = rankCandidates(fieldReady).slice(0, tvLimit);
  let tvOk = 0;
  const examples = [];
  for (const quote of ranked) {
    const result = await fetchStrategy3TvCandles(quote.code, 160).catch((error) => ({ error: error?.message || String(error), candles: [], rows: [], quality: {} }));
    const tv = analyzeTradingViewOvernightEntry(result.candles || result.rows || []);
    if (tv.ok) tvOk += 1;
    if (examples.length < 12) {
      examples.push({
        symbol: quote.code,
        name: quote.name,
        close: quote.close,
        percent: quote.percent,
        tradeVolume: quote.tradeVolume,
        tradeVolumeLots: Math.round(cleanNumber(quote.tradeVolume) / 1000),
        volumeRatio: Number(cleanNumber(quote.volumeRatio || quote.projectedRatio).toFixed(2)),
        outsideVolume: cleanNumber(quote.outsideVolume),
        insideVolume: cleanNumber(quote.insideVolume),
        outsideGtInside: cleanNumber(quote.outsideVolume) > cleanNumber(quote.insideVolume),
        outsideInsideDiff: Math.round(cleanNumber(quote.outsideVolume) - cleanNumber(quote.insideVolume)),
        outsideInsideRatio: Number((cleanNumber(quote.insideVolume) > 0 ? cleanNumber(quote.outsideVolume) / cleanNumber(quote.insideVolume) : 0).toFixed(2)),
        latestQuoteDate: String(quote.updatedAt || quote.quoteTimeRaw || "").slice(0, 10),
        intradayCandleCount: quote.intradayCandleCount,
        latestCandleTime: quote.latestCandleTime,
        tvOk: tv.ok,
        tvReason: tv.reason,
        tvControlSource: tv.controlSource,
        tvControlOk: tv.controlOk,
        tvObvOk: tv.obvOk,
        tvCandleSource: result.source || "",
        tvCandleQuality: result.quality || {},
        tvCandleFallbackFrom: result.fallbackFrom || "",
        tvCandleFallbackReason: result.fallbackReason || "",
        tvCandleFallbackError: result.fallbackError || "",
        tvCandleCount: tv.candleCount,
        tvLastCandleTime: tv.lastCandleTime,
      });
    }
  }
  const latestQuoteDate = latestDate(merged.map((quote) => quote.updatedAt || quote.quoteTimeRaw));
  const latestCandleDate = latestDate(merged.map((quote) => quote.latestCandleTime));
  const ready = latest.ok && sessionReady.length >= minIntraday1mCandidates;
  process.stdout.write(`${JSON.stringify({
    ok: true,
    ready,
    source: latest.source,
    quoteReadyView: {
      ok: quoteReady.ok,
      error: quoteReady.error || "",
      rows: quoteReady.quotes?.length || 0,
      source: quoteReady.source,
    },
    latestQuoteRows: latest.quotes.length,
    chipReadyCount: chipReady.length,
    chipExcludedCount: merged.length - chipReady.length,
    latestQuoteDate,
    latestCandleDate,
    sessionReadyCount: sessionReady.length,
    minIntraday1mCandidates,
    minIntraday1mCandles,
    fieldGateReadyCount: fieldReady.length,
    fieldGate: {
      minChangePercent: MIN_CHANGE_PERCENT,
      maxChangePercent: MAX_CHANGE_PERCENT,
      minVolumeRatio: MIN_VOLUME_RATIO,
      minTradeVolumeLots: MIN_TRADE_VOLUME_LOTS,
      requireOutsideGtInside: REQUIRE_OUTSIDE_GT_INSIDE,
      sideVolumeRows: side.byCode.size,
    },
    tvChecked: ranked.length,
    tvOk,
    status: ready ? "ready" : "not_ready",
    reason: ready
      ? `source ready; tvOk=${tvOk}/${ranked.length}`
      : `latest quotes ok=${latest.ok}; session1m=${sessionReady.length}/${minIntraday1mCandidates}`,
    examples,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2)}\n`);
  process.exit(1);
});
