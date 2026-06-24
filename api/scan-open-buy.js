const cache = new Map();
const CACHE_MS = 30 * 60 * 1000;
let tpexDailyCache = null;
const fs = require("fs");
const path = require("path");
const { fetchMisQuotes, mergeMisQuoteIntoHistory } = require("../lib/mis-quotes");
const { loadChipTradeBlacklist } = require("../lib/chip-trade-exclusions");
const USE_MIS_QUOTES = process.env.OPEN_BUY_USE_MIS === "1";
const blacklistCodes = loadChipTradeBlacklist();
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-anon-key.txt"));
const OPEN_BUY_DAILY_VIEW = process.env.SUPABASE_STRATEGY1_DAILY_VIEW || "strategy4_daily_ohlcv_view";

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

function normalizeYahooRows(payload) {
  const result = payload?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] || {};
  return timestamps.map((ts, index) => ({
    date: new Date(ts * 1000).toISOString().slice(0, 10),
    volume: cleanNumber(quote.volume?.[index]),
    value: 0,
    open: cleanNumber(quote.open?.[index]),
    high: cleanNumber(quote.high?.[index]),
    low: cleanNumber(quote.low?.[index]),
    close: cleanNumber(quote.close?.[index]),
    change: 0,
  })).filter((row) => row.date && row.close);
}

async function fetchYahooHistory(code, marketHint = "") {
  const hint = String(marketHint || "").toUpperCase();
  const suffixes = hint === "TPEX" ? ["TWO", "TW"] : hint === "TWSE" ? ["TW", "TWO"] : ["TW", "TWO"];
  for (const suffix of suffixes) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}.${suffix}?range=9mo&interval=1d&events=history&includeAdjustedClose=true`;
      const payload = JSON.parse(await fetchText(url, { headers: { Referer: "https://finance.yahoo.com/" } }, 20000));
      const rows = normalizeYahooRows(payload);
      if (rows.length >= 35) return { market: suffix === "TWO" ? "TPEX" : "TWSE", rows, source: `yahoo-${suffix.toLowerCase()}` };
    } catch {
    }
  }
  return { market: marketHint || "", rows: [], source: "" };
}

async function fetchSupabaseHistory(code) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { market: "", rows: [], source: "" };
  const query = [
    "select=symbol,name,market,industry,trade_date,open,high,low,close,volume_shares,volume_lots,trade_value_twd,source",
    `symbol=eq.${encodeURIComponent(code)}`,
    "order=trade_date.desc",
    "limit=180",
  ].join("&");
  try {
    const text = await fetchText(`${SUPABASE_URL}/rest/v1/${OPEN_BUY_DAILY_VIEW}?${query}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Referer: "https://fuman-terminal.vercel.app/",
      },
    }, 20000);
    const payload = JSON.parse(text);
    const latest = Array.isArray(payload) ? payload[0] : null;
    const rows = (Array.isArray(payload) ? payload : []).map((row) => ({
      date: String(row.trade_date || "").slice(0, 10),
      volume: cleanNumber(row.volume_lots) || normalizeVolumeLots(row.volume_shares),
      value: cleanNumber(row.trade_value_twd),
      open: cleanNumber(row.open),
      high: cleanNumber(row.high),
      low: cleanNumber(row.low),
      close: cleanNumber(row.close),
      change: 0,
    })).filter((row) => row.date && row.close).sort((a, b) => a.date.localeCompare(b.date));
    return {
      market: String(latest?.market || "").toUpperCase() === "OTC" ? "TPEX" : "TWSE",
      rows,
      source: `supabase:${OPEN_BUY_DAILY_VIEW}`,
      stock: latest ? { name: latest.name, industry: latest.industry, market: latest.market } : {},
    };
  } catch {
    return { market: "", rows: [], source: "" };
  }
}

function taipeiDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value).reduce((out, part) => {
    if (part.type !== "literal") out[part.type] = part.value;
    return out;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function fetchSupabaseQuoteRow(code) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const table = process.env.SUPABASE_STRATEGY1_QUOTE_TABLE || "fugle_quotes_latest";
  const query = [
    "select=symbol,code,name,market,close,last_price,open,high,low,previous_close,prev_close,change_percent,trade_volume_lots,trade_volume,total_volume,trade_value,updated_at,last_trade_time,quote_time,is_halted,is_trial",
    `symbol=eq.${encodeURIComponent(code)}`,
    "limit=1",
  ].join("&");
  try {
    const text = await fetchText(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Referer: "https://fuman-terminal.vercel.app/",
      },
    }, 12000);
    const rows = JSON.parse(text);
    return Array.isArray(rows) ? rows[0] || null : null;
  } catch {
    return null;
  }
}

function mergeLatestQuote(history, quote) {
  if (!quote) return history;
  const close = cleanNumber(quote.last_price ?? quote.close);
  const open = cleanNumber(quote.open);
  const high = cleanNumber(quote.high);
  const low = cleanNumber(quote.low);
  if (!close || !open || !high || !low) return history;
  const quoteDate = taipeiDateKey(new Date(quote.quote_time || quote.last_trade_time || quote.updated_at || Date.now()));
  const byDate = new Map((history.rows || []).map((row) => [row.date, row]));
  byDate.set(quoteDate, {
    date: quoteDate,
    volume: cleanNumber(quote.trade_volume_lots ?? quote.total_volume ?? quote.trade_volume),
    value: cleanNumber(quote.trade_value),
    open,
    high,
    low,
    close,
    change: cleanNumber(quote.change_percent),
  });
  return {
    ...history,
    market: String(quote.market || "").toUpperCase() === "OTC" ? "TPEX" : history.market,
    rows: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-260),
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
  const supabaseHistory = await fetchSupabaseHistory(code);
  let rows = supabaseHistory.rows || [];
  if (supabaseHistory.market) market = supabaseHistory.market;
  let value = mergeLatestQuote({
    code,
    market,
    rows,
  }, await fetchSupabaseQuoteRow(code));
  rows = value.rows || [];
  market = value.market || market;

  if (rows.length < 35) {
    const twseResults = await Promise.allSettled(months.map((item) => fetchTwseMonth(code, item.twse)));
    rows = twseResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  }

  if (rows.length < 25) {
    market = "TPEX";
    const tpexResults = await Promise.allSettled(months.map((item) => fetchTpexMonth(code, item.tpex)));
    rows = tpexResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  }

  if (rows.length < 35) {
    const yahoo = await fetchYahooHistory(code, market);
    if (yahoo.rows.length >= rows.length) {
      market = yahoo.market || market;
      rows = yahoo.rows;
    }
  }
  value = mergeLatestQuote({ code, market, rows }, await fetchSupabaseQuoteRow(code));
  rows = value.rows || rows;
  market = value.market || market;

  const byDate = new Map();
  rows.forEach((row) => byDate.set(row.date, row));
  value = {
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

function flagTrue(value) {
  if (value === true) return true;
  const text = String(value ?? "").trim().toLowerCase();
  return text === "true" || text === "1" || text === "yes" || text === "y";
}

function strategy1HardExclusion(stock = {}) {
  const code = normalizeCode(stock.code || stock.symbol);
  const name = String(stock.name || "").trim();
  const industry = String(stock.industry || stock.officialIndustry || stock.primaryIndustry || stock.quoteIndustry || "").trim();
  const text = `${code} ${name} ${industry} ${stock.market || ""}`;
  const reasons = [];
  if (!/^\d{4}$/.test(code)) reasons.push("代號格式不符");
  if (/^00/.test(code)) reasons.push("ETF/00開頭");
  if (blacklistCodes.has(code)) reasons.push("黑名單");
  if (flagTrue(stock.is_etf ?? stock.isEtf)) reasons.push("ETF");
  if (flagTrue(stock.is_warrant ?? stock.isWarrant)) reasons.push("權證");
  if (flagTrue(stock.is_cb ?? stock.isCb)) reasons.push("可轉債");
  if (flagTrue(stock.is_blacklisted ?? stock.isBlacklisted)) reasons.push("黑名單");
  if (flagTrue(stock.is_halted ?? stock.isHalted ?? stock.is_suspended ?? stock.isSuspended)) reasons.push("停牌/暫停交易");
  if (/(ETF|ETN|指數|高股息|正2|反1|期貨|債|權證|認購|認售|牛證|熊證|CB|可轉債)/i.test(text)) reasons.push("非普通股");
  if (/水泥|軍工|國防|航太|漢翔|雷虎|龍德|駐龍|晟田|寶一|亞航|千附/i.test(text)) reasons.push("水泥/軍工/國防/航太");
  if (/^(28|58)/.test(code) || /(金控|銀行|證券|保險|票券|租賃|產險|中租|致和證|統一證|三商壽)/i.test(text)) reasons.push("金融");
  if (/^(2610|2618|2646|6757)$/.test(code) || /(航空|空運|華航|星宇航空|台灣虎航)/i.test(text)) reasons.push("航空");
  return [...new Set(reasons)];
}

function withDecision(row, decision, setupType, reason, extras = {}) {
  return {
    ...row,
    ...extras,
    decision,
    setupType,
    status: setupType,
    setup: setupType,
    reason,
    strategy1Decision: {
      decision,
      setupType,
      blockReason: decision === "BLOCK" ? reason : "",
    },
  };
}

function scanOpenBuy(code, stock, market, rows) {
  const base = { code, name: stock?.name || code, market };
  const hardExcluded = strategy1HardExclusion({ ...stock, code, market });
  if (hardExcluded.length) return withDecision({ ...base, score: 0, signals: [] }, "BLOCK", "母池排除", hardExcluded.join("；"));
  if (rows.length < 35) return withDecision({ ...base, score: 0, signals: [] }, "BLOCK", "資料不足", `日K不足 ${rows.length}/35`);
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

  const recentAttackDays = rows.slice(-5).filter((row, index, list) => {
    const previous = index > 0 ? list[index - 1] : rows.at(-6);
    return previous?.close && ((row.close - previous.close) / previous.close) * 100 >= 2;
  }).length;
  const firstOrSecondAttack = recentAttackDays <= 2 && pct >= 0.8 && pct <= 8.8 && prevPct <= 5.5;
  const strongDailyClose = qualityPrice && closeAboveMa35 && last.close > last.open && closeNearHigh && pct >= 0.8 && pct <= 8.8;
  const volumeExpandedButControlled = lastVolume >= 800 && volumeRatio >= 0.55 && volumeRatio <= 8.5;
  const firstStageAttack = strongDailyClose && volumeExpandedButControlled && firstOrSecondAttack && (trend || breakout || volumeTurn || reboundTurn);
  const hotTurnoverSetup = qualityPrice && closeAboveMa35 && lastVolume >= 1500 && pct >= 0.5 && pct <= 9.8 && closeNearHigh && (volumeRatio >= 0.45 || volumeIncreaseRatio >= 1.05);
  const watchSetup = qualityPrice && closeAboveMa35 && lastVolume >= 600 && pct >= -1.5 && pct <= 9.8 && (closeNearHigh || breakout || volumeRatio >= 0.6);
  const candidateSetup = openingPowerSetup || continuationSetup || firstStageAttack || hotTurnoverSetup || deepReboundSetup || washoutSetup;

  if (!candidateSetup && !watchSetup) {
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
  const firstStageScore = Math.min(96, Math.round(
    58 +
    Math.min(Math.max(pct, 0) * 3, 22) +
    Math.min(volumeRatio * 8, 18) +
    (breakout ? 8 : 0) +
    (closeNearHigh ? 6 : 0) +
    (recentAttackDays <= 2 ? 5 : 0)
  ));
  const hotTurnoverScore = Math.min(92, Math.round(
    52 +
    Math.min(Math.max(pct, 0) * 2.5, 20) +
    Math.min(volumeRatio * 7, 16) +
    Math.min(volumeIncreaseRatio * 4, 10) +
    (closeNearHigh ? 6 : 0)
  ));
  const watchScore = Math.min(78, Math.round(
    42 +
    Math.min(Math.max(pct, 0) * 2, 14) +
    Math.min(volumeRatio * 6, 14) +
    (closeNearHigh ? 5 : 0) +
    (breakout ? 5 : 0)
  ));
  const primarySetup = openingPowerSetup ? "A級 開盤無腦入"
    : continuationSetup ? "B級 突破候選"
    : firstStageAttack ? "B級 第一/二根攻擊"
    : hotTurnoverSetup ? "B級 高周轉候選"
    : deepReboundSetup ? "C級 深跌反彈"
    : washoutSetup ? "C級 洗盤反彈"
    : "WATCH 觀察";
  const score = Math.max(
    openingPowerSetup ? openingPowerScore : 0,
    continuationSetup ? continuationScore : 0,
    firstStageAttack ? firstStageScore : 0,
    hotTurnoverSetup ? hotTurnoverScore : 0,
    deepReboundSetup ? deepReboundScore : 0,
    washoutSetup ? washoutScore : 0,
    watchSetup ? watchScore : 0
  );
  const takeProfit = Number((last.close * 1.012).toFixed(last.close >= 100 ? 1 : 2));
  const stopLoss = Number((last.close * 0.99).toFixed(last.close >= 100 ? 1 : 2));
  const noChase = Number((last.close * 1.045).toFixed(last.close >= 100 ? 1 : 2));
  const matchedSetups = [
    openingPowerSetup ? "A級 開盤無腦入" : "",
    continuationSetup ? "B級 突破候選" : "",
    firstStageAttack ? "B級 第一/二根攻擊" : "",
    hotTurnoverSetup ? "B級 高周轉候選" : "",
    deepReboundSetup ? "C級 深跌反彈" : "",
    washoutSetup ? "C級 洗盤反彈" : "",
    !candidateSetup && watchSetup ? "WATCH 觀察" : "",
  ].filter(Boolean);
  const decision = candidateSetup ? "BUY" : "WATCH";

  return withDecision({
    ...base,
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
    entry: primarySetup.includes("開盤無腦入") || primarySetup.includes("突破") || primarySetup.includes("攻擊") || primarySetup.includes("高周轉") ? "09:00 開盤價" : "09:01 站回開盤價",
    takeProfit,
    stopLoss,
    noChase,
    exitTime: "09:10",
    signals: matchedSetups.map((label) => ({ label, reason: label })),
  }, decision, primarySetup, primarySetup.includes("深跌反彈")
      ? `深跌反彈：長週期高點回落 ${dropPercent.toFixed(1)}%，20日箱體 ${boxRange.toFixed(1)}%，量增 ${volumeIncreaseRatio.toFixed(1)} 倍、量比 ${volumeRatio.toFixed(2)}，收盤站上MA35 ${ma35.toFixed(2)}，紅K突破箱體頸線並站上月線。`
      : primarySetup.includes("開盤無腦入")
      ? `開盤無腦入：漲幅 ${pct.toFixed(2)}%，成交量 ${Math.round(lastVolume).toLocaleString("zh-TW")} 張、量比 ${volumeRatio.toFixed(2)}，收盤站上MA35 ${ma35.toFixed(2)}，紅K強攻收在日內強勢區，前一天先列入開盤進場名單。`
      : primarySetup.includes("洗盤反彈")
      ? `洗盤反彈：昨日漲幅 ${pct.toFixed(2)}%，前日強勢 ${prevPct.toFixed(2)}%，量比 ${volumeRatio.toFixed(2)}，收盤站上MA35 ${ma35.toFixed(2)}，回測均線後收離低點，09:01 站回開盤價才進。`
      : decision === "WATCH"
      ? `觀察：漲幅 ${pct.toFixed(2)}%，量比 ${volumeRatio.toFixed(2)}，收盤站上MA35 ${ma35.toFixed(2)}，但尚未達 21:30 BUY 候選強度。`
      : `21:30 候選：昨日漲幅 ${pct.toFixed(2)}%，量比 ${volumeRatio.toFixed(2)}，成交量 ${Math.round(lastVolume).toLocaleString("zh-TW")} 張，收盤站上MA35 ${ma35.toFixed(2)}，收近高點/量價轉強，列入明日開盤候選。`);
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
  let stockMeta = new Map();
  try {
    const parsed = JSON.parse(String(request.query?.stocks || "[]"));
    if (Array.isArray(parsed)) {
      stockMeta = new Map(parsed.map((stock) => [normalizeCode(stock?.code || stock?.symbol), stock]).filter(([code]) => /^\d{4}$/.test(code)));
    }
  } catch {}

  if (!codes.length) {
    response.status(400).json({ ok: false, error: "Missing codes", matches: [] });
    return;
  }

  const quoteMap = USE_MIS_QUOTES ? await fetchMisQuotes(codes) : new Map();
  const results = await Promise.allSettled(codes.map(async (code) => {
    const stock = stockMeta.get(code) || {};
    const history = mergeMisQuoteIntoHistory(await mergeTpexDailyQuote(code, await fetchHistory(code)), quoteMap.get(code));
    if (!history.rows.length) {
      return withDecision({ code, name: stock.name || code, market: stock.market || "", score: 0, signals: [] }, "BLOCK", "日K缺資料", "TWSE/TPEX/Yahoo 日K皆無有效資料");
    }
    return scanOpenBuy(code, stock, history.market, history.rows);
  }));

  const rows = results
    .filter((result) => result.status === "fulfilled" && result.value)
    .map((result) => result.value)
    .sort((a, b) => b.score - a.score || b.percent - a.percent);
  const matches = rows.filter((row) => row.decision === "BUY");
  const watch = rows.filter((row) => row.decision === "WATCH");
  const block = rows.filter((row) => row.decision === "BLOCK");

  response.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");
  response.status(200).json({
    ok: true,
    updatedAt: new Date().toISOString(),
    scanned: codes.length,
    scannedCodes: codes,
    count: matches.length,
    resultCount: rows.length,
    buyCount: matches.length,
    watchCount: watch.length,
    blockCount: block.length,
    rows,
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






