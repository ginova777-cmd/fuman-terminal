const {
  fetchStrategy3Intraday1mLatestN,
  fetchStrategy3Intraday1mStatus,
  fetchStrategy3QuoteLatestReady,
  fetchStrategy3QuoteReady,
} = require("../lib/supabase-public-slot");

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

function emaSeries(values, period) {
  const alpha = 2 / (period + 1);
  const out = [];
  values.forEach((value, index) => {
    out[index] = index === 0 ? value : value * alpha + out[index - 1] * (1 - alpha);
  });
  return out;
}

function smaAt(values, index, period) {
  const start = Math.max(0, index - period + 1);
  const slice = values.slice(start, index + 1);
  return slice.reduce((sum, value) => sum + value, 0) / Math.max(slice.length, 1);
}

function analyzeTradingViewOvernightEntry(candles) {
  const rows = (candles || [])
    .map((row) => ({
      ...row,
      open: cleanNumber(row.open),
      high: cleanNumber(row.high),
      low: cleanNumber(row.low),
      close: cleanNumber(row.close),
      volume: cleanNumber(row.volume),
      minutes: candleMinutes(row),
    }))
    .filter((row) => row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0 && row.volume > 0);
  if (rows.length < 35) {
    return { ok: false, reason: `1m candles ${rows.length}/35`, candleCount: rows.length };
  }
  const moneyFlow = rows.map((row) => (row.high - row.low) === 0 ? 0 : ((row.close - row.open) / (row.high - row.low)) * row.volume);
  const mfAvg = emaSeries(moneyFlow, 8);
  const controlLine = mfAvg.map((_, index) => smaAt(mfAvg, index, 2));
  const rawObv = rows.map((row, index) => {
    if (index === 0) return 0;
    if (row.close > rows[index - 1].close) return row.volume;
    if (row.close < rows[index - 1].close) return -row.volume;
    return 0;
  });
  const obvLine = emaSeries(rawObv, 10);
  const lastSessionRows = rows
    .map((row, index) => ({ row, index }))
    .filter((item) => item.row.minutes != null && item.row.minutes >= 13 * 60 && item.row.minutes <= 13 * 60 + 30);
  if (!lastSessionRows.length) {
    return { ok: false, reason: "missing 13:00-13:30 candles", candleCount: rows.length };
  }
  const item = lastSessionRows.at(-1);
  const index = item.index;
  const highest100 = Math.max(...rows.slice(Math.max(0, index - 99), index + 1).map((row) => row.high));
  const isNearHigh = item.row.close >= highest100 * 0.98;
  const currentControl = cleanNumber(controlLine[index]);
  const previousControl = cleanNumber(controlLine[index - 1]);
  const currentObv = cleanNumber(obvLine[index]);
  const controlDirUp = currentControl > previousControl;
  const ok = isNearHigh && currentControl > 0 && controlDirUp && currentObv > 0;
  return {
    ok,
    reason: ok
      ? "tv entry ok"
      : `nearHigh=${isNearHigh}; control=${currentControl.toFixed(2)}; controlDirUp=${controlDirUp}; obv=${currentObv.toFixed(2)}`,
    candleCount: rows.length,
    lastCandleTime: item.row.candleTime || item.row.time || "",
    nearHigh: isNearHigh,
    controlLine: Number(currentControl.toFixed(2)),
    previousControlLine: Number(previousControl.toFixed(2)),
    controlDirUp,
    obvLine: Number(currentObv.toFixed(2)),
  };
}

function latestDate(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).slice(0, 10)))].sort().at(-1) || "";
}

function rankCandidates(quotes) {
  return [...quotes]
    .filter((quote) => cleanNumber(quote.close) > 0 && cleanNumber(quote.tradeVolume) > 0)
    .sort((a, b) => {
      const scoreA = cleanNumber(a.tradeValue || a.value) / 1000000
        + cleanNumber(a.tradeVolume) / 100000
        + Math.max(0, cleanNumber(a.percent)) * 8
        + cleanNumber(a.volumeRatio || a.projectedRatio) * 5;
      const scoreB = cleanNumber(b.tradeValue || b.value) / 1000000
        + cleanNumber(b.tradeVolume) / 100000
        + Math.max(0, cleanNumber(b.percent)) * 8
        + cleanNumber(b.volumeRatio || b.projectedRatio) * 5;
      return scoreB - scoreA;
    });
}

async function main() {
  const minAfter1300 = Math.max(1, Number(process.env.STRATEGY3_MIN_AFTER_1300_CANDIDATES || 20));
  const tvLimit = Math.max(1, Number(process.env.STRATEGY3_DIAG_TV_LIMIT || 120));
  const quoteReady = await fetchStrategy3QuoteReady({ minQuotes: 500, timeout: 8000 }).catch((error) => ({
    ok: false,
    error: error?.message || String(error),
    quotes: [],
    source: "v_strategy3_quote_ready",
  }));
  const latest = await fetchStrategy3QuoteLatestReady({ minQuotes: 500, timeout: 20000 });
  const status = await fetchStrategy3Intraday1mStatus(latest.quotes.map((quote) => quote.code));
  const merged = latest.quotes.map((quote) => {
    const row = status.byCode.get(quote.code) || {};
    return {
      ...quote,
      after1300CandleCount: cleanNumber(row.after_1300_candle_count ?? row.candles_after_1300),
      hasAfter1300Candle: row.has_after_1300_candle === true || cleanNumber(row.after_1300_candle_count) > 0,
      latestCandleTime: row.latest_candle_time || quote.latestCandleTime || "",
    };
  });
  const after1300 = merged.filter((quote) => quote.hasAfter1300Candle || cleanNumber(quote.after1300CandleCount) > 0);
  const ranked = rankCandidates(after1300).slice(0, tvLimit);
  let tvOk = 0;
  const examples = [];
  for (const quote of ranked) {
    const result = await fetchStrategy3Intraday1mLatestN(quote.code, 160).catch((error) => ({ error: error?.message || String(error), candles: [] }));
    const tv = analyzeTradingViewOvernightEntry(result.candles || result.rows || []);
    if (tv.ok) tvOk += 1;
    if (examples.length < 12) {
      examples.push({
        symbol: quote.code,
        name: quote.name,
        close: quote.close,
        percent: quote.percent,
        tradeVolume: quote.tradeVolume,
        latestQuoteDate: String(quote.updatedAt || quote.quoteTimeRaw || "").slice(0, 10),
        after1300CandleCount: quote.after1300CandleCount,
        latestCandleTime: quote.latestCandleTime,
        tvOk: tv.ok,
        tvReason: tv.reason,
        tvCandleCount: tv.candleCount,
        tvLastCandleTime: tv.lastCandleTime,
      });
    }
  }
  const latestQuoteDate = latestDate(merged.map((quote) => quote.updatedAt || quote.quoteTimeRaw));
  const latestCandleDate = latestDate(merged.map((quote) => quote.latestCandleTime));
  const ready = latest.ok && after1300.length >= minAfter1300;
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
    latestQuoteDate,
    latestCandleDate,
    after1300ReadyCount: after1300.length,
    minAfter1300,
    tvChecked: ranked.length,
    tvOk,
    status: ready ? "ready" : "not_ready",
    reason: ready
      ? `source ready; tvOk=${tvOk}/${ranked.length}`
      : `latest quotes ok=${latest.ok}; after1300=${after1300.length}/${minAfter1300}`,
    examples,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2)}\n`);
  process.exit(1);
});
