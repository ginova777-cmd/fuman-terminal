const cache = new Map();
const CACHE_MS = 30 * 60 * 1000;
let tpexDailyCache = null;
const { fetchMisQuotes, mergeMisQuoteIntoHistory } = require("../lib/mis-quotes");

async function fetchText(url, options = {}, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminal/1.0)",
        Accept: "application/json, text/plain, */*",
        Referer: "https://www.twse.com.tw/",
        ...(options.headers || {}),
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function cleanNumber(value) {
  if (value === undefined || value === null || value === "" || value === "--") return 0;
  return Number(String(value).replace(/[,+%]/g, "").replace(/^X/i, "").trim()) || 0;
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function rocToIso(value) {
  const parts = String(value || "").split("/");
  if (parts.length !== 3) return "";
  const year = Number(parts[0]) + 1911;
  return `${year}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
}

function yyyymmddToIso(value) {
  const text = String(value || "");
  if (!/^\d{8}$/.test(text)) return "";
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function monthStarts(count = 12) {
  const dates = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    dates.push({
      twse: `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}01`,
      tpex: `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/01`,
    });
  }
  return dates;
}

function normalizeTwseRows(payload) {
  if (!Array.isArray(payload?.data)) return [];
  return payload.data.map((row) => ({
    date: rocToIso(row[0]),
    volume: cleanNumber(row[1]),
    value: cleanNumber(row[2]),
    open: cleanNumber(row[3]),
    high: cleanNumber(row[4]),
    low: cleanNumber(row[5]),
    close: cleanNumber(row[6]),
    change: cleanNumber(row[7]),
  })).filter((row) => row.date && row.close);
}

function normalizeTpexRows(payload) {
  const table = Array.isArray(payload?.tables) ? payload.tables[0] : null;
  if (!Array.isArray(table?.data)) return [];
  return table.data.map((row) => ({
    date: rocToIso(row[0]),
    volume: cleanNumber(row[1]),
    value: cleanNumber(row[2]) * 1000,
    open: cleanNumber(row[3]),
    high: cleanNumber(row[4]),
    low: cleanNumber(row[5]),
    close: cleanNumber(row[6]),
    change: cleanNumber(row[7]),
  })).filter((row) => row.date && row.close);
}

function normalizeTpexDailyRow(row, date) {
  if (!Array.isArray(row)) return null;
  const close = cleanNumber(row[2]);
  if (!close) return null;
  const change = cleanNumber(row[3]);
  return {
    date,
    volume: cleanNumber(row[8]) / 1000,
    value: cleanNumber(row[9]),
    open: cleanNumber(row[4]),
    high: cleanNumber(row[5]),
    low: cleanNumber(row[6]),
    close,
    change,
  };
}

async function fetchTpexDailyQuotes() {
  if (tpexDailyCache && Date.now() - tpexDailyCache.ts < CACHE_MS) return tpexDailyCache.value;
  const url = "https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php?l=zh-tw&o=json&s=0,asc,0";
  const payload = JSON.parse(await fetchText(url, { headers: { Referer: "https://www.tpex.org.tw/" } }, 20000));
  const date = yyyymmddToIso(payload?.date);
  const table = Array.isArray(payload?.tables) ? payload.tables[0] : null;
  const rows = Array.isArray(table?.data) && date ? table.data : [];
  const quotes = new Map();
  rows.forEach((row) => {
    const code = normalizeCode(row[0]);
    const quote = normalizeTpexDailyRow(row, date);
    if (/^\d{4}$/.test(code) && quote) quotes.set(code, quote);
  });
  tpexDailyCache = { ts: Date.now(), value: quotes };
  return quotes;
}

async function mergeTpexDailyQuote(code, history) {
  if (history.market !== "TPEX") return history;
  try {
    const quote = (await fetchTpexDailyQuotes()).get(code);
    if (!quote) return history;
    const byDate = new Map(history.rows.map((row) => [row.date, row]));
    byDate.set(quote.date, { ...(byDate.get(quote.date) || {}), ...quote });
    return {
      ...history,
      rows: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-260),
    };
  } catch {
    return history;
  }
}

async function fetchTwseMonth(code, date) {
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?response=json&date=${date}&stockNo=${code}`;
  const payload = JSON.parse(await fetchText(url, { headers: { Referer: "https://www.twse.com.tw/" } }));
  if (payload?.stat && payload.stat !== "OK") return [];
  return normalizeTwseRows(payload);
}

async function fetchTpexMonth(code, date) {
  const url = `https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=${code}&date=${encodeURIComponent(date)}&id=&response=json`;
  const payload = JSON.parse(await fetchText(url, { headers: { Referer: "https://www.tpex.org.tw/" } }));
  return normalizeTpexRows(payload);
}

async function fetchHistory(code) {
  const cached = cache.get(code);
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached.value;

  const months = monthStarts(12);
  let market = "TWSE";
  const twseResults = await Promise.allSettled(months.map((item) => fetchTwseMonth(code, item.twse)));
  let rows = twseResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);

  if (rows.length < 25) {
    market = "TPEX";
    const tpexResults = await Promise.allSettled(months.map((item) => fetchTpexMonth(code, item.tpex)));
    rows = tpexResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  }

  const byDate = new Map();
  rows.forEach((row) => byDate.set(row.date, row));
  const value = {
    code,
    market,
    rows: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-260),
  };
  cache.set(code, { ts: Date.now(), value });
  return value;
}

function avg(values) {
  const nums = values.filter((value) => Number.isFinite(value) && value > 0);
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : 0;
}

function sma(values, length) {
  if (values.length < length) return 0;
  return avg(values.slice(-length));
}

function normalizeVolumeLots(value) {
  const number = Number(value) || 0;
  return number > 1000000 ? number / 1000 : number;
}

function scanOpenBuy(code, market, rows) {
  if (rows.length < 35) return null;
  const last = rows.at(-1);
  const prev = rows.at(-2);
  const lastVolume = normalizeVolumeLots(last.volume);
  const prevVolume = normalizeVolumeLots(prev?.volume);
  const closes = rows.map((row) => row.close);
  const volumes = rows.map((row) => normalizeVolumeLots(row.volume));
  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const ma35 = sma(closes, 35);
  const volMa20 = sma(volumes, 20);
  const pct = prev?.close ? ((last.close - prev.close) / prev.close) * 100 : 0;
  const volumeRatio = volMa20 ? lastVolume / volMa20 : 0;
  const range = Math.max(last.high - last.low, 1);
  const bodyRatio = Math.abs(last.close - last.open) / range;
  const upperShadowRatio = (last.high - Math.max(last.close, last.open)) / range;
  const high20 = Math.max(...rows.slice(-21, -1).map((row) => row.high));
  const closeNearHigh = last.high ? last.close >= last.high * 0.95 : false;
  const tailKeepsRising = last.close > last.open && closeNearHigh && last.close >= last.low * 1.03;
  const liquid = lastVolume >= 1000;
  const qualityPrice = last.close >= 15;
  const closeAboveMa35 = ma35 > 0 && last.close > ma35;
  const controlledMomentum = pct >= 1.0 && pct <= 6.5;
  const saneVolume = volumeRatio >= 0.8 && volumeRatio <= 6.0;
  const trend = last.close > ma20 || (last.close > ma5 && ma5 >= ma10 * 0.995);
  const breakout = last.close > high20 || (last.close >= high20 * 0.965 && closeNearHigh);
  const strongClose = last.close > last.open && bodyRatio >= 0.12 && pct >= 0.2;
  const volumeTurn = volumeRatio >= 0.8 && pct >= 1.0 && last.close >= ma5;
  const reboundTurn = pct >= 1.0 && last.close > ma20 && closeNearHigh && volumeRatio >= 0.8;
  const prevPct = rows.length > 2 && rows.at(-3)?.close ? ((prev.close - rows.at(-3).close) / rows.at(-3).close) * 100 : 0;
  const high5 = Math.max(...rows.slice(-6, -1).map((row) => row.high));
  const recent20 = rows.slice(-21, -1);
  const rangeHigh20 = Math.max(...recent20.map((row) => row.high || row.close));
  const rangeLow20 = Math.min(...recent20.map((row) => row.low || row.close));
  const boxRange = rangeLow20 ? ((rangeHigh20 - rangeLow20) / rangeLow20) * 100 : 0;
  const longRangeHigh = Math.max(...rows.map((row) => row.high || row.close));
  const dropPercent = longRangeHigh ? ((longRangeHigh - last.close) / longRangeHigh) * 100 : 0;
  const ma5Vol = avg(volumes.slice(-6, -1));
  const volumeBurst = ma5Vol ? lastVolume > ma5Vol * 2 : false;
  const volumeIncreaseRatio = prevVolume ? lastVolume / prevVolume : 0;
  const volumeVsMa5Ratio = ma5Vol ? lastVolume / ma5Vol : 0;
  const sustainedVolumeExpansion = ma5Vol && volMa20
    ? volumeIncreaseRatio >= 1.2 && volumeRatio >= 1.2 && volumeVsMa5Ratio >= 1.5
    : false;
  const longLowerShadow = (Math.min(last.close, last.open) - last.low) / range >= 0.35;
  const reboundCandle = last.close > last.open || longLowerShadow;
  const bottomBreakout = last.close > rangeHigh20;
  const exceptionalLimitBreak = lastVolume >= 10000 && pct >= 6 && breakout && closeNearHigh && last.close > ma5 && last.close > ma20;
  const openingVolumeReady = lastVolume >= 1500 && (volumeRatio >= 0.6 || volumeVsMa5Ratio >= 0.7 || volumeIncreaseRatio >= 1.05 || exceptionalLimitBreak);
  const openingPowerSetup = qualityPrice &&
    closeAboveMa35 &&
    openingVolumeReady &&
    last.close > last.open &&
    pct >= 2 &&
    pct <= 10.1 &&
    last.close >= last.low * 1.02 &&
    last.close >= last.high * 0.92 &&
    upperShadowRatio <= 0.55 &&
    bodyRatio >= 0.12 &&
    last.close > ma5 &&
    last.close > ma20 &&
    ma5 >= ma10 * 0.96 &&
    (breakout || closeNearHigh || last.open >= prev.close * 1.005);
  const continuationSetup = liquid && qualityPrice && closeAboveMa35 && controlledMomentum && saneVolume &&
    tailKeepsRising && (trend || strongClose || volumeTurn || reboundTurn || breakout);
  const washoutSetup = liquid &&
    qualityPrice &&
    closeAboveMa35 &&
    pct >= -5.8 &&
    pct <= 2.5 &&
    prevPct >= 1.5 &&
    volumeRatio >= 0.35 &&
    volumeRatio <= 3.0 &&
    last.close >= ma20 * 0.94 &&
    last.low <= ma20 * 1.02 &&
    high5 >= ma20 * 1.08 &&
    last.close >= last.low * 1.03;
  const deepReboundSetup = rows.length >= 120 &&
    qualityPrice &&
    closeAboveMa35 &&
    last.close > last.open &&
    dropPercent > 30 &&
    boxRange <= 10 &&
    sustainedVolumeExpansion &&
    bottomBreakout &&
    last.close > ma20 &&
    pct >= -2 &&
    pct <= 6.5 &&
    volumeRatio >= 0.6 &&
    volumeRatio <= 5.0 &&
    reboundCandle;

  if (!(openingPowerSetup || continuationSetup || deepReboundSetup || washoutSetup)) {
    return null;
  }

  const openingPowerScore = Math.min(100, Math.round(
    62 +
    Math.min(Math.max(pct, 0) * 3, 24) +
    Math.min(volumeRatio * 4, 14) +
    Math.min(volumeIncreaseRatio * 4, 12) +
    (last.close >= last.high * 0.95 ? 8 : 0) +
    (breakout ? 8 : 0) +
    (last.close > ma20 ? 6 : 0)
  ));
  const continuationScore = Math.min(100, Math.round(
    42 +
    Math.min(Math.max(pct, 0) * 3.6, 18) +
    Math.min(volumeRatio * 9, 18) +
    (breakout ? 12 : 0) +
    (strongClose ? 10 : 0) +
    (closeNearHigh ? 6 : 0) +
    (last.close > ma20 ? 6 : 0)
  ));
  const deepReboundScore = Math.min(94, Math.round(
    55 +
    Math.min(dropPercent * 0.55, 22) +
    Math.min(Math.max(pct, 0) * 3.2, 14) +
    Math.min(volumeRatio * 5, 14) +
    (volumeBurst ? 10 : 0) +
    (bottomBreakout ? 8 : 0) +
    (longLowerShadow ? 8 : 0) +
    (last.close > last.open ? 6 : 0)
  ));
  const washoutScore = Math.min(94, Math.round(
    55 +
    Math.min(Math.abs(pct) * 3.2, 17) +
    Math.min(Math.max(prevPct, 0) * 2.2, 11) +
    Math.min(volumeRatio * 4, 10) +
    (last.close >= ma20 * 0.97 ? 5 : 0) +
    (last.low <= ma20 * 1.02 ? 4 : 0)
  ));
  const primarySetup = openingPowerSetup ? "開盤無腦入" : deepReboundSetup ? "深跌反彈" : continuationSetup ? "突破候選" : "洗盤反彈";
  const score = primarySetup === "開盤無腦入" ? openingPowerScore : primarySetup === "深跌反彈" ? deepReboundScore : primarySetup === "洗盤反彈" ? washoutScore : continuationScore;
  const takeProfit = Number((last.close * 1.012).toFixed(last.close >= 100 ? 1 : 2));
  const stopLoss = Number((last.close * 0.99).toFixed(last.close >= 100 ? 1 : 2));
  const noChase = Number((last.close * 1.045).toFixed(last.close >= 100 ? 1 : 2));
  const matchedSetups = [
    openingPowerSetup ? "開盤無腦入" : "",
    continuationSetup ? "突破候選" : "",
    deepReboundSetup ? "深跌反彈" : "",
    washoutSetup ? "洗盤反彈" : "",
  ].filter(Boolean);

  return {
    code,
    market,
    date: last.date,
    close: last.close,
    percent: pct,
    volume: lastVolume,
    tradeVolume: lastVolume,
    value: last.value,
    volumeRatio: Number(volumeRatio.toFixed(2)),
    volumeIncreaseRatio: Number(volumeIncreaseRatio.toFixed(2)),
    ma35: Number(ma35.toFixed(2)),
    closeAboveMa35,
    dropPercent: Number(dropPercent.toFixed(2)),
    boxRange: Number(boxRange.toFixed(2)),
    volumeBurstRatio: Number(volumeVsMa5Ratio.toFixed(2)),
    sustainedVolumeExpansion,
    longLowerShadow,
    tailKeepsRising,
    matchedSetups,
    score,
    status: primarySetup,
    setup: primarySetup,
    entry: primarySetup === "開盤無腦入" ? "09:00 開盤價" : primarySetup === "突破候選" ? "09:00 開盤價" : "09:01 站回開盤價",
    takeProfit,
    stopLoss,
    noChase,
    exitTime: "09:10",
    reason: primarySetup === "深跌反彈"
      ? `深跌反彈：長週期高點回落 ${dropPercent.toFixed(1)}%，20日箱體 ${boxRange.toFixed(1)}%，量增 ${volumeIncreaseRatio.toFixed(1)} 倍、量比 ${volumeRatio.toFixed(2)}，收盤站上MA35 ${ma35.toFixed(2)}，紅K突破箱體頸線並站上月線。`
      : primarySetup === "開盤無腦入"
      ? `開盤無腦入：漲幅 ${pct.toFixed(2)}%，成交量 ${Math.round(lastVolume).toLocaleString("zh-TW")} 張、量比 ${volumeRatio.toFixed(2)}，收盤站上MA35 ${ma35.toFixed(2)}，紅K強攻收在日內強勢區，前一天先列入開盤進場名單。`
      : primarySetup === "洗盤反彈"
      ? `洗盤反彈：昨日漲幅 ${pct.toFixed(2)}%，前日強勢 ${prevPct.toFixed(2)}%，量比 ${volumeRatio.toFixed(2)}，收盤站上MA35 ${ma35.toFixed(2)}，回測均線後收離低點，09:01 站回開盤價才進。`
      : `突破候選：昨日漲幅 ${pct.toFixed(2)}%，量比 ${volumeRatio.toFixed(2)}，成交量 ${Math.round(lastVolume).toLocaleString("zh-TW")} 張，收盤站上MA35 ${ma35.toFixed(2)}，尾盤收近高點，列入開盤候選。`,
  };
}

module.exports = async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "Method not allowed", matches: [] });
    return;
  }

  const codes = String(request.query?.codes || "")
    .split(",")
    .map(normalizeCode)
    .filter((code) => /^\d{4}$/.test(code))
    .filter((code) => !/^00/.test(code));

  if (!codes.length) {
    response.status(400).json({ ok: false, error: "Missing codes", matches: [] });
    return;
  }

  const quoteMap = await fetchMisQuotes(codes);
  const results = await Promise.allSettled(codes.map(async (code) => {
    const history = mergeMisQuoteIntoHistory(await mergeTpexDailyQuote(code, await fetchHistory(code)), quoteMap.get(code));
    if (!history.rows.length) return null;
    return scanOpenBuy(code, history.market, history.rows);
  }));

  const matches = results
    .filter((result) => result.status === "fulfilled" && result.value)
    .map((result) => result.value)
    .sort((a, b) => b.score - a.score || b.percent - a.percent);

  response.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");
  response.status(200).json({
    ok: true,
    updatedAt: new Date().toISOString(),
    scanned: codes.length,
    scannedCodes: codes,
    count: matches.length,
    matches,
    rules: {
      takeProfit: "+1.2%",
      stopLoss: "-1.0%",
      exitTime: "09:10",
      noChase: "+4.5%",
    },
    errors: results
      .map((result, index) => result.status === "rejected" ? `${codes[index]}: ${result.reason.message}` : null)
      .filter(Boolean),
  });
};


