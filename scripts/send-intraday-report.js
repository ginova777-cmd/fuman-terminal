const fs = require("fs");
const path = require("path");
const tls = require("tls");
const { cleanNumber, formatTradePrice } = require("./intraday-radar-rules");
const { splitLineText } = require("./line-push");
const { fetchMisQuotes } = require("../lib/mis-quotes");

const { ROOT, dataPath, cachePath } = require("./runtime-paths");
const SIGNAL_FILE = path.join(cachePath("intraday"), "signals.json");
const SCORECARD_TRACK_FILE = path.join(cachePath("intraday"), "scorecard-trades.json");
const STRATEGY5_TRACK_FILE = path.join(cachePath("intraday"), "strategy5-scorecard-trades.json");
const STRATEGY2_REPORT_FILE = dataPath("strategy2-intraday-latest.json");
const OPEN_BUY_FILE = dataPath("open-buy-latest.json");
const OPEN_BUY_BACKUP_FILE = dataPath("open-buy-backup.json");
const OPEN_BUY_SCORECARD_SOURCE_FILE = dataPath("open-buy-scorecard-source.json");
const STRATEGY3_FILE = dataPath("strategy3-latest.json");
const STRATEGY3_BACKUP_FILE = dataPath("strategy3-backup.json");
const STRATEGY3_SCORECARD_SOURCE_FILE = dataPath("strategy3-scorecard-source.json");
const STRATEGY5_FILE = dataPath("strategy5-latest.json");
const STRATEGY5_BACKUP_FILE = dataPath("strategy5-backup.json");
const REALTIME_RADAR_SCORECARD_FILE = dataPath("realtime-radar-scorecard-latest.json");
const BASE_URL = process.env.FUMAN_BASE_URL || "https://fuman-terminal.vercel.app";
const LOT_SIZE = Number(process.env.REPORT_LOT_SIZE || 1000);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const REPORT_SENT_PATH = process.env.REPORT_SENT_DIR || path.join(cachePath("intraday-report"), "sent-reports");

function taipeiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function taipeiHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    hour12: false,
  }).format(date));
}

function dateSlash(value) {
  return String(value || "").replace(/-/g, "/");
}

function tradeDateLabel(value, fallback = taipeiDateKey()) {
  const text = String(value || fallback || "");
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${Number(compact[2])}/${Number(compact[3])}`;
  const match = text.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (!match) return dateSlash(fallback).slice(5).replace(/^0/, "").replace("/0", "/");
  return `${Number(match[2])}/${Number(match[3])}`;
}

function tradeTimeLabel(value, fallback = "--:--") {
  const match = String(value || "").match(/(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : fallback;
}

function compactTradeDate(value) {
  const text = String(value || "");
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}${compact[2]}${compact[3]}`;
  const dashed = text.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
  return dashed ? `${dashed[1]}${dashed[2]}${dashed[3]}` : "";
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

function isStrategy3ScorecardSource(payload, today) {
  return (payload?.matches || []).length && payloadTradeDate(payload) === previousWeekdayCompact(today);
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function taipeiTimeLabel(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function strategy3EntryTime(item) {
  return "13:00";
}

function strategy3EntryDate(item, payload, today) {
  return tradeDateLabel(item.quoteDate || payload.usedDate || payload.date || today);
}

function strategy3EntryPrice(item, quote) {
  return cleanNumber(item.entryPrice)
    || cleanNumber(item.quotePrice)
    || cleanNumber(item.price1300)
    || cleanNumber(item.priceAt1300)
    || cleanNumber(item.close)
    || cleanNumber(item.price)
    || cleanNumber(item.lastPrice)
    || cleanNumber(item.currentPrice)
    || cleanNumber(quote?.open);
}

function strategy5EntryTime(item) {
  return tradeTimeLabel(item.entryAt || item.quoteTime || item.signalTime, "09:00");
}

function strategy5EntryDate(payload, today) {
  return tradeDateLabel(today);
}

function tradeSummaryLine({ date, entryTime, entryPrice, exitDate, exitTime, exitPrice, profitPct, profit }) {
  const parts = [
    `日期 ${date}`,
    `時間${entryTime}`,
    `進場價格:${formatTradePrice(entryPrice)}元`,
  ];
  if (exitDate) parts.push(`出場日期:${exitDate}`);
  if (exitTime) parts.push(`出場時間${exitTime}`);
  parts.push(
    `出場價格/盤中高點:${formatTradePrice(exitPrice)}元`,
    `損益率:${percent(profitPct)}`,
    `損益:${money(profit)}`,
  );
  return parts.join(" ");
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

function fieldNumber(row, keys) {
  for (const key of keys) {
    const value = cleanNumber(row?.[key]);
    if (value > 0) return value;
  }
  return 0;
}

function mergeDailyQuote(map, code, patch) {
  if (!/^\d{4}$/.test(code) || !cleanNumber(patch.high)) return;
  const current = map.get(code) || { code };
  map.set(code, {
    ...current,
    ...patch,
    high: cleanNumber(patch.high),
    dayHigh: cleanNumber(patch.high),
    highSource: "daily-settlement",
    time: current.time || "13:30",
  });
}

async function fetchTwseDailyHighMap(codes) {
  const wanted = new Set(codes);
  const map = new Map();
  try {
    const rows = await fetchJson("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL", 30000);
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const code = normalizeCode(row.Code || row.code || row["證券代號"]);
      if (!wanted.has(code)) return;
      const high = fieldNumber(row, ["HighestPrice", "最高價", "high"]);
      if (!high) return;
      map.set(code, {
        code,
        name: row.Name || row.name || row["證券名稱"] || code,
        open: fieldNumber(row, ["OpeningPrice", "開盤價", "open"]),
        high,
        low: fieldNumber(row, ["LowestPrice", "最低價", "low"]),
        close: fieldNumber(row, ["ClosingPrice", "收盤價", "close"]),
      });
    });
  } catch (error) {
    console.log(`twse daily high failed: ${error.message}`);
  }
  return map;
}

function yyyymmddToIso(value) {
  const text = String(value || "");
  if (!/^\d{8}$/.test(text)) return "";
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

async function fetchTpexDailyHighMap(codes) {
  const wanted = new Set(codes);
  const map = new Map();
  try {
    const payload = await fetchJson("https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php?l=zh-tw&o=json&s=0,asc,0", 30000);
    const date = yyyymmddToIso(payload?.date);
    const table = Array.isArray(payload?.tables) ? payload.tables[0] : null;
    (Array.isArray(table?.data) ? table.data : []).forEach((row) => {
      const code = normalizeCode(row?.[0]);
      if (!wanted.has(code)) return;
      const high = cleanNumber(row?.[5]);
      if (!high) return;
      map.set(code, {
        code,
        date,
        close: cleanNumber(row?.[2]),
        open: cleanNumber(row?.[4]),
        high,
        low: cleanNumber(row?.[6]),
      });
    });
  } catch (error) {
    console.log(`tpex daily high failed: ${error.message}`);
  }
  return map;
}

async function fetchDailyHighMap(codes) {
  const normalized = [...new Set(codes.map(normalizeCode).filter((code) => /^\d{4}$/.test(code)))];
  if (!normalized.length) return new Map();
  const [twse, tpex] = await Promise.all([
    fetchTwseDailyHighMap(normalized),
    fetchTpexDailyHighMap(normalized),
  ]);
  return new Map([...twse, ...tpex]);
}

async function fetchRealtimeMap(codes) {
  const map = new Map();
  for (let i = 0; i < codes.length; i += 100) {
    const batch = codes.slice(i, i + 100);
    try {
      const payload = await fetchJson(`${BASE_URL}/api/realtime?codes=${encodeURIComponent(batch.join(","))}&t=${Date.now()}`, 20000);
      (payload.quotes || []).forEach((quote) => map.set(quote.code, quote));
    } catch (error) {
      console.log(`settle realtime failed ${batch[0]}-${batch.at(-1)}: ${error.message}`);
    }
  }
  const missing = codes.filter((code) => {
    const quote = map.get(code);
    return !cleanNumber(quote?.open) || !cleanNumber(quote?.high) || !cleanNumber(quote?.low) || !cleanNumber(quote?.close);
  });
  if (missing.length) {
    const directQuotes = await fetchMisQuotes(missing);
    directQuotes.forEach((quote, code) => {
      map.set(code, { ...(map.get(code) || {}), ...quote });
    });
  }
  const missingHigh = codes.filter((code) => !cleanNumber(map.get(code)?.high));
  if (missingHigh.length) {
    const dailyHighs = await fetchDailyHighMap(missingHigh);
    dailyHighs.forEach((quote, code) => mergeDailyQuote(map, code, quote));
  }
  return map;
}

function smtpRead(socket) {
  return new Promise((resolve, reject) => {
    let data = "";
    const onData = (chunk) => {
      data += chunk.toString("utf8");
      const lines = data.trimEnd().split(/\r?\n/);
      const last = lines.at(-1) || "";
      if (/^\d{3} /.test(last)) {
        socket.off("data", onData);
        resolve(data);
      }
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}

async function smtpCommand(socket, command, expect = /^[23]/) {
  if (command) socket.write(`${command}\r\n`);
  const response = await smtpRead(socket);
  if (!expect.test(response)) throw new Error(`SMTP failed after ${command}: ${response}`);
  return response;
}

async function sendMail({ host, port, user, pass, to, subject, text }) {
  const socket = tls.connect({ host, port, servername: host });
  await new Promise((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
  });
  await smtpCommand(socket, null);
  await smtpCommand(socket, `EHLO fuman-terminal`);
  await smtpCommand(socket, "AUTH LOGIN", /^334/);
  await smtpCommand(socket, Buffer.from(user).toString("base64"), /^334/);
  await smtpCommand(socket, Buffer.from(pass).toString("base64"));
  await smtpCommand(socket, `MAIL FROM:<${user}>`);
  await smtpCommand(socket, `RCPT TO:<${to}>`);
  await smtpCommand(socket, "DATA", /^354/);
  const message = [
    `From: ${user}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    ".",
  ].join("\r\n");
  await smtpCommand(socket, message);
  await smtpCommand(socket, "QUIT");
  socket.end();
}

function money(value) {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${Math.abs(Math.round(value)).toLocaleString("zh-TW")} 元`;
}

function percent(value) {
  const number = Number(value) || 0;
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function profitAmount(entryPrice, exitPrice) {
  return entryPrice > 0 && exitPrice > 0 ? (exitPrice - entryPrice) * LOT_SIZE : 0;
}

function profitRate(entryPrice, exitPrice) {
  return entryPrice > 0 && exitPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
}

function firstPrice(...values) {
  for (const value of values) {
    const number = cleanNumber(value);
    if (number > 0) return number;
  }
  return 0;
}

function quoteTime(quote, fallback = "13:30") {
  return tradeTimeLabel(quote?.time || quote?.quoteTime || quote?.updatedAt, fallback);
}

function settlementHigh(track, quote, fallback = {}) {
  const tracked = firstPrice(track?.observedHigh, track?.highAfterA, track?.highAfterB, track?.highestPrice);
  if (tracked) return { price: tracked, time: tradeTimeLabel(track?.observedHighAt, "--:--"), source: "patrol" };
  const quoteHigh = firstPrice(quote?.high, quote?.dayHigh, quote?.highestPrice);
  if (quoteHigh) return { price: quoteHigh, time: quoteTime(quote), source: "market" };
  const fallbackHigh = firstPrice(fallback?.high, fallback?.observedHigh, fallback?.highAfterA, fallback?.highAfterB, fallback?.highestPrice);
  if (fallbackHigh) return { price: fallbackHigh, time: tradeTimeLabel(fallback?.observedHighAt || fallback?.updatedAt, "13:30"), source: "fallback" };
  return { price: 0, time: "--:--", source: "missing" };
}

function openBuyEntryPrice(item, quote, track = {}) {
  return firstPrice(
    quote?.open,
    item?.open,
    item?.entryPrice,
    track?.entryPrice,
    item?.quotePrice,
    item?.price,
    item?.close,
    quote?.prevClose,
    quote?.close
  );
}

function openBuySettlementHigh(track, quote, fallback = {}) {
  const quoteHigh = firstPrice(quote?.high, quote?.dayHigh, quote?.highestPrice);
  if (quoteHigh) return { price: quoteHigh, time: quoteTime(quote), source: "market" };
  return settlementHigh(track, quote, fallback);
}

function settlementLow(track, quote, fallback = {}) {
  const tracked = firstPrice(track?.observedLow);
  if (tracked) return { price: tracked, time: tradeTimeLabel(track?.observedLowAt, "--:--"), source: "patrol" };
  const quoteLow = firstPrice(quote?.low, quote?.dayLow, quote?.close);
  if (quoteLow) return { price: quoteLow, time: quoteTime(quote), source: "market" };
  const fallbackLow = firstPrice(fallback?.low, fallback?.observedLow, fallback?.close);
  if (fallbackLow) return { price: fallbackLow, time: tradeTimeLabel(fallback?.observedLowAt || fallback?.updatedAt, "13:30"), source: "fallback" };
  return { price: 0, time: "--:--", source: "missing" };
}

function settlementTimeLabel(settlement) {
  return settlement.time;
}

function strategy3SettlementHigh(track, quote, fallback = {}) {
  const tracked = firstPrice(track?.observedHigh, track?.highAfterA, track?.highAfterB, track?.highestPrice);
  const quoteHigh = firstPrice(quote?.high, quote?.dayHigh, quote?.highestPrice);
  if (tracked && (!quoteHigh || tracked >= quoteHigh)) {
    return { price: tracked, time: tradeTimeLabel(track?.observedHighAt, ""), source: "patrol" };
  }
  if (quoteHigh) return { price: quoteHigh, time: quoteTime(quote, ""), source: "daily-settlement" };
  const fallbackHigh = firstPrice(fallback?.high, fallback?.observedHigh, fallback?.highAfterA, fallback?.highAfterB, fallback?.highestPrice);
  if (fallbackHigh) return { price: fallbackHigh, time: tradeTimeLabel(fallback?.observedHighAt || fallback?.updatedAt, ""), source: "fallback" };
  return { price: 0, time: "", source: "missing" };
}

function readCacheWithBackup(file, backupFile) {
  const payload = readJson(file, { ok: true, matches: [] });
  if ((payload.matches || []).length) return payload;
  return readJson(backupFile, payload);
}

function readScorecardSource(sourceFile, latestFile, backupFile) {
  const source = readJson(sourceFile, { ok: true, matches: [] });
  if ((source.matches || []).length) return source;
  return readCacheWithBackup(latestFile, backupFile);
}

function readStrategy3ScorecardSource(today) {
  const empty = { ok: true, matches: [] };
  const source = readJson(STRATEGY3_SCORECARD_SOURCE_FILE, empty);
  if (isStrategy3ScorecardSource(source, today)) return source;
  const latest = readJson(STRATEGY3_FILE, empty);
  if (isStrategy3ScorecardSource(latest, today)) return latest;
  const backup = readJson(STRATEGY3_BACKUP_FILE, empty);
  if (isStrategy3ScorecardSource(backup, today)) return backup;
  return {
    ok: true,
    matches: [],
    staleSourceDate: payloadTradeDate(source) || payloadTradeDate(latest) || payloadTradeDate(backup),
    expectedSourceDate: previousWeekdayCompact(today),
  };
}

function reportRows(payload, limit = 20) {
  return (payload.matches || [])
    .filter((item) => item && item.code)
    .slice(0, limit);
}

function scorecardEntryPrice(item, quote) {
  return cleanNumber(item.entryPrice)
    || cleanNumber(item.quotePrice)
    || cleanNumber(item.price)
    || cleanNumber(item.close)
    || cleanNumber(item.lastPrice)
    || cleanNumber(item.currentPrice)
    || cleanNumber(quote?.open)
    || cleanNumber(quote?.prevClose)
    || cleanNumber(quote?.close);
}

function scorecardReason(item) {
  if (Array.isArray(item.matches)) {
    return item.matches.map((match) => match.reason || match.label || match.name).filter(Boolean).join("；");
  }
  return item.reason || item.note || item.why || "";
}

function scorecardRank(item, index) {
  return cleanNumber(item.rank) || index + 1;
}

function isTaipeiMarketRecord(record) {
  const match = String(record?.timestamp || "").match(/\s(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return true;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 9 * 60 && minutes <= 13 * 60 + 45;
}

const STATE_ORDER = { go: 1, wait: 2, watch: 3 };
const STATE_LABELS = {
  go: "進場區",
  wait: "觀察區",
  watch: "觀察區",
};

function inferState(record) {
  if (record.stateId && STATE_LABELS[record.stateId]) {
    return { id: record.stateId, label: record.stateLabel || STATE_LABELS[record.stateId], reason: record.stateReason || "" };
  }
  const strategies = record.strategies || [record.strategy].filter(Boolean);
  const text = strategies.join("、");
  if (/急拉爆量|分時爆量/.test(text) && /轉強突破|真跳空|MA35買點|鑽石/.test(text)) {
    return { id: "go", label: STATE_LABELS.go, reason: "量勢與進場訊號同步。" };
  }
  if (/急拉爆量|分時爆量|分時放大|轉強突破|MA35買點|鑽石/.test(text)) {
    return { id: "wait", label: STATE_LABELS.wait, reason: "已有訊號，等待站穩或再放量。" };
  }
  return { id: "watch", label: STATE_LABELS.watch, reason: "列入觀察。" };
}

function mergeRecords(records) {
  const map = new Map();
  records.filter(isTaipeiMarketRecord).forEach((record) => {
    const key = `${record.timestamp}|${record.code}`;
    const state = inferState(record);
    const current = map.get(key);
    if (!current) {
      map.set(key, { ...record, stateId: state.id, stateLabel: state.label, stateReason: state.reason, strategies: [record.strategy].filter(Boolean) });
      return;
    }
    if (record.strategy && !current.strategies.includes(record.strategy)) {
      current.strategies.push(record.strategy);
    }
    const entry = cleanNumber(record.entryPrice);
    const currentEntry = cleanNumber(current.entryPrice);
    if (entry && (!currentEntry || entry < currentEntry)) current.entryPrice = entry;
    const currentHigh = cleanNumber(current.observedHigh);
    const nextHigh = cleanNumber(record.observedHigh);
    if (nextHigh && (!currentHigh || nextHigh > currentHigh)) {
      current.observedHigh = nextHigh;
      current.observedHighAt = record.observedHighAt || record.timestamp;
    }
    const currentLow = cleanNumber(current.observedLow);
    const nextLow = cleanNumber(record.observedLow);
    if (nextLow && (!currentLow || nextLow < currentLow)) {
      current.observedLow = nextLow;
      current.observedLowAt = record.observedLowAt || record.timestamp;
    }
    current.observedPrice = cleanNumber(current.observedPrice) || cleanNumber(record.observedPrice);
    current.supportPrice = cleanNumber(current.supportPrice) || cleanNumber(record.supportPrice);
    if (STATE_ORDER[state.id] < STATE_ORDER[current.stateId || "watch"]) {
      current.stateId = state.id;
      current.stateLabel = state.label;
      current.stateReason = state.reason;
    }
    current.score = Math.max(cleanNumber(current.score), cleanNumber(record.score));
  });
  return [...map.values()].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || String(a.code).localeCompare(String(b.code)));
}

function scorecardTrack(tracker, group, code) {
  if (tracker.date !== taipeiDateKey()) return null;
  return tracker.trades?.[`${group}:${code}`] || null;
}

function buildOpenBuyReport(payload, quotes, today, tracker) {
  const rows = reportRows(payload);
  let totalProfit = 0;
  const stateStats = new Map();
  const lines = [`策略1開盤沖成績單｜${dateSlash(today)}`, ""];
  if (!rows.length) {
    lines.push("今天沒有符合策略1開盤沖的候選標的。", "");
  }
  rows.forEach((item) => {
    const quote = quotes.get(item.code) || {};
    const track = scorecardTrack(tracker, "openBuy", item.code) || {};
    const entryPrice = openBuyEntryPrice(item, quote, track);
    const high = openBuySettlementHigh(track, quote, item);
    const exitPrice = high.price;
    const profit = profitAmount(entryPrice, exitPrice);
    const profitPct = profitRate(entryPrice, exitPrice);
    totalProfit += profit;
    const setupLabel = item.status || item.setup || (item.matchedSetups || [])[0] || "未標示";
    const stat = stateStats.get(setupLabel) || { total: 0, wins: 0, profit: 0 };
    stat.total += 1;
    if (profit > 0) stat.wins += 1;
    stat.profit += profit;
    stateStats.set(setupLabel, stat);
    lines.push(
      `名單${item.code} ${item.name || ""}`,
      `狀態 ${setupLabel}`,
      `交易日期 ${tradeDateLabel(today)}`,
      `入場時間 09:00  進場價格:${formatTradePrice(entryPrice)}元`,
      "",
      `盤中高點:${formatTradePrice(exitPrice)}元`,
      `損益率:${percent(profitPct)}｜損益:${money(profit)}`,
      ""
    );
  });
  const stateOrder = ["開盤無腦入", "深跌反彈", "突破候選", "洗盤反彈", "未標示"];
  stateOrder.forEach((label) => {
    const stat = stateStats.get(label);
    if (!stat) return;
    const winRate = stat.total ? (stat.wins / stat.total) * 100 : 0;
    lines.push(`狀態 ${label}  勝率:${percent(winRate)} 合計：${money(stat.profit)}`);
  });
  [...stateStats.entries()].forEach(([label, stat]) => {
    if (stateOrder.includes(label)) return;
    const winRate = stat.total ? (stat.wins / stat.total) * 100 : 0;
    lines.push(`狀態 ${label}  勝率:${percent(winRate)} 合計：${money(stat.profit)}`);
  });
  lines.push(`共計: ${money(totalProfit)}`);
  return lines.join("\n");
}

function buildStrategy5Report(payload, quotes, today, tracker) {
  const rows = reportRows(payload);
  let correctCount = 0;
  const lines = [`策略5綜合策略成績單｜${dateSlash(today)}`, ""];
  if (!rows.length) {
    lines.push("今天沒有符合策略5綜合策略的候選標的。", "");
  }
  rows.forEach((item, index) => {
    const quote = quotes.get(item.code) || {};
    const track = scorecardTrack(tracker, "strategy5", item.code) || {};
    const entryPrice = scorecardEntryPrice(item, quote);
    const high = settlementHigh(track, quote, item);
    const low = settlementLow(track, quote, item);
    const exitPrice = high.price;
    const risePct = profitRate(entryPrice, exitPrice);
    const isCorrect = risePct > 0;
    if (isCorrect) correctCount += 1;
    lines.push(
      `提示標的 ${item.code} ${item.name || ""}`,
      `隔天盤中高點:${formatTradePrice(exitPrice)}元`,
      `漲幅${percent(risePct)}`,
      `判斷${isCorrect ? "正確" : "錯誤"}。`,
      ""
    );
  });
  if (rows.length) lines.push(`策略5判斷正確：${correctCount}/${rows.length}`);
  return lines.join("\n");
}

function buildStrategy3Report(payload, quotes, today, tracker) {
  const rows = reportRows(payload);
  let totalProfit = 0;
  const lines = [`策略3隔日沖成績單｜${dateSlash(today)}`, ""];
  if (!rows.length) {
    lines.push("今天沒有符合策略3隔日沖的候選標的。", "");
  }
  rows.forEach((item, index) => {
    const quote = quotes.get(item.code) || {};
    const track = scorecardTrack(tracker, "strategy3", item.code) || {};
    const entryPrice = strategy3EntryPrice(item, quote);
    const quoteLow = firstPrice(quote?.low, quote?.close);
    const high = strategy3SettlementHigh(track, quote, item);
    const exitPrice = high.price;
    const exitTime = settlementTimeLabel(high);
    const hasExitPrice = entryPrice > 0 && exitPrice > 0;
    const profit = profitAmount(entryPrice, exitPrice);
    const profitPct = profitRate(entryPrice, exitPrice);
    if (hasExitPrice) totalProfit += profit;
    lines.push(
      `#${index + 1} ${item.code} ${item.name || ""}`,
      tradeSummaryLine({
        date: strategy3EntryDate(item, payload, today),
        entryTime: strategy3EntryTime(item),
        entryPrice,
        exitDate: tradeDateLabel(today),
        exitTime,
        exitPrice,
        profitPct,
        profit,
      }),
      ""
    );
  });
  lines.push(`策略3合計：${money(totalProfit)}`);
  return lines.join("\n");
}

function buildStrategy2EntryEventReport(payload, quotes, today) {
  const events = Array.isArray(payload.events) ? payload.events : [];
  const entryRows = events.filter((event) => event.firstAAt && cleanNumber(event.firstAPrice));
  let totalProfit = 0;
  const lines = [`策略2進場區成績單｜${dateSlash(today)}`, ""];

  if (!events.length) {
    lines.push(
      "今日 09:00-13:30 當沖巡邏紀錄未取得，無法結算成績單。",
      `資料日期：${payload.date || "--"}｜報告日期：${today}`,
      ""
    );
    return lines.join("\n");
  }

  if (!entryRows.length) {
    lines.push("今日沒有符合進場區的正式進場紀錄。", "");
  }
  entryRows.forEach((event) => {
    const quote = quotes.get(event.code) || {};
    const entryPrice = cleanNumber(event.firstAPrice);
    const high = settlementHigh({
      observedHigh: event.highAfterA || event.highestPrice,
      observedHighAt: event.highAfterAAt || event.highestAt || event.lastAt,
    }, quote, event);
    const exitPrice = high.price;
    const profit = profitAmount(entryPrice, exitPrice);
    const profitPct = profitRate(entryPrice, exitPrice);
    totalProfit += profit;
    lines.push(
      `名單${event.code} ${event.name || ""}`,
      `交易日期 ${tradeDateLabel(today)}`,
      event.firstBAt ? `首次觀察時間：${event.firstBAt}  價格${formatTradePrice(event.firstBPrice)}元` : "",
      `首次進入進場區：${event.firstAAt}  進場價格:${formatTradePrice(entryPrice)}元`,
      `進場區後最高價：${formatTradePrice(high.price)}元`,
      `出場日期:${tradeDateLabel(today)}`,
      settlementTimeLabel(high) ? `出場時間:${settlementTimeLabel(high)}` : "",
      `出場價格/盤中高點:${formatTradePrice(exitPrice)}元`,
      `損益率:${percent(profitPct)}｜損益:${money(profit)}`,
      ""
    );
  });

  lines.push(`策略2進場區合計：${money(totalProfit)}`);
  return lines.join("\n");
}

function realtimeRadarRows(records, quotes) {
  const map = new Map();
  records
    .filter(isTaipeiMarketRecord)
    .sort((a, b) => String(a.entryAt || a.timestamp).localeCompare(String(b.entryAt || b.timestamp)) || String(a.code).localeCompare(String(b.code)))
    .forEach((record) => {
      const code = String(record.code || "");
      if (!code) return;
      const current = map.get(code);
      if (!current) {
        map.set(code, { ...record, entryAt: record.entryAt || record.timestamp });
        return;
      }
      const currentHigh = cleanNumber(current.observedHigh);
      const nextHigh = cleanNumber(record.observedHigh);
      if (nextHigh && (!currentHigh || nextHigh > currentHigh)) {
        current.observedHigh = nextHigh;
        current.observedHighAt = record.observedHighAt || record.timestamp;
      }
      const currentLow = cleanNumber(current.observedLow);
      const nextLow = cleanNumber(record.observedLow);
      if (nextLow && (!currentLow || nextLow < currentLow)) {
        current.observedLow = nextLow;
        current.observedLowAt = record.observedLowAt || record.timestamp;
      }
      current.score = Math.max(cleanNumber(current.score), cleanNumber(record.score));
    });

  return [...map.values()]
    .map((record) => {
      const quote = quotes.get(record.code) || {};
      const observedHigh = firstPrice(record.observedHigh, record.high);
      const quoteHigh = firstPrice(quote?.high, quote?.dayHigh, quote?.highestPrice);
      const exitPrice = Math.max(observedHigh, quoteHigh);
      const exitTime = observedHigh && observedHigh >= quoteHigh ? tradeTimeLabel(record.observedHighAt, "") : "";
      return { ...record, settlementHigh: { price: exitPrice, time: exitTime } };
    })
    .sort((a, b) => cleanNumber(b.score) - cleanNumber(a.score) || String(a.entryAt || a.timestamp).localeCompare(String(b.entryAt || b.timestamp)) || String(a.code).localeCompare(String(b.code)));
}

function buildRealtimeRadarReport(records, quotes, today) {
  let totalProfit = 0;
  const lines = [`即時雷達成績單｜${dateSlash(today)}`, ""];
  const rows = realtimeRadarRows(records, quotes);
  const scorecardRows = [];
  if (!rows.length) {
    lines.push(
      "今日尚未取得即時雷達盤中巡邏紀錄。",
      ""
    );
    return lines.join("\n");
  }
  rows.forEach((record, index) => {
    const quote = quotes.get(record.code) || {};
    const high = record.settlementHigh || settlementHigh(record, quote, record);
    const entryPrice = firstPrice(record.entryPrice, record.observedPrice, quote.open, quote.prevClose, quote.close);
    const exitPrice = high.price;
    const entryTime = tradeTimeLabel(record.entryAt || record.timestamp, "--:--");
    const highTime = settlementTimeLabel(high);
    const profit = profitAmount(entryPrice, exitPrice);
    const profitPct = profitRate(entryPrice, exitPrice);
    totalProfit += profit;
    scorecardRows.push({
      rank: index + 1,
      code: record.code,
      name: record.name || "",
      tradeDate: tradeDateLabel(record.timestamp, today),
      entryAt: record.entryAt || record.timestamp || "",
      entryTime,
      entryPrice,
      signals: (record.strategies?.length ? record.strategies : [record.strategy]).filter(Boolean),
      dayHigh: exitPrice,
      dayHighAt: highTime,
      profitPct,
      profit,
      source: high.source || "",
    });
    lines.push(
      `#${index + 1} ${record.code} ${record.name || ""}`,
      `交易日期 ${tradeDateLabel(record.timestamp, today)}`,
      `入場時間 ${entryTime}  進場價格:${formatTradePrice(entryPrice)}元`,
      "",
      `盤中高點:${formatTradePrice(exitPrice)}元${highTime ? `  最高時間:${highTime}` : ""}`,
      `損益率:${percent(profitPct)}｜損益:${money(profit)}`,
      ""
    );
  });
  lines.push(`即時雷達共 ${rows.length} 檔｜合計：${money(totalProfit)}`);
  const text = lines.join("\n");
  writeJson(REALTIME_RADAR_SCORECARD_FILE, {
    ok: true,
    source: "realtime-radar-scorecard",
    date: today,
    updatedAt: new Date().toISOString(),
    count: scorecardRows.length,
    totalProfit,
    rows: scorecardRows,
    text,
  });
  return text;
}

async function sendReports(reports, mailConfig) {
  const failures = [];
  for (const report of reports) {
    const parts = splitLineText(report.text);
    for (let index = 0; index < parts.length; index++) {
      const subject = parts.length > 1 ? `${report.subject}（${index + 1}/${parts.length}）` : report.subject;
      const text = parts.length > 1 ? `${subject}\n\n${parts[index]}` : parts[index];
      try {
        await sendMail({ ...mailConfig, subject, text });
        console.log(`report sent to ${mailConfig.to}: ${subject}`);
      } catch (error) {
        failures.push(`${subject}: ${error.message}`);
        console.error(`report failed: ${subject}`, error);
      }
    }
  }
  if (failures.length) throw new Error(`Report email failed: ${failures.join(" | ")}`);
}

function mailConfigFromEnv() {
  const to = process.env.REPORT_EMAIL_TO;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!to || !user || !pass) return null;
  return {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    user,
    pass,
    to,
  };
}

async function sendScorecardNotifications(reports) {
  if (process.env.SCORECARD_NOTIFY === "0" || process.env.DISABLE_SCORECARD_NOTIFY === "1") {
    console.log("scorecard notifications skipped; Google Sheet upload only");
    return false;
  }
  const mailConfig = mailConfigFromEnv();
  if (!mailConfig) {
    throw new Error("Missing notification config: set SMTP settings");
  }
  await sendReports(reports, mailConfig);
  return true;
}

function readIntradayCache() {
  const primary = readJson(SIGNAL_FILE, { date: "", records: [] });
  const reportSource = readJson(STRATEGY2_REPORT_FILE, { date: "", records: [] });
  if ((reportSource.records || []).length && reportSource.date === taipeiDateKey()) return reportSource;
  return primary;
}

async function main() {
  const today = taipeiDateKey();
  let cache = readIntradayCache();
  const scorecardTracker = readJson(SCORECARD_TRACK_FILE, { date: "", trades: {} });
  const strategy5Tracker = readJson(STRATEGY5_TRACK_FILE, { date: "", trades: {} });
  const openBuyPayload = readScorecardSource(OPEN_BUY_SCORECARD_SOURCE_FILE, OPEN_BUY_FILE, OPEN_BUY_BACKUP_FILE);
  const strategy3Payload = readStrategy3ScorecardSource(today);
  const strategy5Payload = readCacheWithBackup(STRATEGY5_FILE, STRATEGY5_BACKUP_FILE);
  const reportSlot = process.env.REPORT_SLOT || (taipeiHour() >= 15 ? "final" : "initial");
  const sentFile = path.join(REPORT_SENT_PATH, `${today}-${reportSlot}.json`);
  if (fs.existsSync(sentFile) && process.env.FORCE_REPORT !== "1") {
    console.log(`scorecard already sent for ${today} ${reportSlot}`);
    return;
  }
  if (cache.date && cache.date !== today) {
    console.log(`ignore stale intraday cache ${cache.date}; report date is ${today}`);
  }
  let records = cache.date === today ? mergeRecords(cache.records || []) : [];
  const codes = [...new Set([
    ...records.map((record) => record.code),
    ...reportRows(openBuyPayload).map((item) => item.code),
    ...reportRows(strategy3Payload).map((item) => item.code),
    ...reportRows(strategy5Payload).map((item) => item.code),
  ].filter(Boolean))];
  const quotes = await fetchRealtimeMap(codes);
  let totalProfit = 0;
  const reportExitTime = taipeiTimeLabel();
  if (Array.isArray(cache.events)) {
    const strategy2EntryText = buildStrategy2EntryEventReport(cache, quotes, today);
    console.log(strategy2EntryText);
    const openBuyText = buildOpenBuyReport(openBuyPayload, quotes, today, scorecardTracker);
    const strategy3Text = buildStrategy3Report(strategy3Payload, quotes, today, scorecardTracker);
    const strategy5Text = buildStrategy5Report(strategy5Payload, quotes, today, strategy5Tracker);
    const radarText = buildRealtimeRadarReport(records, quotes, today);
    console.log(openBuyText);
    console.log(strategy3Text);
    console.log(strategy5Text);
    console.log(radarText);

    const didNotify = await sendScorecardNotifications([
      { subject: `策略1開盤沖成績單｜${dateSlash(today)}`, text: openBuyText },
      { subject: `策略2進場區成績單｜${dateSlash(today)}`, text: strategy2EntryText },
      { subject: `策略3隔日沖成績單｜${dateSlash(today)}`, text: strategy3Text },
      { subject: `策略5綜合策略成績單｜${dateSlash(today)}`, text: strategy5Text },
      { subject: `即時雷達成績單｜${dateSlash(today)}`, text: radarText },
    ]);
    if (didNotify) {
      fs.mkdirSync(REPORT_SENT_PATH, { recursive: true });
      fs.writeFileSync(sentFile, `${JSON.stringify({ date: today, slot: reportSlot, sentAt: new Date().toISOString() }, null, 2)}\n`);
    }
    return;
  }

  const lines = [`策略2當沖雷達成績單｜${dateSlash(today)}`, ""];
  if (!records.length) {
    lines.push(
      "今日 09:00-13:30 當沖巡邏紀錄未取得，無法結算成績單。",
      `快取日期：${cache.date || "--"}｜報告日期：${today}`,
      "策略2成績單只接受盤中巡邏紀錄，不使用盤後補掃資料。",
      ""
    );
  }

  const grouped = {
    go: records.filter((record) => inferState(record).id === "go"),
    wait: records.filter((record) => inferState(record).id === "wait"),
    watch: records.filter((record) => inferState(record).id === "watch"),
  };

  Object.entries(grouped).forEach(([stateId, list]) => {
    if (!list.length) return;
    lines.push(`${STATE_LABELS[stateId]}｜${list.length} 筆`, "");
    list.forEach((record) => {
    const quote = quotes.get(record.code) || {};
    const high = settlementHigh(record, quote, record);
    const low = settlementLow(record, quote, record);
    const exitPrice = high.price;
    const entryPrice = firstPrice(record.entryPrice, record.observedPrice, quote.open, quote.prevClose, quote.close);
    const supportPrice = cleanNumber(record.supportPrice);
    const exitTime = settlementTimeLabel(high);
    const profit = profitAmount(entryPrice, exitPrice);
    const profitPct = profitRate(entryPrice, exitPrice);
    const state = inferState(record);
    totalProfit += profit;
    lines.push(
      dateSlash(record.timestamp),
      `分區：${state.label}${record.score ? `｜分數：${Math.round(cleanNumber(record.score))}` : ""}`,
      `標的：${record.code} ${record.name}`,
      `策略：${(record.strategies?.length ? record.strategies : [record.strategy]).filter(Boolean).join("、")}`,
      state.reason ? `判斷：${state.reason}` : "",
      supportPrice ? `支撐位：${formatTradePrice(supportPrice)}，不破後觀察` : "",
      tradeSummaryLine({
        date: tradeDateLabel(record.timestamp, today),
        entryTime: tradeTimeLabel(record.entryAt || record.timestamp, "--:--"),
        entryPrice,
        exitDate: tradeDateLabel(today),
        exitTime,
        exitPrice,
        profitPct,
        profit,
      }),
      `盤中最高：${formatTradePrice(high.price)}｜最高時間：${settlementTimeLabel(high)}｜盤中最低：${formatTradePrice(low.price)}｜最低時間：${settlementTimeLabel(low)}`,
      `建議進場價：${formatTradePrice(entryPrice)}`,
      `出場價：${formatTradePrice(exitPrice)}`,
      `預計獲利金額：${money(profit)}`,
      `預計獲利率：${profitPct >= 0 ? "+" : ""}${profitPct.toFixed(2)}%`,
      ""
    );
    });
  });

  lines.push(`我今天為您賺了：${money(totalProfit)}`);
  const text = lines.join("\n");
  console.log(text);
  const openBuyText = buildOpenBuyReport(openBuyPayload, quotes, today, scorecardTracker);
  const strategy3Text = buildStrategy3Report(strategy3Payload, quotes, today, scorecardTracker);
  const strategy5Text = buildStrategy5Report(strategy5Payload, quotes, today, strategy5Tracker);
  const radarText = buildRealtimeRadarReport(records, quotes, today);
  console.log(openBuyText);
  console.log(strategy3Text);
  console.log(strategy5Text);
  console.log(radarText);

  const didNotify = await sendScorecardNotifications([
    { subject: `策略1開盤沖成績單｜${dateSlash(today)}`, text: openBuyText },
    { subject: `策略2當沖雷達成績單｜${dateSlash(today)}`, text },
    { subject: `策略3隔日沖成績單｜${dateSlash(today)}`, text: strategy3Text },
    { subject: `策略5綜合策略成績單｜${dateSlash(today)}`, text: strategy5Text },
    { subject: `即時雷達成績單｜${dateSlash(today)}`, text: radarText },
  ]);
  if (didNotify) {
    fs.mkdirSync(REPORT_SENT_PATH, { recursive: true });
    fs.writeFileSync(sentFile, `${JSON.stringify({ date: today, slot: reportSlot, sentAt: new Date().toISOString() }, null, 2)}\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

