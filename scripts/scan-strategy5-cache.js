const fs = require("fs");
const path = require("path");
const { fetchMisQuotes } = require("../lib/mis-quotes");

const { ROOT, dataPath } = require("./runtime-paths");
const OUT_FILE = dataPath("strategy5-latest.json");
const BACKUP_FILE = dataPath("strategy5-backup.json");
const INSTITUTION_FILE = dataPath("institution-latest.json");
const STRATEGY4_FILE = dataPath("strategy4-latest.json");
const STRATEGY4_BACKUP_FILE = dataPath("strategy4-backup.json");
const STOCK_URL = process.env.STOCK_UNIVERSE_URL || "https://fuman-terminal.vercel.app/api/stocks";
const USE_MIS_QUOTES = process.env.STRATEGY5_USE_MIS === "1";
const HISTORY_LIMIT = Math.max(20, Number(process.env.STRATEGY5_HISTORY_LIMIT || 900));
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
  if (!USE_MIS_QUOTES) return base;
  const quotes = await fetchMisQuotes(base.map((stock) => stock.code));
  return base.map((stock) => {
    const quote = quotes.get(stock.code);
    return quote ? { ...stock, ...quote, name: quote.name || stock.name } : stock;
  });
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

function avg(values) {
  const nums = values.filter((value) => Number.isFinite(value) && value > 0);
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : 0;
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

async function buildMatches(stocks, institutionData) {
  const valueRanks = rankMap(stocks, "value");
  const volumeRanks = rankMap(stocks, "tradeVolume");
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
      buildStrategy5Match({ stock, inst: normalizedInst, valueRank, volumeRank }),
    ].filter(Boolean);
    return {
      ...stock,
      valueRank,
      volumeRank,
      inst: normalizedInst,
      matches,
    };
  });

  const strategy4Candidates = readStrategy4Candidates();
  const strategy4ByCode = new Map(strategy4Candidates.map((stock) => [String(stock.code || ""), stock]));
  const strategy4HistoryCandidates = strategy4Candidates
    .map((item) => {
      const base = baseRows.find((stock) => stock.code === String(item.code || ""));
      if (!base) return null;
      return {
        ...base,
        strategy4Score: cleanNumber(item.swingScore || item.score),
        strategy4Reason: item.reason || "",
        strategy4Signals: item.signals || item.swingSignals || [],
      };
    })
    .filter(Boolean)
    .sort((a, b) => cleanNumber(b.strategy4Score) - cleanNumber(a.strategy4Score) || b.valueRank - a.valueRank || b.volumeRank - a.volumeRank);
  const fallbackHistoryCandidates = baseRows
    .filter((stock) => cleanNumber(stock.close) >= 10 && stock.valueRank >= 20 && stock.volumeRank >= 20)
    .sort((a, b) => b.valueRank - a.valueRank || b.volumeRank - a.volumeRank || cleanNumber(b.percent) - cleanNumber(a.percent));
  const historyCandidates = (strategy4HistoryCandidates.length ? strategy4HistoryCandidates : fallbackHistoryCandidates)
    .slice(0, HISTORY_LIMIT);
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
    const matches = [...stock.matches, limitUpDoji].filter(Boolean);
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
  const stocks = await fetchUniverse();
  if (!stocks.length) throw new Error("No stock universe");
  const matches = await buildMatches(stocks, institution.data || {});
  const quoteDate = institution.usedDate || institution.date || stocks.find((stock) => stock.quoteDate)?.quoteDate || "";
  const output = {
    ok: true,
    source: USE_MIS_QUOTES ? "github-actions-mis-realtime" : "github-actions-official-daily",
    updatedAt: new Date().toISOString(),
    usedDate: quoteDate,
    schedule: "06:00/21:00",
    fullScan: true,
    total: stocks.length,
    scannedThisRun: stocks.length,
    scannedCodes: stocks.map((stock) => stock.code),
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


