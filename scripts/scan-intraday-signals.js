const fs = require("fs");
const path = require("path");
const { buildRanks, cleanNumber, detectSignals, isIntradayTradable, ma35SourceLabel } = require("./intraday-radar-rules");
const { rotateStrategy2IntradayCache } = require("./strategy2-cache-rotation");

const { ROOT, dataPath, cachePath, repoPath } = require("./runtime-paths");
const CACHE_DIR = cachePath("intraday");
const SIGNAL_FILE = path.join(CACHE_DIR, "signals.json");
const SCORECARD_TRACK_FILE = path.join(CACHE_DIR, "scorecard-trades.json");
const STRATEGY5_TRACK_FILE = path.join(CACHE_DIR, "strategy5-scorecard-trades.json");
const STRATEGY2_REPORT_FILE = dataPath("strategy2-intraday-latest.json");
const STRATEGY2_HISTORY_DIR = dataPath("strategy2-intraday-history");
const OPEN_BUY_SCORECARD_SOURCE_FILE = dataPath("open-buy-scorecard-source.json");
const OPEN_BUY_FILE = dataPath("open-buy-latest.json");
const OPEN_BUY_BACKUP_FILE = dataPath("open-buy-backup.json");
const STRATEGY3_SCORECARD_SOURCE_FILE = dataPath("strategy3-scorecard-source.json");
const STRATEGY3_FILE = dataPath("strategy3-latest.json");
const STRATEGY3_BACKUP_FILE = dataPath("strategy3-backup.json");
const STRATEGY5_FILE = dataPath("strategy5-latest.json");
const STRATEGY5_BACKUP_FILE = dataPath("strategy5-backup.json");
const BASE_URL = process.env.FUMAN_BASE_URL || "https://fuman-terminal.vercel.app";
const MANAGER_MIN_ENTRY_TIME = process.env.TRADE_MANAGER_MIN_ENTRY_TIME || "09:05:00";
const MAX_QUOTE_AGE_SECONDS = Number(process.env.STRATEGY2_MAX_QUOTE_AGE_SECONDS || 150);
const MIN_REALTIME_COVERAGE = Number(process.env.STRATEGY2_MIN_REALTIME_COVERAGE || 0.5);
const REALTIME_BATCH_SIZE = Number(process.env.STRATEGY2_REALTIME_BATCH_SIZE || 80);
const REALTIME_RETRY_BATCH_SIZE = Number(process.env.STRATEGY2_REALTIME_RETRY_BATCH_SIZE || 20);
const MA35_PROVIDER_FAILURE_LIMIT = Math.max(1, Number(process.env.STRATEGY2_MA35_PROVIDER_FAILURE_LIMIT || 8));

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const FUGLE_API_KEY = process.env.FUGLE_API_KEY
  || process.env.FUGLE_MARKETDATA_API_KEY
  || readSecretText(path.join(ROOT, "secrets", "fugle-api-key.txt"))
  || readSecretText(path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "secrets", "fugle-api-key.txt"));
const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY
  || process.env.TWELVEDATA_API_KEY
  || readSecretText(path.join(ROOT, "secrets", "twelve-data-api-key.txt"))
  || readSecretText(path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "secrets", "twelve-data-api-key.txt"));
let yahooMa35Failures = 0;
let fugleMa35Failures = 0;
let yahooMa35BlockedReason = "";
let fugleMa35BlockedReason = "";
let twelveDataBlockedReason = "";

function disableMa35Provider(provider, reason) {
  if (provider === "yahoo" && !yahooMa35BlockedReason) {
    yahooMa35BlockedReason = reason;
    console.log(`sma35 1m yahoo disabled for this scan: ${reason}`);
  }
  if (provider === "fugle" && !fugleMa35BlockedReason) {
    fugleMa35BlockedReason = reason;
    console.log(`sma35 1m fugle disabled for this scan: ${reason}`);
  }
}

function noteMa35ProviderFailure(provider, reason) {
  if (provider === "yahoo") {
    yahooMa35Failures += 1;
    if (yahooMa35Failures >= MA35_PROVIDER_FAILURE_LIMIT) disableMa35Provider("yahoo", `${reason || "failed"}-${yahooMa35Failures}`);
  }
  if (provider === "fugle") {
    fugleMa35Failures += 1;
    if (/HTTP (?:401|403|429)/i.test(reason || "")) disableMa35Provider("fugle", reason);
    if (fugleMa35Failures >= MA35_PROVIDER_FAILURE_LIMIT) disableMa35Provider("fugle", `${reason || "failed"}-${fugleMa35Failures}`);
  }
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function avg(values) {
  const rows = values.map(cleanNumber).filter((value) => value > 0);
  return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : 0;
}

function emaSeries(values, length) {
  const nums = values.map(cleanNumber);
  const k = 2 / (length + 1);
  const out = [];
  nums.forEach((value, index) => {
    out[index] = index === 0 ? value : value * k + out[index - 1] * (1 - k);
  });
  return out;
}

function macdInfo(values) {
  const closes = values.map(cleanNumber).filter((value) => value > 0);
  if (closes.length < 35) return {};
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const dif = closes.map((_, index) => (ema12[index] || 0) - (ema26[index] || 0));
  const dea = emaSeries(dif, 9);
  const last = dif.length - 1;
  const prev = dif.length - 2;
  const hist = dif[last] - dea[last];
  const prevHist = dif[prev] - dea[prev];
  return {
    macdDif: dif[last],
    macdSignal: dea[last],
    macdHist: hist,
    macdDifPrev: dif[prev],
    macdSignalPrev: dea[prev],
    macdHistPrev: prevHist,
    macdUp: dif[last] > dif[prev] && dea[last] >= dea[prev] && hist >= prevHist,
  };
}

function kdInfo(rows) {
  const sorted = rows.filter((row) => cleanNumber(row.high) > 0 && cleanNumber(row.low) > 0 && cleanNumber(row.close) > 0);
  if (sorted.length < 10) return {};
  let k = 50;
  let d = 50;
  let prevK = k;
  let prevD = d;
  for (let index = 0; index < sorted.length; index++) {
    const start = Math.max(0, index - 8);
    const window = sorted.slice(start, index + 1);
    const high = Math.max(...window.map((row) => cleanNumber(row.high)));
    const low = Math.min(...window.map((row) => cleanNumber(row.low)));
    const close = cleanNumber(sorted[index].close);
    const rsv = high > low ? ((close - low) / (high - low)) * 100 : 50;
    prevK = k;
    prevD = d;
    k = (prevK * 2 + rsv) / 3;
    d = (prevD * 2 + k) / 3;
  }
  return {
    kdK: k,
    kdD: d,
    kdKPrev: prevK,
    kdDPrev: prevD,
    kdUp: k > prevK && d >= prevD && k >= d,
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function publishStaticDataJson(name, value) {
  if (name === "strategy2-intraday-latest.json") return;
  const targets = [repoPath("data", name)];
  const syncRoot = process.env.FUMAN_SYNC_DIR || "C:\\fuman-terminal-sync";
  if (fs.existsSync(syncRoot)) targets.push(path.join(syncRoot, "data", name));
  [...new Set(targets.map((file) => path.resolve(file)))].forEach((file) => {
    if (file === path.resolve(dataPath(name))) return;
    writeJson(file, value);
  });
}

function normalizeVolumeLots(value) {
  const number = cleanNumber(value);
  if (!number) return 0;
  return number > 100000 ? Math.round(number / 1000) : number;
}

function classifyStrategy2State(stock, signal) {
  const pct = cleanNumber(stock.percent);
  const volume = cleanNumber(stock.tradeVolume);
  const close = cleanNumber(stock.close);
  const high = cleanNumber(stock.high) || close;
  const open = cleanNumber(stock.open);
  const hasIntradaySma35 = /(?:yahoo|fugle|twelve|local)-1m/.test(String(signal.ma35Source || "")) && cleanNumber(signal.ma35) > 0;
  const strictMa35Entry = signal.id === "ma35_buy"
    && signal.aboveMa35 === true
    && hasIntradaySma35
    && signal.macdUp === true
    && signal.kdUp === true
    && signal.intradayVolumeBurst === true;
  const earlyEntrySignal = new Set(["volume_burst", "limit_lock", "gap", "breakout", "diamond"]).has(String(signal.id || ""));
  const nearHigh = high > 0 && close > 0 ? close >= high * 0.985 : true;
  const aboveOpen = !open || close >= open;
  const fallbackEntry = earlyEntrySignal
    && pct >= 2
    && pct <= 8.8
    && volume >= 2000
    && nearHigh
    && aboveOpen;
  if (!strictMa35Entry && !fallbackEntry) return null;
  const score = Math.min(100, Math.round(pct * 8 + (volume >= 10000 ? 56 : 42) + (earlyEntrySignal ? 6 : 0)));
  return {
    stateId: "entry",
    stateLabel: "進場區",
    stateReason: strictMa35Entry
      ? `1分K站上MA35，MACD/KD同步向上且爆量，偏進場區。MA35來源：${ma35SourceLabel(signal.ma35Source)}。`
      : `${signal.label || "盤中轉強"}，量價符合當沖進場區。`,
    score,
  };
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

function secondsOfDay(value) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}

function quoteAgeSeconds(scanTimestamp, quoteTime) {
  const scanSeconds = secondsOfDay(scanTimestamp);
  const quoteSeconds = secondsOfDay(quoteTime);
  if (scanSeconds == null || quoteSeconds == null) return null;
  return Math.abs(scanSeconds - quoteSeconds);
}

function hasFreshQuote(stock, scanTimestamp) {
  const age = quoteAgeSeconds(scanTimestamp, stock.quoteTime || stock.time);
  return age != null && age <= MAX_QUOTE_AGE_SECONDS;
}

function isMarketTime(parts = taipeiParts()) {
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 && minutes <= 13 * 60 + 45;
}

function compactDateKey(value, fallback) {
  const text = String(value || fallback || "");
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const dashed = text.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (dashed) return `${dashed[1]}-${dashed[2]}-${dashed[3]}`;
  return fallback;
}

function compactTradeDate(value) {
  return String(compactDateKey(value, "") || "").replace(/\D/g, "");
}

function previousWeekdayCompact(value) {
  const compact = compactTradeDate(value);
  const match = compact.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  do {
    date.setUTCDate(date.getUTCDate() - 1);
  } while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function payloadTradeDate(payload) {
  return compactTradeDate(payload?.usedDate || payload?.date || payload?.quoteDate || payload?.matches?.[0]?.quoteDate);
}

function readScorecardSource(sourceFile, latestFile, backupFile) {
  const source = readJson(sourceFile, { ok: true, matches: [] });
  if ((source.matches || []).length) return source;
  const latest = readJson(latestFile, { ok: true, matches: [] });
  if ((latest.matches || []).length) return latest;
  return readJson(backupFile, latest);
}

function readStrategy3ScorecardSource(today) {
  const expectedDate = previousWeekdayCompact(today);
  const empty = { ok: true, matches: [] };
  for (const payload of [
    readJson(STRATEGY3_SCORECARD_SOURCE_FILE, empty),
    readJson(STRATEGY3_FILE, empty),
    readJson(STRATEGY3_BACKUP_FILE, empty),
  ]) {
    if ((payload.matches || []).length && payloadTradeDate(payload) === expectedDate) return payload;
  }
  return empty;
}

function readStrategy5ScorecardSource(today) {
  const expectedDate = previousWeekdayCompact(today);
  const empty = { ok: true, matches: [] };
  for (const payload of [
    readJson(STRATEGY5_FILE, empty),
    readJson(STRATEGY5_BACKUP_FILE, empty),
  ]) {
    if ((payload.matches || []).length && payloadTradeDate(payload) === expectedDate) return payload;
  }
  return empty;
}

function updateTrackedExtremes(cache, stock, timestamp, key) {
  const high = cleanNumber(stock.high) || cleanNumber(stock.close);
  const low = cleanNumber(stock.low) || cleanNumber(stock.close);
  const close = cleanNumber(stock.close);
  const latest = cache.records
    .filter((record) => record.date === key && record.code === stock.code)
    .sort((a, b) => String(a.timestamp || a.entryAt || "").localeCompare(String(b.timestamp || b.entryAt || "")))
    .at(-1);
  if (!latest) return;
  const currentDayHigh = cleanNumber(latest.dayHigh);
  const currentDayLow = cleanNumber(latest.dayLow);
  latest.observedPrice = close || latest.observedPrice;
  latest.observedHigh = close || latest.observedHigh;
  latest.observedHighAt = timestamp;
  latest.observedLow = close || latest.observedLow;
  latest.observedLowAt = timestamp;
  latest.currentVolume = cleanNumber(stock.tradeVolume) || latest.currentVolume || latest.volume;
  latest.currentPercent = cleanNumber(stock.percent) || latest.currentPercent || latest.percent;
  if (high && (!currentDayHigh || high > currentDayHigh)) {
    latest.dayHigh = high;
    latest.dayHighAt = timestamp;
  }
  if (low && (!currentDayLow || low < currentDayLow)) {
    latest.dayLow = low;
    latest.dayLowAt = timestamp;
  }
}

function appendTrackedSnapshot(cache, stock, timestamp, key) {
  const rows = cache.records
    .filter((record) => record.date === key && record.code === stock.code)
    .sort((a, b) => String(a.timestamp || a.entryAt || "").localeCompare(String(b.timestamp || b.entryAt || "")));
  const latest = rows.at(-1);
  if (!latest) return false;
  if (String(latest.timestamp || latest.entryAt || "") === timestamp) return false;

  const close = cleanNumber(stock.close) || cleanNumber(latest.observedPrice || latest.entryPrice);
  const high = cleanNumber(stock.high) || close;
  const low = cleanNumber(stock.low) || close;
  const volume = cleanNumber(stock.tradeVolume) || cleanNumber(latest.currentVolume || latest.volume);
  const previousVolume = cleanNumber(latest.currentVolume || latest.volume);
  const percent = cleanNumber(stock.percent) || cleanNumber(latest.currentPercent || latest.percent);

  cache.records.push({
    ...latest,
    timestamp,
    entryAt: timestamp,
    entryPrice: close || cleanNumber(latest.entryPrice),
    observedPrice: close,
    observedHigh: close,
    observedHighAt: timestamp,
    observedLow: close,
    observedLowAt: timestamp,
    dayHigh: high,
    dayHighAt: timestamp,
    dayLow: low,
    dayLowAt: timestamp,
    currentVolume: volume,
    currentPercent: percent,
    volume,
    percent,
    deltaVolume: Math.max(0, volume - previousVolume),
    isSnapshot: true,
  });
  return true;
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

function strategy5EntrySignal(item, stock) {
  const close = cleanNumber(stock.close);
  const open = cleanNumber(stock.open);
  const high = cleanNumber(stock.high) || close;
  const volume = cleanNumber(stock.tradeVolume);
  const value = cleanNumber(stock.value) || close * volume * 1000;
  const percent = cleanNumber(stock.percent);
  const sourceScore = cleanNumber(item.score);
  const reasons = [];
  if (!close) reasons.push("無即時價");
  if (percent < 2) reasons.push(`漲幅${percent.toFixed(2)}%不足`);
  if (percent > 8) reasons.push(`漲幅${percent.toFixed(2)}%過熱`);
  if (volume < 2000) reasons.push(`成交量${Math.round(volume)}張不足`);
  if (value < 80000000) reasons.push("成交金額不足");
  if (open && close < open) reasons.push("尚未站回開盤價");
  if (high && close < high * 0.985) reasons.push("現價離盤中高點太遠");
  return {
    pass: reasons.length === 0,
    reasons,
    score: sourceScore || 100,
    reason: reasons.length ? reasons.join("；") : "策略5前日名單，盤中量價符合管家條件",
  };
}

function ensureStrategy5Track(tracker, item, stock, timestamp, key) {
  const code = String(item.code || stock.code || "");
  if (!code) return null;
  const trackKey = `strategy5:${code}`;
  const current = tracker.trades[trackKey] || {};
  const close = cleanNumber(stock.close);
  const high = cleanNumber(stock.high) || close;
  const low = cleanNumber(stock.low) || close;
  const volume = cleanNumber(stock.tradeVolume);
  const percent = cleanNumber(stock.percent);
  if (!current.entryAt) {
    const signal = strategy5EntrySignal(item, stock);
    if (!signal.pass) return null;
    current.entryAt = timestamp;
    current.entryPrice = close;
    current.entryReason = signal.reason;
    current.score = signal.score;
  }
  const next = {
    ...current,
    date: key,
    group: "strategy5",
    code,
    name: item.name || stock.name || current.name || code,
    sourceDate: compactTradeDate(item.quoteDate || item.date),
    sourceReason: item.activeMatch?.reason || item.matches?.[0]?.reason || item.reason || "",
    observedPrice: close || current.observedPrice,
    volume: volume || current.volume,
    percent: percent || current.percent,
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

function updateScorecardTradeTracks(tracker, strategy5Tracker, liveStocks, timestamp, key) {
  if (tracker.date !== key) {
    tracker.date = key;
    tracker.trades = {};
  }
  if (strategy5Tracker.date !== key) {
    strategy5Tracker.date = key;
    strategy5Tracker.trades = {};
  }
  const stockMap = new Map(liveStocks.map((stock) => [stock.code, stock]));
  const sources = [
    ["openBuy", readScorecardSource(OPEN_BUY_SCORECARD_SOURCE_FILE, OPEN_BUY_FILE, OPEN_BUY_BACKUP_FILE)],
    ["strategy3", readStrategy3ScorecardSource(key)],
  ];
  sources.forEach(([group, payload]) => {
    (payload.matches || []).forEach((item) => {
      const stock = stockMap.get(String(item.code || ""));
      if (stock) ensureTradeTrack(tracker, group, item, stock, timestamp, key);
    });
  });
  const strategy5Payload = readStrategy5ScorecardSource(key);
  (strategy5Payload.matches || []).forEach((item) => {
    const stock = stockMap.get(String(item.code || ""));
    if (stock) ensureStrategy5Track(strategy5Tracker, item, stock, timestamp, key);
  });
  tracker.updatedAt = new Date().toISOString();
  strategy5Tracker.updatedAt = tracker.updatedAt;
}

function timeLabel(value) {
  const match = String(value || "").match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
  return match ? `${match[1]}:${match[2]}${match[3] ? `:${match[3]}` : ""}` : "";
}

function timeValue(value) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}

function recordTimeLabel(record) {
  return timeLabel(record.entryAt || record.timestamp);
}

function isEntryState(record) {
  return record?.stateId === "entry" || record?.stateId === "go";
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
        highAfterBAt: "",
        firstAAt: "",
        firstAPrice: 0,
        firstTradableAAt: "",
        firstTradableAPrice: 0,
        latestAAt: "",
        latestAPrice: 0,
        latestBAt: "",
        latestBPrice: 0,
        latestSeenAt: "",
        latestSeenPrice: 0,
        highAfterA: 0,
        highAfterAAt: "",
        highestPrice: 0,
        highestAt: "",
        latestState: "",
        maxScore: 0,
        strategies: [],
        enhancements: [],
        stateReason: "",
        supportPrice: 0,
      };
      const price = cleanNumber(record.entryPrice) || cleanNumber(record.observedPrice);
      const observedHigh = cleanNumber(record.observedHigh) || cleanNumber(record.observedPrice) || price;
      const eventTime = recordTimeLabel(record);
      const highTime = timeLabel(record.observedHighAt || record.timestamp);
      if (eventTime) {
        current.latestSeenAt = eventTime;
        current.latestSeenPrice = price;
      }
      if (!current.firstBAt && eventTime) {
        current.firstBAt = eventTime;
        current.firstBPrice = price;
        current.highAfterB = observedHigh || price;
        current.highAfterBAt = highTime || eventTime;
      }
      if (!isEntryState(record) && eventTime) {
        current.latestBAt = eventTime;
        current.latestBPrice = price;
      }
      if (current.firstBAt && observedHigh > cleanNumber(current.highAfterB)) {
        current.highAfterB = observedHigh;
        current.highAfterBAt = highTime || eventTime;
      }
      if (isEntryState(record) && !current.firstAAt && eventTime) {
        current.firstAAt = eventTime;
        current.firstAPrice = price;
        current.highAfterA = observedHigh || price;
        current.highAfterAAt = highTime || eventTime;
      }
      if (isEntryState(record) && eventTime) {
        current.latestAAt = eventTime;
        current.latestAPrice = price;
      }
      if (isEntryState(record) && !current.firstTradableAAt && eventTime && timeValue(eventTime) >= timeValue(MANAGER_MIN_ENTRY_TIME)) {
        current.firstTradableAAt = eventTime;
        current.firstTradableAPrice = price;
      }
      if (current.firstAAt && observedHigh > cleanNumber(current.highAfterA)) {
        current.highAfterA = observedHigh;
        current.highAfterAAt = highTime || eventTime;
      }
      if (observedHigh > cleanNumber(current.highestPrice)) {
        current.highestPrice = observedHigh;
        current.highestAt = highTime || eventTime;
      }
      if (record.strategy && !current.strategies.includes(record.strategy)) {
        current.strategies.push(record.strategy);
      }
      const previousMaxScore = cleanNumber(current.maxScore);
      const recordScore = cleanNumber(record.score);
      const deltaVolume = cleanNumber(record.deltaVolume);
      const stillAboveMa35 = record.aboveMa35 !== false && cleanNumber(record.ma35) > 0;
      const ma35TrendUp = record.ma35TrendUp === true;
      const enhancementText = `${record.strategy || ""} ${record.reason || ""}`;
      const enhancementTrigger = deltaVolume >= 50
        ? "volume"
        : /急拉爆量|分時爆量|分時放大|持續放量|爆量|放大/.test(enhancementText)
        ? "text"
        : (recordScore && previousMaxScore && recordScore >= previousMaxScore + 3)
        ? "score"
        : "";
      const isAEnhancement = current.firstAAt
        && eventTime
        && eventTime !== current.firstAAt
        && isEntryState(record)
        && stillAboveMa35
        && ma35TrendUp
        && enhancementTrigger;
      if (isAEnhancement && !current.enhancements.some((item) => item.at === eventTime)) {
        current.enhancements.push({
          at: eventTime,
          price: price || cleanNumber(record.observedPrice),
          score: recordScore,
          deltaVolume,
          totalVolume: cleanNumber(record.volume),
          trigger: enhancementTrigger,
          ma35: cleanNumber(record.ma35),
          ma35Prev: cleanNumber(record.ma35Prev),
          aboveMa35: record.aboveMa35 !== false,
          ma35TrendUp,
          ma35Source: record.ma35Source || "",
          ma35At: record.ma35At || "",
          ma35Symbol: record.ma35Symbol || "",
          strategy: "持續放量",
          reason: `${record.name || code} 持續放量，MA35來源：${ma35SourceLabel(record.ma35Source)}`,
        });
      }
      current.latestState = isEntryState(record) ? "entry" : "wait";
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
      stateId: "entry",
      stateLabel: "進場區",
      stateReason: "量勢、價位與觸發訊號同步，偏進場區。",
      score: cleanNumber(record.score) || Math.min(100, Math.round(pct * 8 + 56)),
    };
  }
  if ((volume >= 1000 || hasTrigger) && pct >= 2) {
    return {
      stateId: "entry",
      stateLabel: "進場區",
      stateReason: "已有訊號，納入進場區追蹤。",
      score: cleanNumber(record.score) || Math.min(88, Math.round(pct * 8 + 42)),
    };
  }
  return {
    stateId: "entry",
    stateLabel: "進場區",
    stateReason: "已有訊號，納入進場區追蹤。",
    score: cleanNumber(record.score) || Math.min(88, Math.round(Math.max(pct, 0) * 8 + 42)),
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
        tradeVolume: normalizeVolumeLots(stock.volume ?? stock.tradeVolume),
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
      tradeVolume: normalizeVolumeLots(stock.TradeVolume || stock["成交股數"]),
    };
  }).filter((stock) => stock.code && stock.name && stock.close);
}

async function fetchRealtime(stocks) {
  const quotes = new Map();
  const recoveredCodes = new Set();
  const failedBatches = [];
  const retryBatches = [];
  const missedCodes = new Set();

  async function fetchRealtimeBatch(codes) {
    if (!codes.length) return;
    const payload = await fetchJson(`${BASE_URL}/api/realtime?codes=${encodeURIComponent(codes.join(","))}&t=${Date.now()}`, 12000);
    (payload.quotes || []).forEach((quote) => quotes.set(quote.code, quote));
  }

  async function fetchSmallRetries(codes, parentLabel) {
    const stillFailed = [];
    for (let i = 0; i < codes.length; i += REALTIME_RETRY_BATCH_SIZE) {
      const retryCodes = codes.slice(i, i + REALTIME_RETRY_BATCH_SIZE);
      const label = `${retryCodes[0]}-${retryCodes.at(-1)}`;
      try {
        await fetchRealtimeBatch(retryCodes);
        retryCodes.forEach((code) => {
          if (quotes.has(code)) recoveredCodes.add(code);
        });
        retryBatches.push({ range: label, size: retryCodes.length, parent: parentLabel, ok: true });
      } catch (error) {
        console.log(`realtime retry batch failed ${label} (${retryCodes.length}) from ${parentLabel}: ${error.message}`);
        retryBatches.push({ range: label, size: retryCodes.length, parent: parentLabel, ok: false, error: error.message });
        stillFailed.push(...retryCodes);
      }
    }
    return stillFailed;
  }

  async function fetchSingleRetries(codes, parentLabel) {
    for (const code of codes) {
      try {
        await fetchRealtimeBatch([code]);
        if (quotes.has(code)) recoveredCodes.add(code);
      } catch (error) {
        if (/^\d{4}$/.test(String(code)) && !String(code).startsWith("00")) missedCodes.add(code);
        console.log(`realtime single failed ${code} from ${parentLabel}: ${error.message}`);
      }
    }
  }

  const requests = [];
  for (let i = 0; i < stocks.length; i += REALTIME_BATCH_SIZE) {
    const codes = stocks.slice(i, i + REALTIME_BATCH_SIZE).map((stock) => stock.code);
    if (!codes.length) continue;
    requests.push({ codes, promise: fetchRealtimeBatch(codes) });
  }
  const results = await Promise.allSettled(requests.map((request) => request.promise));
  const failed = results
    .map((result, index) => ({ result, codes: requests[index].codes }))
    .filter((item) => item.result.status === "rejected");
  failed.forEach((item) => {
    const error = item.result.reason?.message || String(item.result.reason || "");
    const label = `${item.codes[0]}-${item.codes.at(-1)}`;
    failedBatches.push({ range: label, size: item.codes.length, codes: item.codes, error });
    console.log(`realtime batch failed ${label} (${item.codes.length}): ${error}`);
  });
  for (const item of failed) {
    const label = `${item.codes[0]}-${item.codes.at(-1)}`;
    const stillFailed = await fetchSmallRetries(item.codes, label);
    await fetchSingleRetries(stillFailed, label);
  }
  stocks.forEach((stock) => {
    const code = String(stock.code || "");
    if (!quotes.has(code) && /^\d{4}$/.test(code) && !code.startsWith("00")) missedCodes.add(code);
  });
  fetchRealtime.lastStats = {
    requested: stocks.length,
    received: quotes.size,
    failed: failed.length,
    failedBatches,
    retryBatches,
    recoveredCodes: [...recoveredCodes],
    missedCodes: [...missedCodes],
    missedCount: missedCodes.size,
  };
  return stocks.map((stock) => {
    const quote = quotes.get(stock.code);
    if (!quote?.close) return { ...stock, isRealtime: false };
    const quoteVolume = normalizeVolumeLots(quote.tradeVolume);
    const value = quoteVolume && cleanNumber(quote.close)
      ? quoteVolume * cleanNumber(quote.close)
      : stock.value;
    return { ...stock, ...quote, quoteTime: quote.time, tradeVolume: quoteVolume, value, isRealtime: true, recoveredFromRealtimeFallback: recoveredCodes.has(stock.code) };
  });
}

function taipeiMinuteFromUnix(seconds) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(seconds * 1000));
  const dict = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${dict.year}-${dict.month}-${dict.day} ${dict.hour}:${dict.minute}`;
}

function minuteKey(value) {
  const match = String(value || "").match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]}` : "";
}

function buildSma35Info(rows, targetMinute, source, extra = {}) {
  const sorted = rows
    .filter((row) => row.minute && cleanNumber(row.close) > 0)
    .sort((a, b) => a.minute.localeCompare(b.minute));
  const index = sorted.findLastIndex((row) => row.minute <= targetMinute);
  if (index < 34) return null;
  const window = sorted.slice(index - 34, index + 1).map((row) => cleanNumber(row.close));
  const previousWindow = sorted.slice(index - 35, index).map((row) => cleanNumber(row.close));
  const indicatorRows = sorted.slice(0, index + 1);
  const ma35 = avg(window);
  const ma35Prev = previousWindow.length >= 35 ? avg(previousWindow) : 0;
  if (ma35 <= 0) return null;
  const macd = macdInfo(indicatorRows.map((row) => row.close));
  const kd = kdInfo(indicatorRows);
  return {
    ma35,
    ma35Prev,
    ma35TrendUp: ma35Prev > 0 && ma35 > ma35Prev,
    ma35Source: source,
    ma35At: `${sorted[index].minute}:00`,
    ...macd,
    ...kd,
    ...extra,
  };
}

function updateMinuteCloseCache(cache, stocks, scanTimestamp, key) {
  const minute = minuteKey(scanTimestamp);
  if (!minute) return;
  if (cache.minuteClosesDate !== key || !cache.minuteCloses || typeof cache.minuteCloses !== "object") {
    cache.minuteClosesDate = key;
    cache.minuteCloses = {};
  }
  for (const stock of stocks) {
    const code = String(stock.code || "");
    const close = cleanNumber(stock.close);
    if (!code || close <= 0) continue;
    const rows = Array.isArray(cache.minuteCloses[code]) ? cache.minuteCloses[code] : [];
    if (rows.at(-1)?.minute === minute) {
      rows[rows.length - 1] = { minute, close };
    } else {
      rows.push({ minute, close });
    }
    cache.minuteCloses[code] = rows.filter((row) => String(row.minute || "").startsWith(key)).slice(-90);
  }
}

function fetchLocalIntradaySma35(cache, code, scanTimestamp) {
  const targetMinute = minuteKey(scanTimestamp);
  const rows = Array.isArray(cache?.minuteCloses?.[String(code)]) ? cache.minuteCloses[String(code)] : [];
  return buildSma35Info(rows, targetMinute, "local-1m-cache", { ma35Symbol: String(code) });
}

async function fetchFugleIntradaySma35(code, scanTimestamp) {
  if (!FUGLE_API_KEY) return null;
  if (fugleMa35BlockedReason) return null;
  const targetMinute = minuteKey(scanTimestamp);
  const targetDate = targetMinute.slice(0, 10);
  if (!targetMinute || !targetDate) return null;
  const url = `https://api.fugle.tw/marketdata/v1.0/stock/intraday/candles/${code}?timeframe=1&sort=asc`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "FumanIntradaySma35/1.0",
        "X-API-KEY": FUGLE_API_KEY,
      },
    });
    if (!response.ok) throw new Error(`fugle HTTP ${response.status}`);
    const payload = await response.json();
    const rows = (payload.data || [])
      .map((row) => ({
        minute: minuteKey(String(row.date || "").replace("T", " ")),
        high: cleanNumber(row.high),
        low: cleanNumber(row.low),
        close: cleanNumber(row.close),
        volume: cleanNumber(row.volume),
      }))
      .filter((row) => row.minute.startsWith(targetDate));
    return buildSma35Info(rows, targetMinute, "fugle-1m", { ma35Symbol: String(payload.symbol || code) });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTwelveDataIntradaySma35(code, scanTimestamp) {
  if (!TWELVE_DATA_API_KEY) return null;
  if (twelveDataBlockedReason) return null;
  const targetMinute = minuteKey(scanTimestamp);
  const targetDate = targetMinute.slice(0, 10);
  if (!targetMinute || !targetDate) return null;
  const symbols = [
    { symbol: code, exchange: "TWSE", label: `${code}:TWSE` },
    { symbol: `${code}:TWSE`, label: `${code}:TWSE` },
    { symbol: `${code}:TPEX`, label: `${code}:TPEX` },
  ];
  for (const request of symbols) {
    const url = new URL("https://api.twelvedata.com/time_series");
    url.searchParams.set("symbol", request.symbol);
    if (request.exchange) url.searchParams.set("exchange", request.exchange);
    url.searchParams.set("interval", "1min");
    url.searchParams.set("outputsize", "90");
    url.searchParams.set("timezone", "Asia/Taipei");
    url.searchParams.set("apikey", TWELVE_DATA_API_KEY);
    try {
      const payload = await fetchJson(url.toString(), 20000);
      if (payload?.status === "error" || payload?.code) {
        const message = payload?.message || "twelve data error";
        if (/Pro or Venture plan|upgrade/i.test(message)) {
          twelveDataBlockedReason = "plan-blocked";
          console.log(`sma35 1m twelve disabled for this scan: ${message}`);
          return null;
        }
        throw new Error(message);
      }
      const rows = (payload.values || [])
        .map((row) => ({
          minute: minuteKey(String(row.datetime || "").replace("T", " ")),
          high: cleanNumber(row.high),
          low: cleanNumber(row.low),
          close: cleanNumber(row.close),
          volume: cleanNumber(row.volume),
        }))
        .filter((row) => row.minute.startsWith(targetDate) && row.close > 0);
      const info = buildSma35Info(rows, targetMinute, "twelve-1m", { ma35Symbol: request.label });
      if (cleanNumber(info?.ma35) > 0) return info;
    } catch (error) {
      console.log(`sma35 1m failed ${request.label}: ${error.message}`);
    }
  }
  return null;
}

async function fetchIntradaySma35WithFallback(code, scanTimestamp, cache) {
  const attempts = [];
  if (yahooMa35BlockedReason) {
    attempts.push({ source: "yahoo-1m", ok: false, skipped: true, error: yahooMa35BlockedReason });
  } else {
    try {
      const yahoo = await fetchYahooIntradaySma35(code, scanTimestamp);
      attempts.push({ source: "yahoo-1m", ok: Boolean(yahoo) });
      if (yahoo) {
        yahooMa35Failures = 0;
        return { ...yahoo, ma35Attempts: attempts };
      }
      noteMa35ProviderFailure("yahoo", "empty");
    } catch (error) {
      attempts.push({ source: "yahoo-1m", ok: false, error: error.message });
      noteMa35ProviderFailure("yahoo", error.message);
    }
  }
  if (fugleMa35BlockedReason) {
    attempts.push({ source: "fugle-1m", ok: false, configured: Boolean(FUGLE_API_KEY), skipped: true, error: fugleMa35BlockedReason });
  } else {
    try {
      const fugle = await fetchFugleIntradaySma35(code, scanTimestamp);
      attempts.push({ source: "fugle-1m", ok: Boolean(fugle), configured: Boolean(FUGLE_API_KEY) });
      if (fugle) {
        fugleMa35Failures = 0;
        return { ...fugle, ma35Attempts: attempts };
      }
      if (FUGLE_API_KEY) noteMa35ProviderFailure("fugle", "empty");
    } catch (error) {
      attempts.push({ source: "fugle-1m", ok: false, configured: Boolean(FUGLE_API_KEY), error: error.message });
      noteMa35ProviderFailure("fugle", error.message);
    }
  }
  try {
    const twelve = await fetchTwelveDataIntradaySma35(code, scanTimestamp);
    attempts.push({ source: "twelve-1m", ok: Boolean(twelve), configured: Boolean(TWELVE_DATA_API_KEY), skipped: Boolean(twelveDataBlockedReason), error: twelveDataBlockedReason || undefined });
    if (twelve) return { ...twelve, ma35Attempts: attempts };
  } catch (error) {
    attempts.push({ source: "twelve-1m", ok: false, configured: Boolean(TWELVE_DATA_API_KEY), error: error.message });
  }
  const local = fetchLocalIntradaySma35(cache, code, scanTimestamp);
  attempts.push({ source: "local-1m-cache", ok: Boolean(local) });
  return local ? { ...local, ma35Attempts: attempts } : { ma35Attempts: attempts };
}

async function fetchYahooIntradaySma35(code, scanTimestamp) {
  if (yahooMa35BlockedReason) return null;
  const targetMinute = minuteKey(scanTimestamp);
  const targetDate = targetMinute.slice(0, 10);
  if (!targetMinute || !targetDate) return null;
  for (const suffix of ["TW", "TWO"]) {
    const symbol = `${code}.${suffix}`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;
    try {
      const payload = await fetchJson(url, 20000);
      const result = payload?.chart?.result?.[0];
      const timestamps = result?.timestamp || [];
      const quote = result?.indicators?.quote?.[0] || {};
      const closes = quote.close || [];
      const highs = quote.high || [];
      const lows = quote.low || [];
      const volumes = quote.volume || [];
      const rows = timestamps
        .map((timestamp, index) => ({
          minute: taipeiMinuteFromUnix(timestamp),
          high: cleanNumber(highs[index]),
          low: cleanNumber(lows[index]),
          close: cleanNumber(closes[index]),
          volume: cleanNumber(volumes[index]),
        }))
        .filter((row) => row.minute.startsWith(targetDate) && row.close > 0)
        .sort((a, b) => a.minute.localeCompare(b.minute));
      const info = buildSma35Info(rows, targetMinute, "yahoo-1m", { ma35Symbol: symbol });
      if (cleanNumber(info?.ma35) > 0) {
        return {
          ...info,
          ma35Symbol: symbol,
        };
      }
    } catch (error) {
      console.log(`sma35 1m failed ${symbol}: ${error.message}`);
    }
  }
  return null;
}

async function fetchMa35Map(stocks, scanTimestamp, cache) {
  const candidates = stocks
    .filter(isIntradayTradable)
    .filter((stock) => cleanNumber(stock.percent) > 2 && cleanNumber(stock.tradeVolume) >= 2000)
    .map((stock) => stock.code);
  const map = new Map();
  const concurrency = 8;
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      const code = candidates[cursor++];
      const info = await fetchIntradaySma35WithFallback(code, scanTimestamp, cache);
      if (cleanNumber(info?.ma35) > 0) map.set(String(code), info);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return map;
}

async function main() {
  const parts = taipeiParts();
  const key = dateKey(parts);
  if (!isMarketTime(parts)) {
    console.log(`skip intraday scan outside market time: ${timestampKey(parts)}`);
    return;
  }
  const cache = readJson(SIGNAL_FILE, { date: key, records: [], previous: {} });
  const scorecardTracker = readJson(SCORECARD_TRACK_FILE, { date: key, trades: {} });
  const strategy5Tracker = readJson(STRATEGY5_TRACK_FILE, { date: key, trades: {} });
  if (cache.date !== key) {
    cache.date = key;
    cache.records = [];
    cache.previous = {};
  }

  const rawStocks = await fetchStocks();
  const realtimeSourceStocks = rawStocks.filter(isIntradayTradable);
  const realtimePayload = await fetchRealtime(realtimeSourceStocks);
  const timestamp = timestampKey();
  const realtimeStats = fetchRealtime.lastStats || { requested: rawStocks.length, received: 0, failed: 0 };
  const realtimeStocks = realtimePayload
    .filter((stock) => stock.isRealtime === true)
    .filter((stock) => hasFreshQuote(stock, timestamp))
    .filter(isIntradayTradable);
  const coverage = realtimeSourceStocks.length ? realtimeStocks.length / realtimeSourceStocks.length : 0;
  const realtimeSummaryBase = {
    ...realtimeStats,
    coverage: Number(coverage.toFixed(4)),
    usable: realtimeStocks.length,
    initialBatchSize: REALTIME_BATCH_SIZE,
    retryBatchSize: REALTIME_RETRY_BATCH_SIZE,
  };
  if (realtimeSourceStocks.length && coverage < MIN_REALTIME_COVERAGE) {
    cache.updatedAt = new Date().toISOString();
    cache.realtime = { ...realtimeSummaryBase, skippedPartialCoverage: true };
    writeJson(SIGNAL_FILE, cache);
    console.log(`intraday signals ${key}: skipped partial realtime coverage ${realtimeStocks.length}/${realtimeSourceStocks.length} (received ${realtimeStats.received}, failed ${realtimeStats.failed}, missed ${realtimeStats.missedCount || 0})`);
    return;
  }
  updateMinuteCloseCache(cache, realtimeStocks, timestamp, key);
  const ma35Map = await fetchMa35Map(realtimeStocks, timestamp, cache);
  const liveStocks = realtimeStocks.map((stock) => {
    const ma35Info = ma35Map.get(stock.code) || {};
    return {
      ...stock,
      ma35: ma35Info.ma35 || 0,
      ma35Prev: ma35Info.ma35Prev || 0,
      ma35TrendUp: Boolean(ma35Info.ma35TrendUp),
      ma35Source: ma35Info.ma35Source || "",
      ma35Symbol: ma35Info.ma35Symbol || "",
      ma35At: ma35Info.ma35At || "",
      ma35Attempts: ma35Info.ma35Attempts || [],
      macdDif: ma35Info.macdDif || 0,
      macdSignal: ma35Info.macdSignal || 0,
      macdHist: ma35Info.macdHist || 0,
      macdUp: Boolean(ma35Info.macdUp),
      kdK: ma35Info.kdK || 0,
      kdD: ma35Info.kdD || 0,
      kdUp: Boolean(ma35Info.kdUp),
    };
  });
  const ranks = buildRanks(liveStocks);
  let added = 0;

  updateScorecardTradeTracks(scorecardTracker, strategy5Tracker, liveStocks, timestamp, key);

  for (const stock of liveStocks) {
    updateTrackedExtremes(cache, stock, timestamp, key);
    const previous = cache.previous[stock.code] || null;
    const signals = detectSignals(stock, previous || { tradeVolume: stock.tradeVolume }, ranks);
    cache.previous[stock.code] = {
      close: stock.close,
      high: stock.high,
      low: stock.low,
      quoteTime: stock.quoteTime || stock.time || "",
      tradeVolume: stock.tradeVolume,
      percent: stock.percent,
    };
    signals.forEach((signal) => {
      const state = classifyStrategy2State(stock, signal);
      if (!state) return;
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
        stateId: state.stateId,
        stateLabel: state.stateLabel,
        stateReason: state.stateReason,
        score: state.score,
        entryPrice: signal.entryPrice,
        supportPrice: signal.supportPrice,
        entryLow: signal.entryLow,
        entryHigh: signal.entryHigh,
        stopLoss: signal.stopLoss,
        chaseLimit: signal.chaseLimit,
        observedPrice: stock.close,
        quoteTime: stock.quoteTime || stock.time || "",
        quoteSource: "api/realtime",
        observedHigh: stock.close,
        observedHighAt: timestamp,
        observedLow: stock.close,
        observedLowAt: timestamp,
        dayHigh: stock.high || stock.close,
        dayHighAt: timestamp,
        dayLow: stock.low || stock.close,
        dayLowAt: timestamp,
        volume: stock.tradeVolume,
        percent: stock.percent,
        reason: signal.reason,
        signalId: signal.id,
        deltaVolume: signal.deltaVolume,
        volumeMilestone: signal.volumeMilestone,
        ma35: signal.ma35,
        ma35Prev: signal.ma35Prev,
        aboveMa35: signal.aboveMa35,
        ma35TrendUp: signal.ma35TrendUp,
        ma35Source: signal.ma35Source,
        ma35Symbol: signal.ma35Symbol,
        ma35At: signal.ma35At,
        ma35Attempts: signal.ma35Attempts,
        macdDif: signal.macdDif,
        macdSignal: signal.macdSignal,
        macdHist: signal.macdHist,
        macdUp: signal.macdUp,
        kdK: signal.kdK,
        kdD: signal.kdD,
        kdUp: signal.kdUp,
        intradayVolumeBurst: signal.intradayVolumeBurst,
        recoveredFromRealtimeFallback: Boolean(stock.recoveredFromRealtimeFallback),
      });
      added += 1;
    });
    if (appendTrackedSnapshot(cache, stock, timestamp, key)) {
      added += 1;
    }
  }

  cache.records = normalizeStrategy2Records(cache.records || []);
  cache.updatedAt = new Date().toISOString();
  const strategy2Events = mergeStrategy2Events(cache.records || [], key);
  const realtimeSummary = {
    ...realtimeSummaryBase,
    tradable: liveStocks.length,
  };
  writeJson(SIGNAL_FILE, cache);
  const strategy2Report = {
    source: "strategy2-09-to-1330-patrol",
    date: key,
    updatedAt: cache.updatedAt,
    realtime: realtimeSummary,
    records: cache.records,
    events: strategy2Events,
    entryCount: strategy2Events.filter((event) => event.firstAAt).length,
    aCount: strategy2Events.filter((event) => event.firstAAt).length,
    bOnlyCount: 0,
  };
  writeJson(STRATEGY2_REPORT_FILE, strategy2Report);
  publishStaticDataJson("strategy2-intraday-latest.json", strategy2Report);
  writeJson(path.join(STRATEGY2_HISTORY_DIR, `${key}.json`), {
    source: "strategy2-09-to-1330-patrol",
    date: key,
    updatedAt: cache.updatedAt,
    realtime: realtimeSummary,
    records: cache.records,
    events: strategy2Events,
    entryCount: strategy2Events.filter((event) => event.firstAAt).length,
    aCount: strategy2Events.filter((event) => event.firstAAt).length,
    bOnlyCount: 0,
  });
  const rotationMessages = rotateStrategy2IntradayCache({ currentDateKey: key });
  rotationMessages.forEach((message) => console.log(`strategy2 cache rotation: ${message}`));
  writeJson(SCORECARD_TRACK_FILE, scorecardTracker);
  writeJson(STRATEGY5_TRACK_FILE, strategy5Tracker);
  console.log(`intraday signals ${key}: added ${added}, total ${cache.records.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});


