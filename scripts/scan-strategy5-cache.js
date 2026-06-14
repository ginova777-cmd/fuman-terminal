const fs = require("fs");
const path = require("path");
const { fetchMisQuotes } = require("../lib/mis-quotes");
const { overlayFugleWebSocketQuotes } = require("../lib/fugle-quote-overlay");

const { ROOT, dataPath } = require("./runtime-paths");
const OUT_FILE = dataPath("strategy5-latest.json");
const BACKUP_FILE = dataPath("strategy5-backup.json");
const INSTITUTION_FILE = dataPath("institution-latest.json");
const CB_DETECT_FILE = dataPath("cb-detect-latest.json");
const WARRANT_FLOW_FILE = dataPath("warrant-flow-latest.json");
const STRATEGY4_FILE = dataPath("strategy4-latest.json");
const STRATEGY4_BACKUP_FILE = dataPath("strategy4-backup.json");
const STOCK_URL = process.env.STOCK_UNIVERSE_URL || "https://fuman-terminal.vercel.app/api/stocks";
const CAPITAL_URLS = [
  "https://mopsfin.twse.com.tw/opendata/t187ap03_L.csv",
  "https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv",
];
const USE_MIS_QUOTES = process.env.STRATEGY5_USE_MIS === "1";
const HISTORY_CONCURRENCY = Math.max(1, Number(process.env.STRATEGY5_HISTORY_CONCURRENCY || 8));

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

async function fetchJson(url, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminalBot/1.0)",
        Accept: "application/json,text/plain,*/*",
      },
    });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminalBot/1.0)",
        Accept: "text/csv,text/plain,*/*",
      },
    });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map((item) => item.replace(/\s/g, ""));
  return rows.slice(1).map((items) => {
    const record = {};
    headers.forEach((header, index) => { record[header] = items[index] || ""; });
    return record;
  });
}

function normalizeStock(row) {
  const code = normalizeCode(row.Code || row.code || row["證券代號"]);
  const name = String(row.Name || row.name || row["證券名稱"] || "").trim();
  if (!/^\d{4}$/.test(code) || /^00/.test(code) || !name) return null;
  if (/ETF|ETN|指數|台灣50|高股息|正2|反1|期貨|債/i.test(name)) return null;
  return {
    code,
    name,
    close: cleanNumber(row.ClosingPrice || row.close),
    open: cleanNumber(row.OpeningPrice || row.open),
    high: cleanNumber(row.HighestPrice || row.high),
    low: cleanNumber(row.LowestPrice || row.low),
    prevClose: cleanNumber(row.PreviousClose || row.prevClose),
    limitUp: cleanNumber(row.LimitUp || row.limitUp),
    change: cleanNumber(row.Change || row.change),
    percent: cleanNumber(row.Percent || row.percent),
    value: cleanNumber(row.TradeValue || row.value),
    tradeVolume: cleanNumber(row.TradeVolume || row.tradeVolume),
    market: row.market || row.Market || "",
  };
}

async function fetchUniverse() {
  const payload = await fetchJson(STOCK_URL);
  const rows = Array.isArray(payload) ? payload : (payload.stocks || []);
  const base = rows.map(normalizeStock).filter(Boolean);
  const fugle = overlayFugleWebSocketQuotes(base, { source: "strategy5-universe" });
  const baseWithFugle = fugle.rows;
  if (fugle.used) console.log(`strategy5 fugle websocket overlay used ${fugle.used}/${base.length}`);
  if (!USE_MIS_QUOTES) return baseWithFugle;
  const quotes = await fetchMisQuotes(base.map((stock) => stock.code));
  return baseWithFugle.map((stock) => {
    const quote = quotes.get(stock.code);
    if (stock.quoteSource === "fugle-ws") return stock;
    return quote ? { ...stock, ...quote, name: quote.name || stock.name } : stock;
  });
}

async function fetchIssuedShares() {
  const map = new Map();
  const warnings = [];
  await Promise.all(CAPITAL_URLS.map(async (url) => {
    try {
      const rows = parseCsv(await fetchText(url));
      rows.forEach((row) => {
        const code = normalizeCode(row["公司代號"]);
        const shares = cleanNumber(row["已發行普通股數或TDR原股發行股數"]);
        if (/^\d{4}$/.test(code) && shares > 0) map.set(code, shares);
      });
    } catch (error) {
      warnings.push(`issued shares fetch failed: ${url} :: ${error.message}`);
    }
  }));
  return { map, warnings };
}

function formatTwseDate(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function formatTpexDate(date) {
  return `${String(date.getFullYear() - 1911).padStart(3, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

function taipeiDateKey(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}`;
}

function taipeiParts(date = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date).map((part) => [part.type, part.value]));
}

function shouldIncludeTodayVolume() {
  const parts = taipeiParts();
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 14 * 60 + 30;
}

function recentTradingDates(limit = 8) {
  const dates = [];
  const date = new Date();
  if (!shouldIncludeTodayVolume()) date.setDate(date.getDate() - 1);
  for (let i = 0; dates.length < limit && i < 18; i++) {
    const day = date.getDay();
    if (day !== 0 && day !== 6) dates.push(new Date(date));
    date.setDate(date.getDate() - 1);
  }
  return dates;
}

function collectVolume(bucket, code, volume) {
  if (!/^\d{4}$/.test(code) || /^00/.test(code) || volume <= 0) return;
  const list = bucket.get(code) || [];
  list.push(volume);
  bucket.set(code, list);
}

async function fetchHistoricalVolumes() {
  const bucket = new Map();
  const warnings = [];
  for (const date of recentTradingDates()) {
    try {
      const payload = await fetchJson(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${formatTwseDate(date)}&type=ALLBUT0999&response=json`, 25000);
      const table = (payload.tables || []).find((item) => String(item.title || "").includes("每日收盤行情"));
      const fields = table?.fields || [];
      const data = table?.data || [];
      const codeIndex = fields.findIndex((field) => String(field).includes("證券代號"));
      const volumeIndex = fields.findIndex((field) => String(field).includes("成交股數"));
      if (codeIndex >= 0 && volumeIndex >= 0) data.forEach((row) => collectVolume(bucket, normalizeCode(row[codeIndex]), cleanNumber(row[volumeIndex])));
    } catch (error) {
      warnings.push(`twse volume fetch failed: ${formatTwseDate(date)} :: ${error.message}`);
    }
    try {
      const payload = await fetchJson(`https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php?l=zh-tw&o=json&d=${encodeURIComponent(formatTpexDate(date))}&s=0,asc,0`, 25000);
      const table = (payload.tables || []).find((item) => (item.data || []).length);
      const fields = table?.fields || [];
      const data = table?.data || [];
      const codeIndex = fields.findIndex((field) => String(field).includes("代號"));
      const volumeIndex = fields.findIndex((field) => String(field).includes("成交股數"));
      if (codeIndex >= 0 && volumeIndex >= 0) data.forEach((row) => collectVolume(bucket, normalizeCode(row[codeIndex]), cleanNumber(row[volumeIndex])));
    } catch (error) {
      warnings.push(`tpex volume fetch failed: ${formatTpexDate(date)} :: ${error.message}`);
    }
  }
  const averages = new Map();
  bucket.forEach((values, code) => {
    const usable = values.slice(0, 5);
    if (usable.length) averages.set(code, usable.reduce((sum, value) => sum + value, 0) / usable.length);
  });
  return { map: averages, warnings };
}

function rankMap(stocks, key) {
  const sorted = [...stocks].sort((a, b) => cleanNumber(b[key]) - cleanNumber(a[key]));
  const total = Math.max(sorted.length - 1, 1);
  const ranks = new Map();
  sorted.forEach((stock, index) => {
    ranks.set(stock.code, Math.round(((total - index) / total) * 100));
  });
  return ranks;
}

function formatInstitution(value) {
  const amount = cleanNumber(value);
  const sign = amount >= 0 ? "+" : "";
  return `${sign}${Math.round(amount).toLocaleString("zh-TW")}`;
}

function readStrategy4Candidates() {
  const payloads = [
    readJson(STRATEGY4_FILE, null),
    readJson(STRATEGY4_BACKUP_FILE, null),
  ].filter(Boolean);
  for (const payload of payloads) {
    const matches = Array.isArray(payload.matches) ? payload.matches : [];
    if (matches.length) return matches;
  }
  return [];
}

function pickRows(payload, keys = []) {
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  if (Array.isArray(payload)) return payload;
  return [];
}

function readChipKConfluenceSources(institutionData = {}) {
  const cbPayload = readJson(CB_DETECT_FILE, {});
  const warrantPayload = readJson(WARRANT_FLOW_FILE, {});
  const cbRows = pickRows(cbPayload, ["matches", "rows", "data", "items"]);
  const warrantRows = pickRows(warrantPayload, ["matches", "rows", "data", "items"]);
  const cbByCode = new Map();
  const warrantByCode = new Map();
  const instByCode = new Map();

  Object.entries(institutionData || {}).forEach(([rawCode, inst]) => {
    const code = normalizeCode(rawCode);
    if (!/^\d{4}$/.test(code)) return;
    const foreign = cleanNumber(inst?.foreign);
    const trust = cleanNumber(inst?.trust);
    const dealer = cleanNumber(inst?.dealer);
    const total = cleanNumber(inst?.total || foreign + trust + dealer);
    if (total > 0 || foreign > 0 || trust > 0) instByCode.set(code, { foreign, trust, dealer, total });
  });

  cbRows.forEach((row) => {
    const code = normalizeCode(row?.underlyingCode || row?.stockCode || row?.code || row?.targetCode || row?.symbol);
    if (!/^\d{4}$/.test(code)) return;
    const score = cleanNumber(row?.score || row?.cbScore || row?.strength || row?.rankScore);
    const previous = cbByCode.get(code);
    if (!previous || score >= cleanNumber(previous.score)) cbByCode.set(code, { ...row, score });
  });

  warrantRows.forEach((row) => {
    const code = normalizeCode(row?.underlyingCode || row?.stockCode || row?.code || row?.targetCode || row?.symbol);
    if (!/^\d{4}$/.test(code)) return;
    const score = cleanNumber(row?.score || row?.flowScore || row?.strength || row?.rankScore);
    const previous = warrantByCode.get(code);
    if (!previous || score >= cleanNumber(previous.score)) warrantByCode.set(code, { ...row, score });
  });

  return { cbByCode, warrantByCode, instByCode };
}

function buildChipKConfluenceMatch({ stock, inst, confluenceSources, valueRank, volumeRank }) {
  const code = stock.code;
  const cb = confluenceSources.cbByCode.get(code);
  const warrant = confluenceSources.warrantByCode.get(code);
  const sourceInst = confluenceSources.instByCode.get(code) || inst;
  if (!cb || !warrant || !sourceInst) return null;

  const pct = cleanNumber(stock.percent);
  const total = cleanNumber(sourceInst.total);
  const foreign = cleanNumber(sourceInst.foreign);
  const trust = cleanNumber(sourceInst.trust);
  if (total <= 0 && foreign <= 0 && trust <= 0) return null;

  const cbScore = cleanNumber(cb.score);
  const warrantScore = cleanNumber(warrant.score);
  const score = clamp(Math.round(
    78 +
    Math.min(Math.max(pct, 0) * 2.2, 10) +
    Math.min(valueRank * 0.06, 6) +
    Math.min(volumeRank * 0.04, 4) +
    Math.min(cbScore * 0.05, 4) +
    Math.min(warrantScore * 0.05, 4)
  ), 80, 100);
  const reason = `同時命中買賣超、CB可轉債與權證走向；法人合計 ${formatInstitution(total)}，外資 ${formatInstitution(foreign)}、投信 ${formatInstitution(trust)}。`;
  return {
    id: "chip_k_confluence",
    short: "籌碼老K",
    icon: "老K",
    score,
    reason,
    cbScore,
    warrantScore,
  };
}

function buildStrategy5Match({ stock, inst, valueRank, volumeRank }) {
  const pct = cleanNumber(stock.percent);
  const foreign = cleanNumber(inst.foreign);
  const trust = cleanNumber(inst.trust);
  const total = cleanNumber(inst.total);
  const smartMoney = total + trust * 1.4;
  const jointBuying = total > 0 && foreign > 0 && trust > 0;
  if (!jointBuying || pct <= -1.5 || pct > 7.5) return null;

  const scoreBase = clamp(
    Math.round(35 + pct * 7 + valueRank * 0.24 + volumeRank * 0.18 + Math.sign(smartMoney) * 8),
    0,
    100
  );
  const score = clamp(scoreBase + 32, 0, 100);
  const reason = `外資 ${formatInstitution(foreign)}、投信 ${formatInstitution(trust)} 同買，法人合計 ${formatInstitution(total)}；漲幅 ${pct.toFixed(2)}%。`;
  return { id: "foreign_trust_breakout", short: "準突破", icon: "◆", score, reason };
}

function buildVolumeTurnoverMatch({ stock, issuedSharesMap, volumeAverageMap }) {
  const pct = cleanNumber(stock.percent);
  const volumeLots = cleanNumber(stock.tradeVolume) / 1000;
  const issuedShares = issuedSharesMap.get(stock.code) || 0;
  const turnoverRate = issuedShares ? (cleanNumber(stock.tradeVolume) / issuedShares) * 100 : 0;
  const avgVolume = volumeAverageMap.get(stock.code) || 0;
  const volumeRatio = avgVolume ? cleanNumber(stock.tradeVolume) / avgVolume : 0;
  if (!(pct >= 3 && pct <= 8 && volumeLots >= 1000 && turnoverRate > 5 && volumeRatio >= 1)) return null;
  const score = clamp(Math.round(
    48 +
    Math.min((pct - 3) * 8, 32) +
    Math.min(volumeLots / 120, 18) +
    Math.min(turnoverRate * 4, 28) +
    Math.min(volumeRatio * 10, 22)
  ), 0, 100);
  const reason = `符合固定條件：漲幅 ${pct.toFixed(2)}%、成交量 ${Math.round(volumeLots).toLocaleString("zh-TW")} 張、周轉率 ${turnoverRate.toFixed(2)}%、量比 ${volumeRatio.toFixed(2)}。`;
  return {
    id: "volume_turnover_breakout",
    short: "量價周轉",
    icon: "量",
    score,
    reason,
    volumeLots: Math.round(volumeLots),
    turnoverRate: Number(turnoverRate.toFixed(2)),
    volumeRatio: Number(volumeRatio.toFixed(2)),
  };
}

function avg(values) {
  const nums = values.filter((value) => Number.isFinite(value) && value > 0);
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : 0;
}

function stddev(values) {
  const nums = values.filter((value) => Number.isFinite(value) && value > 0);
  if (nums.length < 2) return 0;
  const mean = avg(nums);
  const variance = nums.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / nums.length;
  return Math.sqrt(variance);
}

function yahooSuffix(stock) {
  const market = String(stock.market || "").toUpperCase();
  return market === "TPEX" || market === "OTC" || market === "TWO" ? "TWO" : "TW";
}

function normalizeYahooRows(payload) {
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  return timestamps.map((timestamp, index) => ({
    date: new Date(timestamp * 1000).toISOString().slice(0, 10),
    open: cleanNumber(quote.open?.[index]),
    high: cleanNumber(quote.high?.[index]),
    low: cleanNumber(quote.low?.[index]),
    close: cleanNumber(quote.close?.[index]),
    volume: cleanNumber(quote.volume?.[index]),
  })).filter((row) => row.open && row.high && row.low && row.close);
}

async function fetchYahooHistory(stock, suffix = yahooSuffix(stock)) {
  const now = Math.floor(Date.now() / 1000);
  const period1 = now - 540 * 24 * 60 * 60;
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${stock.code}.${suffix}`);
  url.searchParams.set("period1", String(period1));
  url.searchParams.set("period2", String(now + 24 * 60 * 60));
  url.searchParams.set("interval", "1d");
  url.searchParams.set("includePrePost", "false");
  const payload = await fetchJson(url.toString(), 18000);
  return normalizeYahooRows(payload).slice(-180);
}

async function fetchDailyHistory(stock) {
  try {
    const rows = await fetchYahooHistory(stock);
    if (rows.length >= 30) return rows;
  } catch {}
  try {
    const fallbackSuffix = yahooSuffix(stock) === "TW" ? "TWO" : "TW";
    const rows = await fetchYahooHistory(stock, fallbackSuffix);
    if (rows.length >= 30) return rows;
  } catch {}
  return [];
}

async function mapLimit(items, limit, iteratee) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await iteratee(items[index], index);
    }
  }));
  return results;
}

function limitUpDojiPatternFromRows(rows) {
  if (!Array.isArray(rows) || rows.length < 12) return null;
  const last = rows.at(-1);
  const prev = rows.at(-2);
  const lastVolume = cleanNumber(last?.volume);
  const lastPct = prev?.close ? ((cleanNumber(last.close) - cleanNumber(prev.close)) / cleanNumber(prev.close)) * 100 : 0;
  const setupStart = Math.max(0, rows.length - 21);

  for (let limitIndex = rows.length - 10; limitIndex >= setupStart; limitIndex--) {
    const limitDay = rows[limitIndex];
    const limitPrev = rows[limitIndex - 1];
    const limitPct = limitPrev?.close ? ((cleanNumber(limitDay.close) - cleanNumber(limitPrev.close)) / cleanNumber(limitPrev.close)) * 100 : 0;
    const limitVolume = cleanNumber(limitDay.volume);
    if (limitPct < 9.0 || cleanNumber(limitDay.close) < cleanNumber(limitDay.open)) continue;

    const dojiEnd = Math.min(rows.length - 9, limitIndex + 5);
    for (let dojiIndex = limitIndex + 1; dojiIndex <= dojiEnd; dojiIndex++) {
      const doji = rows[dojiIndex];
      const dojiRange = cleanNumber(doji.high) - cleanNumber(doji.low);
      const dojiBodyRatio = dojiRange > 0 ? Math.abs(cleanNumber(doji.close) - cleanNumber(doji.open)) / dojiRange : 1;
      if (dojiBodyRatio > 0.35 || cleanNumber(doji.close) < cleanNumber(limitDay.close) * 0.93) continue;

      const boxRows = rows.slice(dojiIndex + 1, -1);
      if (boxRows.length < 7) continue;
      const boxHigh = Math.max(...boxRows.map((row) => cleanNumber(row.high)).filter(Boolean));
      const boxLow = Math.min(...boxRows.map((row) => cleanNumber(row.low)).filter(Boolean));
      const boxRangePct = boxLow ? ((boxHigh - boxLow) / boxLow) * 100 : 99;
      const boxVolumes = boxRows.map((row) => cleanNumber(row.volume)).filter(Boolean);
      const boxAvgVolume = avg(boxVolumes);
      const recentBoxVolume = avg(boxVolumes.slice(-3));
      const volumeContracting = boxAvgVolume > 0 && recentBoxVolume > 0 &&
        recentBoxVolume <= boxAvgVolume * 1.05 &&
        (!limitVolume || recentBoxVolume <= limitVolume * 0.85);
      const breakout = cleanNumber(last.close) >= boxHigh * 0.995 &&
        cleanNumber(last.close) > cleanNumber(last.open) &&
        lastPct >= 0.5 &&
        boxAvgVolume > 0 &&
        lastVolume >= boxAvgVolume * 1.15;
      if (boxRangePct <= 30 && volumeContracting && breakout) {
        return {
          boxDays: boxRows.length,
          boxRangePct,
          volumeRatio: boxAvgVolume ? lastVolume / boxAvgVolume : 0,
          pct: lastPct,
        };
      }
    }
  }
  return null;
}

function buildLimitUpDojiMatch({ stock, valueRank, volumeRank, rows }) {
  const pattern = limitUpDojiPatternFromRows(rows);
  if (!pattern || cleanNumber(stock.close) < 10 || valueRank < 35) return null;
  const scoreBase = clamp(Math.round(35 + pattern.pct * 7 + valueRank * 0.24 + volumeRank * 0.18), 0, 100);
  const score = clamp(scoreBase + 20 + Math.min(pattern.volumeRatio * 4, 12), 0, 100);
  const reason = `近20日漲停後出十字星，橫盤 ${pattern.boxDays} 天、區間 ${pattern.boxRangePct.toFixed(2)}%，縮量後今日放量 ${pattern.volumeRatio.toFixed(2)} 倍突破。`;
  return { id: "limit_up_doji", short: "漲停十字", icon: "十", score, reason };
}

function bollingerAt(rows, index) {
  if (index < 19) return null;
  const closes = rows.slice(index - 19, index + 1).map((row) => cleanNumber(row.close));
  if (closes.length < 20 || closes.some((value) => value <= 0)) return null;
  const middle = avg(closes);
  const deviation = stddev(closes);
  return {
    upper: middle + deviation * 2,
    middle,
    lower: middle - deviation * 2,
  };
}

function calculateKdj(rows, period = 9) {
  let k = 50;
  let d = 50;
  return rows.map((row, index) => {
    if (index < period - 1) return { k, d, j: 3 * k - 2 * d };
    const window = rows.slice(index - period + 1, index + 1);
    const high = Math.max(...window.map((item) => cleanNumber(item.high)).filter(Boolean));
    const low = Math.min(...window.map((item) => cleanNumber(item.low)).filter(Boolean));
    const close = cleanNumber(row.close);
    const rsv = high > low ? ((close - low) / (high - low)) * 100 : 50;
    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
    return { k, d, j: 3 * k - 2 * d };
  });
}

function bollingerSlopeMode(rows) {
  const current = bollingerAt(rows, rows.length - 1);
  const prev3 = bollingerAt(rows, rows.length - 4);
  const prev5 = bollingerAt(rows, rows.length - 6);
  if (!current || !prev3 || !prev5) return null;
  const middleSlopePct = ((current.middle - prev5.middle) / prev5.middle) * 100;
  const upperSlopePct = ((current.upper - prev5.upper) / prev5.upper) * 100;
  const lowerSlopePct = ((current.lower - prev5.lower) / prev5.lower) * 100;
  const widthPct = current.middle ? ((current.upper - current.lower) / current.middle) * 100 : 0;
  const prevWidthPct = prev5.middle ? ((prev5.upper - prev5.lower) / prev5.middle) * 100 : 0;
  const expanding = widthPct >= prevWidthPct * 0.96;
  const rising = middleSlopePct >= 0.35 && upperSlopePct >= 0 && lowerSlopePct >= -0.35;
  const flat = Math.abs(middleSlopePct) <= 1.0 && Math.abs(upperSlopePct) <= 1.4 && Math.abs(lowerSlopePct) <= 1.4;
  return { current, prev3, prev5, middleSlopePct, upperSlopePct, lowerSlopePct, widthPct, expanding, rising, flat };
}

function bollingerKdjPatternFromRows(rows) {
  if (!Array.isArray(rows) || rows.length < 35) return null;
  const last = rows.at(-1);
  const prev = rows.at(-2);
  const lastClose = cleanNumber(last?.close);
  const lastOpen = cleanNumber(last?.open);
  const prevClose = cleanNumber(prev?.close);
  const lastVolume = cleanNumber(last?.volume);
  if (!lastClose || !prevClose) return null;

  const kdj = calculateKdj(rows);
  const lastKdj = kdj.at(-1);
  const prevKdj = kdj.at(-2);
  const crossed = prevKdj.k <= prevKdj.d && lastKdj.k > lastKdj.d;
  const freshCross = crossed || (lastKdj.k > lastKdj.d && kdj.slice(-4, -1).some((item) => item.k <= item.d));
  const kdjTurningUp = lastKdj.k > prevKdj.k && lastKdj.d >= prevKdj.d * 0.98 && lastKdj.k <= 88;
  if (!freshCross || !kdjTurningUp) return null;

  const slope = bollingerSlopeMode(rows);
  if (!slope) return null;
  const { current } = slope;
  const pct = ((lastClose - prevClose) / prevClose) * 100;
  const redK = lastClose >= lastOpen && pct >= -0.5;
  const recentVolumes = rows.slice(-6, -1).map((row) => cleanNumber(row.volume));
  const volumeRatio = avg(recentVolumes) ? lastVolume / avg(recentVolumes) : 0;

  const midDistancePct = current.middle ? ((lastClose - current.middle) / current.middle) * 100 : 99;
  const lowerDistancePct = current.lower ? ((lastClose - current.lower) / current.lower) * 100 : 99;
  const fromLowerPct = current.lower ? ((lastClose - current.lower) / current.lower) * 100 : 99;
  const belowUpper = current.upper && lastClose <= current.upper * 1.035;
  const midBuy = slope.rising && belowUpper && lastClose >= current.middle * 0.985 && lastClose <= current.middle * 1.09;
  const lowerBuy = slope.flat && lastClose >= current.lower * 0.985 && lastClose <= current.middle * 1.04;
  if (!redK || volumeRatio < 0.75 || (!midBuy && !lowerBuy)) return null;

  return {
    mode: midBuy ? "三線向上中軌買點" : "三線走平下軌買點",
    pct,
    k: lastKdj.k,
    d: lastKdj.d,
    j: lastKdj.j,
    middle: current.middle,
    upper: current.upper,
    lower: current.lower,
    midDistancePct,
    lowerDistancePct,
    fromLowerPct,
    middleSlopePct: slope.middleSlopePct,
    volumeRatio,
  };
}

function buildBollingerKdjMatch({ stock, valueRank, volumeRank, rows }) {
  const pattern = bollingerKdjPatternFromRows(rows);
  if (!pattern || cleanNumber(stock.close) < 10 || valueRank < 30) return null;
  const score = clamp(Math.round(
    42 +
    valueRank * 0.18 +
    volumeRank * 0.12 +
    Math.min(Math.max(pattern.pct, 0) * 5, 18) +
    Math.min(pattern.volumeRatio * 6, 16) +
    (pattern.mode.includes("中軌") ? 8 : 5)
  ), 0, 100);
  const reason = `${pattern.mode}：20MA ${pattern.middle.toFixed(2)}、上軌 ${pattern.upper.toFixed(2)}、下軌 ${pattern.lower.toFixed(2)}；KDJ 黃金交叉 K ${pattern.k.toFixed(1)} / D ${pattern.d.toFixed(1)}，量比 ${pattern.volumeRatio.toFixed(2)}。`;
  return {
    id: "bollinger_kdj_buy",
    short: "布林KDJ",
    icon: "K",
    score,
    reason,
    bollingerMode: pattern.mode,
    bollingerMiddle: Number(pattern.middle.toFixed(2)),
    bollingerUpper: Number(pattern.upper.toFixed(2)),
    bollingerLower: Number(pattern.lower.toFixed(2)),
    kdjK: Number(pattern.k.toFixed(1)),
    kdjD: Number(pattern.d.toFixed(1)),
    kdjJ: Number(pattern.j.toFixed(1)),
    volumeRatio: Number(pattern.volumeRatio.toFixed(2)),
  };
}

async function buildMatches(stocks, institutionData, issuedSharesMap = new Map(), volumeAverageMap = new Map()) {
  const valueRanks = rankMap(stocks, "value");
  const volumeRanks = rankMap(stocks, "tradeVolume");
  const confluenceSources = readChipKConfluenceSources(institutionData);
  const baseRows = stocks.map((stock) => {
    const inst = institutionData[stock.code] || {};
    const valueRank = valueRanks.get(stock.code) || 0;
    const volumeRank = volumeRanks.get(stock.code) || 0;
    const close = cleanNumber(stock.close);
    const foreign = cleanNumber(inst.foreign);
    const trust = cleanNumber(inst.trust);
    const dealer = cleanNumber(inst.dealer);
    const total = cleanNumber(inst.total || (foreign + trust + dealer));
    const normalizedInst = { foreign, trust, dealer, total };
    const matches = [
      buildChipKConfluenceMatch({ stock, inst: normalizedInst, confluenceSources, valueRank, volumeRank }),
      buildStrategy5Match({ stock, inst: normalizedInst, valueRank, volumeRank }),
      buildVolumeTurnoverMatch({ stock, issuedSharesMap, volumeAverageMap }),
    ].filter(Boolean);
    const volumeTurnover = matches.find((match) => match.id === "volume_turnover_breakout");
    return {
      ...stock,
      valueRank,
      volumeRank,
      volumeLots: volumeTurnover?.volumeLots,
      turnoverRate: volumeTurnover?.turnoverRate,
      volumeRatio: volumeTurnover?.volumeRatio,
      inst: normalizedInst,
      matches,
    };
  });

  const strategy4Candidates = readStrategy4Candidates();
  const strategy4ByCode = new Map(strategy4Candidates.map((stock) => [String(stock.code || ""), stock]));
  const historyCandidates = baseRows
    .filter((stock) => cleanNumber(stock.close) >= 10 && stock.valueRank >= 35)
    .sort((a, b) => b.valueRank - a.valueRank || b.volumeRank - a.volumeRank || cleanNumber(b.percent) - cleanNumber(a.percent));
  const historyByCode = new Map();
  await mapLimit(historyCandidates, HISTORY_CONCURRENCY, async (stock) => {
    const rows = await fetchDailyHistory(stock);
    if (rows.length) historyByCode.set(stock.code, rows);
  });

  return baseRows.map((stock) => {
    const strategy4 = strategy4ByCode.get(stock.code) || {};
    const mergedStock = {
      ...stock,
      strategy4Score: cleanNumber(strategy4.swingScore || strategy4.score),
      strategy4Reason: strategy4.reason || "",
      strategy4Signals: strategy4.signals || strategy4.swingSignals || [],
    };
    const limitUpDoji = buildLimitUpDojiMatch({
      stock: mergedStock,
      valueRank: stock.valueRank,
      volumeRank: stock.volumeRank,
      rows: historyByCode.get(stock.code) || [],
    });
    const bollingerKdj = buildBollingerKdjMatch({
      stock: mergedStock,
      valueRank: stock.valueRank,
      volumeRank: stock.volumeRank,
      rows: historyByCode.get(stock.code) || [],
    });
    const matches = [...stock.matches, limitUpDoji, bollingerKdj].filter(Boolean);
    const sortedMatches = matches.sort((a, b) => (b.score || 0) - (a.score || 0));
    const score = sortedMatches.length ? Math.max(...sortedMatches.map((match) => match.score || 0)) : 0;
    return { ...mergedStock, score, matches: sortedMatches, activeMatch: sortedMatches[0] || null };
  })
    .filter((stock) => stock.matches.length && stock.activeMatch && stock.score && stock.close >= 10)
    .sort((a, b) => b.score - a.score || b.percent - a.percent || b.value - a.value)
    .slice(0, 80);
}

async function main() {
  const backup = readJson(BACKUP_FILE, { ok: true, matches: [] });
  const institution = readJson(INSTITUTION_FILE, { data: {} });
  const [stocks, issuedSharesResult, volumeAverageResult] = await Promise.all([
    fetchUniverse(),
    fetchIssuedShares(),
    fetchHistoricalVolumes(),
  ]);
  if (!stocks.length) throw new Error("No stock universe");
  const sourceWarnings = [
    ...issuedSharesResult.warnings,
    ...volumeAverageResult.warnings,
  ];
  sourceWarnings.forEach((warning) => console.warn(`strategy5 source warning: ${warning}`));
  const matches = await buildMatches(stocks, institution.data || {}, issuedSharesResult.map, volumeAverageResult.map);
  const quoteDate = institution.usedDate || institution.date || stocks.find((stock) => stock.quoteDate)?.quoteDate || "";
  const now = new Date();
  const output = {
    ok: true,
    source: USE_MIS_QUOTES ? "github-actions-mis-realtime" : "github-actions-official-daily",
    updatedAt: now.toISOString(),
    generatedDate: taipeiDateKey(now),
    usedDate: quoteDate,
    sourceDate: quoteDate,
    schedule: "06:00/21:00",
    fullScan: true,
    total: stocks.length,
    scannedThisRun: stocks.length,
    scannedCodes: stocks.map((stock) => stock.code),
    sourceHealth: {
      issuedSharesCount: issuedSharesResult.map.size,
      volumeAverageCount: volumeAverageResult.map.size,
      warningCount: sourceWarnings.length,
      warnings: sourceWarnings.slice(0, 8),
    },
    count: matches.length,
    matches,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  if (matches.length) fs.writeFileSync(BACKUP_FILE, `${JSON.stringify({ ...output, source: "github-actions-backup" }, null, 2)}\n`);
  else if ((backup.matches || []).length) fs.writeFileSync(OUT_FILE, `${JSON.stringify({ ...backup, source: "github-actions-backup-readonly" }, null, 2)}\n`);
  console.log(`strategy5 cache updated: matches ${matches.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});


