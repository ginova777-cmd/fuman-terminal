const fs = require("fs");
const path = require("path");
const { buildRanks, cleanNumber, detectSignals, isIntradayTradable } = require("./intraday-radar-rules");

const ROOT = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(ROOT, ".intraday-cache");
const SIGNAL_FILE = path.join(CACHE_DIR, "signals.json");
const SCORECARD_TRACK_FILE = path.join(CACHE_DIR, "scorecard-trades.json");
const STRATEGY2_REPORT_FILE = path.join(ROOT, "data", "strategy2-intraday-latest.json");
const STRATEGY2_HISTORY_DIR = path.join(ROOT, "data", "strategy2-intraday-history");
const OPEN_BUY_SCORECARD_SOURCE_FILE = path.join(ROOT, "data", "open-buy-scorecard-source.json");
const OPEN_BUY_FILE = path.join(ROOT, "data", "open-buy-latest.json");
const OPEN_BUY_BACKUP_FILE = path.join(ROOT, "data", "open-buy-backup.json");
const STRATEGY3_SCORECARD_SOURCE_FILE = path.join(ROOT, "data", "strategy3-scorecard-source.json");
const STRATEGY3_FILE = path.join(ROOT, "data", "strategy3-latest.json");
const STRATEGY3_BACKUP_FILE = path.join(ROOT, "data", "strategy3-backup.json");
const BASE_URL = process.env.FUMAN_BASE_URL || "https://fuman-terminal.vercel.app";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function taipeiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function dateKey(parts = taipeiParts()) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function timestampKey(parts = taipeiParts()) {
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function compactDateKey(value, fallback) {
  const text = String(value || fallback || "");
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const dashed = text.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (dashed) return `${dashed[1]}-${dashed[2]}-${dashed[3]}`;
  return fallback;
}

function readScorecardSource(sourceFile, latestFile, backupFile) {
  const source = readJson(sourceFile, { ok: true, matches: [] });
  if ((source.matches || []).length) return source;
  const latest = readJson(latestFile, { ok: true, matches: [] });
  if ((latest.matches || []).length) return latest;
  return readJson(backupFile, latest);
}

function updateTrackedExtremes(cache, stock, timestamp, key) {
  const high = cleanNumber(stock.high) || cleanNumber(stock.close);
  const low = cleanNumber(stock.low) || cleanNumber(stock.close);
  const close = cleanNumber(stock.close);
  cache.records
    .filter((record) => record.date === key && record.code === stock.code)
    .forEach((record) => {
      const currentHigh = cleanNumber(record.observedHigh);
      const currentLow = cleanNumber(record.observedLow);
      record.observedPrice = close || record.observedPrice;
      record.volume = cleanNumber(stock.tradeVolume) || record.volume;
      record.percent = cleanNumber(stock.percent) || record.percent;
      if (high && (!currentHigh || high > currentHigh)) {
        record.observedHigh = high;
        record.observedHighAt = timestamp;
      }
      if (low && (!currentLow || low < currentLow)) {
        record.observedLow = low;
        record.observedLowAt = timestamp;
      }
    });
}

function ensureTradeTrack(tracker, group, item, stock, timestamp, key) {
  const code = String(item.code || stock.code || "");
  if (!code) return null;
  const trackKey = `${group}:${code}`;
  const current = tracker.trades[trackKey] || {};
  const open = cleanNumber(stock.open);
  const close = cleanNumber(stock.close);
  const high = cleanNumber(stock.high) || close;
  const low = cleanNumber(stock.low) || close;
  const yesterdayKey = compactDateKey(item.quoteDate, key);
  const entryPrice = cleanNumber(current.entryPrice)
    || (group === "openBuy" ? open : 0)
    || (group === "strategy3" ? cleanNumber(item.close) : 0)
    || open
    || cleanNumber(item.close)
    || close;
  const entryAt = current.entryAt || (group === "strategy3" ? `${yesterdayKey} 13:30:00` : `${key} 09:00:00`);
  const next = {
    ...current,
    date: key,
    group,
    code,
    name: item.name || stock.name || current.name || code,
    sourceUpdatedAt: item.updatedAt || current.sourceUpdatedAt || "",
    entryAt,
    entryPrice,
    observedPrice: close || current.observedPrice,
    volume: cleanNumber(stock.tradeVolume) || current.volume,
    percent: cleanNumber(stock.percent) || current.percent,
  };
  const currentHigh = cleanNumber(next.observedHigh);
  const currentLow = cleanNumber(next.observedLow);
  if (high && (!currentHigh || high > currentHigh)) {
    next.observedHigh = high;
    next.observedHighAt = timestamp;
  }
  if (low && (!currentLow || low < currentLow)) {
    next.observedLow = low;
    next.observedLowAt = timestamp;
  }
  tracker.trades[trackKey] = next;
  return next;
}

function updateScorecardTradeTracks(tracker, liveStocks, timestamp, key) {
  if (tracker.date !== key) {
    tracker.date = key;
    tracker.trades = {};
  }
  const stockMap = new Map(liveStocks.map((stock) => [stock.code, stock]));
  const sources = [
    ["openBuy", readScorecardSource(OPEN_BUY_SCORECARD_SOURCE_FILE, OPEN_BUY_FILE, OPEN_BUY_BACKUP_FILE)],
    ["strategy3", readScorecardSource(STRATEGY3_SCORECARD_SOURCE_FILE, STRATEGY3_FILE, STRATEGY3_BACKUP_FILE)],
  ];
  sources.forEach(([group, payload]) => {
    (payload.matches || []).forEach((item) => {
      const stock = stockMap.get(String(item.code || ""));
      if (stock) ensureTradeTrack(tracker, group, item, stock, timestamp, key);
    });
  });
  tracker.updatedAt = new Date().toISOString();
}

function timeLabel(value) {
  const match = String(value || "").match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
  return match ? `${match[1]}:${match[2]}${match[3] ? `:${match[3]}` : ""}` : "";
}

function mergeStrategy2Events(records, key) {
  const events = {};
  records
    .filter((record) => record.date === key)
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || String(a.code).localeCompare(String(b.code)))
    .forEach((record) => {
      const code = String(record.code || "");
      if (!code) return;
      const current = events[code] || {
        code,
        name: record.name || code,
        date: key,
        firstBAt: "",
        firstBPrice: 0,
        highAfterB: 0,
        firstAAt: "",
        firstAPrice: 0,
        highAfterA: 0,
        highestPrice: 0,
        latestState: "",
        maxScore: 0,
        strategies: [],
        enhancements: [],
        stateReason: "",
        supportPrice: 0,
      };
      const price = cleanNumber(record.entryPrice) || cleanNumber(record.observedPrice);
      const observedHigh = cleanNumber(record.observedHigh) || cleanNumber(record.observedPrice) || price;
      if (!current.firstBAt) {
        current.firstBAt = timeLabel(record.entryAt || record.timestamp);
        current.firstBPrice = price;
        current.highAfterB = observedHigh || price;
      }
      if (current.firstBAt && observedHigh > cleanNumber(current.highAfterB)) {
        current.highAfterB = observedHigh;
      }
      if (record.stateId === "go" && !current.firstAAt) {
        current.firstAAt = timeLabel(record.entryAt || record.timestamp);
        current.firstAPrice = price;
        current.highAfterA = observedHigh || price;
      }
      if (current.firstAAt && observedHigh > cleanNumber(current.highAfterA)) {
        current.highAfterA = observedHigh;
      }
      if (observedHigh > cleanNumber(current.highestPrice)) {
        current.highestPrice = observedHigh;
      }
      if (record.strategy && !current.strategies.includes(record.strategy)) {
        current.strategies.push(record.strategy);
      }
      const previousMaxScore = cleanNumber(current.maxScore);
      const recordScore = cleanNumber(record.score);
      const deltaVolume = cleanNumber(record.deltaVolume);
      const enhancementText = `${record.strategy || ""} ${record.reason || ""}`;
      const isAEnhancement = current.firstAAt
        && eventTime
        && eventTime !== current.firstAAt
        && record.stateId === "go"
        && (
          deltaVolume >= 0
          || /急拉爆量|分時爆量|分時放大|持續放量|爆量|放大/.test(enhancementText)
          || (recordScore && previousMaxScore && recordScore >= previousMaxScore)
        );
      if (isAEnhancement && !current.enhancements.some((item) => item.at === eventTime)) {
        current.enhancements.push({
          at: eventTime,
          price: price || cleanNumber(record.observedPrice),
          score: recordScore,
          deltaVolume,
          totalVolume: cleanNumber(record.volume),
          strategy: "持續放量",
          reason: `${record.name || code} 持續放量`,
        });
      }
      current.latestState = record.stateId === "go" ? "go" : "wait";
      current.maxScore = Math.max(previousMaxScore, recordScore);
      current.stateReason = record.stateReason || current.stateReason;
      current.supportPrice = cleanNumber(current.supportPrice) || cleanNumber(record.supportPrice);
      events[code] = current;
    });
  return Object.values(events).sort((a, b) => {
    if (!!b.firstAAt !== !!a.firstAAt) return b.firstAAt ? 1 : -1;
    return cleanNumber(b.maxScore) - cleanNumber(a.maxScore) || String(a.code).localeCompare(String(b.code));
  });
}

function inferLegacyRecordState(record) {
  const pct = cleanNumber(record.percent);
  const volume = cleanNumber(record.volume);
  const observedPrice = cleanNumber(record.observedPrice);
  const observedHigh = cleanNumber(record.observedHigh) || observedPrice;
  const strategy = String(record.strategy || "");
  const reason = String(record.reason || "");
  const nearHigh = observedHigh && observedPrice ? observedPrice >= observedHigh * 0.985 : true;
  const hasTrigger = /轉強|突破|跳空|鑽石|MA35|買點|爆量|放大/.test(strategy + reason);
  const liquid = volume >= 2000;

  if (liquid && hasTrigger && nearHigh && pct >= 2 && pct <= 8.8) {
    return {
      stateId: "go",
      stateLabel: "A區 可進場",
      stateReason: "量勢、價位與觸發訊號同步，偏可進場。",
      score: cleanNumber(record.score) || Math.min(100, Math.round(pct * 8 + 56)),
    };
  }
  if ((volume >= 1000 || hasTrigger) && pct >= 2) {
    return {
      stateId: "wait",
      stateLabel: "B區 待確認",
      stateReason: "已有訊號，但仍需等站穩或再放量。",
      score: cleanNumber(record.score) || Math.min(88, Math.round(pct * 8 + 42)),
    };
  }
  return {
    stateId: "watch",
    stateLabel: "C區 觀察",
    stateReason: "量能或型態尚未完全到位。",
    score: cleanNumber(record.score) || Math.min(70, Math.round(Math.max(pct, 0) * 8 + 28)),
  };
}

function normalizeStrategy2Records(records) {
  return (records || []).map((record) => {
    if (record.stateId && record.stateLabel) return record;
    return {
      ...record,
      ...inferLegacyRecordState(record),
    };
  });
}

async function fetchJson(url, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "FumanIntradayScorecard/1.0" } });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchStocks() {
  try {
    const market = await fetchJson(`${BASE_URL}/api/market?t=${Date.now()}`, 30000);
    if (Array.isArray(market?.stocks) && market.stocks.length) {
      return market.stocks.map((stock) => ({
        code: String(stock.code || ""),
        name: String(stock.name || ""),
        close: cleanNumber(stock.close),
        change: cleanNumber(stock.change),
        percent: cleanNumber(stock.pct ?? stock.percent),
        value: cleanNumber(stock.value),
        tradeVolume: cleanNumber(stock.volume ?? stock.tradeVolume),
      })).filter((stock) => stock.code && stock.name);
    }
  } catch {}

  const payload = await fetchJson("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL", 30000);
  return payload.map((stock) => {
    const close = cleanNumber(stock.ClosingPrice || stock["收盤價"]);
    const change = cleanNumber(stock.Change || stock["漲跌價差"]);
    const prevClose = close - change;
    return {
      code: String(stock.Code || stock["證券代號"] || ""),
      name: String(stock.Name || stock["證券名稱"] || ""),
      close,
      change,
      percent: prevClose ? (change / prevClose) * 100 : 0,
      value: cleanNumber(stock.TradeValue || stock["成交金額"]),
      tradeVolume: cleanNumber(stock.TradeVolume || stock["成交股數"]),
    };
  }).filter((stock) => stock.code && stock.name && stock.close);
}

async function fetchRealtime(stocks) {
  const quotes = new Map();
  const batchSize = 100;
  for (let i = 0; i < stocks.length; i += batchSize) {
    const codes = stocks.slice(i, i + batchSize).map((stock) => stock.code);
    if (!codes.length) continue;
    try {
      const payload = await fetchJson(`${BASE_URL}/api/realtime?codes=${encodeURIComponent(codes.join(","))}&t=${Date.now()}`, 20000);
      (payload.quotes || []).forEach((quote) => quotes.set(quote.code, quote));
    } catch (error) {
      console.log(`realtime batch failed ${codes[0]}-${codes.at(-1)}: ${error.message}`);
    }
  }
  return stocks.map((stock) => {
    const quote = quotes.get(stock.code);
    if (!quote?.close) return stock;
    const value = cleanNumber(quote.tradeVolume) && cleanNumber(quote.close)
      ? cleanNumber(quote.tradeVolume) * cleanNumber(quote.close)
      : stock.value;
    return { ...stock, ...quote, value, isRealtime: true };
  });
}

async function main() {
  const parts = taipeiParts();
  const key = dateKey(parts);
  const cache = readJson(SIGNAL_FILE, { date: key, records: [], previous: {} });
  const scorecardTracker = readJson(SCORECARD_TRACK_FILE, { date: key, trades: {} });
  if (cache.date !== key) {
    cache.date = key;
    cache.records = [];
    cache.previous = {};
  }

  const rawStocks = await fetchStocks();
  const liveStocks = (await fetchRealtime(rawStocks)).filter(isIntradayTradable);
  const ranks = buildRanks(liveStocks);
  const timestamp = timestampKey(parts);
  let added = 0;

  updateScorecardTradeTracks(scorecardTracker, liveStocks, timestamp, key);

  for (const stock of liveStocks) {
    updateTrackedExtremes(cache, stock, timestamp, key);
    const previous = cache.previous[stock.code] || null;
    const signals = detectSignals(stock, previous || { tradeVolume: stock.tradeVolume }, ranks);
    cache.previous[stock.code] = {
      close: stock.close,
      high: stock.high,
      low: stock.low,
      tradeVolume: stock.tradeVolume,
      percent: stock.percent,
    };
    signals.forEach((signal) => {
      const duplicate = cache.records.some((record) => (
        record.code === stock.code &&
        record.strategy === signal.label &&
        record.timestamp === timestamp
      ));
      if (duplicate) return;
      cache.records.push({
        date: key,
        timestamp,
        entryAt: timestamp,
        code: stock.code,
        name: stock.name,
        strategy: signal.label,
        stateId: signal.stateId,
        stateLabel: signal.stateLabel,
        stateReason: signal.stateReason,
        score: signal.score,
        entryPrice: signal.entryPrice,
        supportPrice: signal.supportPrice,
        entryLow: signal.entryLow,
        entryHigh: signal.entryHigh,
        stopLoss: signal.stopLoss,
        chaseLimit: signal.chaseLimit,
        observedPrice: stock.close,
        observedHigh: stock.high || stock.close,
        observedHighAt: timestamp,
        observedLow: stock.low || stock.close,
        observedLowAt: timestamp,
        volume: stock.tradeVolume,
        percent: stock.percent,
        reason: signal.reason,
        signalId: signal.id,
        deltaVolume: signal.deltaVolume,
        volumeMilestone: signal.volumeMilestone,
      });
      added += 1;
    });
  }

  cache.records = normalizeStrategy2Records(cache.records || []);
  cache.updatedAt = new Date().toISOString();
  const strategy2Events = mergeStrategy2Events(cache.records || [], key);
  writeJson(SIGNAL_FILE, cache);
  writeJson(STRATEGY2_REPORT_FILE, {
    source: "strategy2-09-to-1330-patrol",
    date: key,
    updatedAt: cache.updatedAt,
    records: cache.records,
    events: strategy2Events,
    aCount: strategy2Events.filter((event) => event.firstAAt).length,
    bOnlyCount: strategy2Events.filter((event) => !event.firstAAt && event.firstBAt).length,
  });
  writeJson(path.join(STRATEGY2_HISTORY_DIR, `${key}.json`), {
    source: "strategy2-09-to-1330-patrol",
    date: key,
    updatedAt: cache.updatedAt,
    records: cache.records,
    events: strategy2Events,
    aCount: strategy2Events.filter((event) => event.firstAAt).length,
    bOnlyCount: strategy2Events.filter((event) => !event.firstAAt && event.firstBAt).length,
  });
  writeJson(SCORECARD_TRACK_FILE, scorecardTracker);
  console.log(`intraday signals ${key}: added ${added}, total ${cache.records.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
