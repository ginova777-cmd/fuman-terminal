const fs = require("fs");
const path = require("path");
const tls = require("tls");
const { cleanNumber, formatTradePrice } = require("./intraday-radar-rules");

const ROOT = path.resolve(__dirname, "..");
const SIGNAL_FILE = path.join(ROOT, ".intraday-cache", "signals.json");
const SCORECARD_TRACK_FILE = path.join(ROOT, ".intraday-cache", "scorecard-trades.json");
const STRATEGY2_REPORT_FILE = path.join(ROOT, "data", "strategy2-intraday-latest.json");
const OPEN_BUY_FILE = path.join(ROOT, "data", "open-buy-latest.json");
const OPEN_BUY_BACKUP_FILE = path.join(ROOT, "data", "open-buy-backup.json");
const OPEN_BUY_SCORECARD_SOURCE_FILE = path.join(ROOT, "data", "open-buy-scorecard-source.json");
const STRATEGY3_FILE = path.join(ROOT, "data", "strategy3-latest.json");
const STRATEGY3_BACKUP_FILE = path.join(ROOT, "data", "strategy3-backup.json");
const STRATEGY3_SCORECARD_SOURCE_FILE = path.join(ROOT, "data", "strategy3-scorecard-source.json");
const BASE_URL = process.env.FUMAN_BASE_URL || "https://fuman-terminal.vercel.app";
const LOT_SIZE = Number(process.env.REPORT_LOT_SIZE || 1000);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

const REPORT_SENT_PATH = process.env.REPORT_SENT_DIR || path.join(ROOT, ".intraday-report-cache", "sent-reports");

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

function taipeiTimeLabel(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function strategy3EntryTime(item) {
  return tradeTimeLabel(item.quoteTime, "13:30");
}

function strategy3EntryDate(item, payload, today) {
  return tradeDateLabel(item.quoteDate || payload.usedDate || payload.date || today);
}

function tradeSummaryLine({ date, entryTime, entryPrice, exitDate, exitTime, exitPrice, profitPct, profit }) {
  const parts = [
    `日期 ${date}`,
    `時間${entryTime}`,
    `進場價${formatTradePrice(entryPrice)}元`,
  ];
  if (exitDate) parts.push(`出場日期:${exitDate}`);
  parts.push(
    `出場時間${exitTime}`,
    `出場價格:${formatTradePrice(exitPrice)}元`,
    `漲幅:${percent(profitPct)}`,
    `預計獲利:${money(profit)}`,
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

function settlementHigh(track, quote) {
  const tracked = cleanNumber(track?.observedHigh);
  if (tracked) return { price: tracked, time: tradeTimeLabel(track?.observedHighAt, "--:--"), source: "patrol" };
  const quoteHigh = cleanNumber(quote?.high);
  if (quoteHigh) return { price: quoteHigh, time: tradeTimeLabel(quote?.time, "13:30"), source: "market" };
  return { price: 0, time: "--:--", source: "missing" };
}

function settlementLow(track, quote) {
  const tracked = cleanNumber(track?.observedLow);
  if (tracked) return { price: tracked, time: tradeTimeLabel(track?.observedLowAt, "--:--"), source: "patrol" };
  const quoteLow = cleanNumber(quote?.low);
  if (quoteLow) return { price: quoteLow, time: tradeTimeLabel(quote?.time, "13:30"), source: "market" };
  return { price: 0, time: "--:--", source: "missing" };
}

function settlementTimeLabel(settlement) {
  return settlement.time;
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

function reportRows(payload, limit = 20) {
  return (payload.matches || [])
    .filter((item) => item && item.code)
    .slice(0, limit);
}

function isTaipeiMarketRecord(record) {
  const match = String(record?.timestamp || "").match(/\s(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return true;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 9 * 60 && minutes <= 13 * 60 + 45;
}

const STATE_ORDER = { go: 1, wait: 2, watch: 3 };
const STATE_LABELS = {
  go: "A區 可進場",
  wait: "B區 待確認",
  watch: "C區 觀察",
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
  const lines = [`策略1開盤沖成績單｜${dateSlash(today)}`, ""];
  if (!rows.length) {
    lines.push("今天沒有符合策略1開盤沖的候選標的。", "");
  }
  rows.forEach((item) => {
    const quote = quotes.get(item.code) || {};
    const track = scorecardTrack(tracker, "openBuy", item.code) || {};
    const entryPrice = cleanNumber(track.entryPrice) || cleanNumber(quote.open);
    const high = settlementHigh(track, quote);
    const exitPrice = high.price;
    const profit = entryPrice ? (exitPrice - entryPrice) * LOT_SIZE : 0;
    const profitPct = entryPrice ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
    totalProfit += profit;
    lines.push(
      `名單${item.code} ${item.name || ""}`,
      `交易日期 ${tradeDateLabel(today)}`,
      `入場時間 09:00  進場價${formatTradePrice(entryPrice)}元`,
      `出場日期:${tradeDateLabel(today)}`,
      `出場價格:${formatTradePrice(exitPrice)}元`,
      `漲幅:${percent(profitPct)} 預計獲利:${money(profit)}`,
      ""
    );
  });
  lines.push(`策略1合計：${money(totalProfit)}`);
  return lines.join("\n");
}

function buildStrategy3Report(payload, quotes, today, tracker) {
  const rows = reportRows(payload);
  let totalProfit = 0;
  const lines = [`策略3隔日沖成績單｜${dateSlash(today)}`, ""];
  lines.push(`資料時間：${payload.updatedAt || "--"}｜候選 ${payload.count ?? rows.length} 檔`, "");
  if (!rows.length) {
    lines.push("今天沒有符合策略3隔日沖的候選標的。", "");
  }
  rows.forEach((item, index) => {
    const quote = quotes.get(item.code) || {};
    const track = scorecardTrack(tracker, "strategy3", item.code) || {};
    const entryPrice = cleanNumber(item.close);
    const quoteHigh = cleanNumber(quote?.high);
    const quoteLow = cleanNumber(quote?.low);
    const high = quoteHigh
      ? { price: quoteHigh, time: tradeTimeLabel(quote?.time, "13:30"), source: "market" }
      : settlementHigh(track, quote);
    const low = quoteLow
      ? { price: quoteLow, time: tradeTimeLabel(quote?.time, "13:30"), source: "market" }
      : settlementLow(track, quote);
    const exitPrice = high.price;
    const exitTime = settlementTimeLabel(high);
    const hasExitPrice = entryPrice > 0 && exitPrice > 0;
    const profit = hasExitPrice ? (exitPrice - entryPrice) * LOT_SIZE : 0;
    const profitPct = hasExitPrice ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
    const reason = (item.matches || []).map((match) => match.reason).filter(Boolean).join("；");
    if (hasExitPrice) totalProfit += profit;
    lines.push(
      `#${index + 1} ${item.code} ${item.name || ""}`,
      `分數：${Math.round(cleanNumber(item.score || item.overnightScore)) || "--"}｜狀態：${item.overnightState || "--"}`,
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
      `收盤價：${formatTradePrice(item.close)}｜今日最高/出場：${formatTradePrice(exitPrice)}｜出場時間：${exitTime}`,
      `盤中最高：${formatTradePrice(high.price)}｜最高時間：${settlementTimeLabel(high)}｜盤中最低：${formatTradePrice(low.price)}｜最低時間：${settlementTimeLabel(low)}`,
      `漲幅：${percent(cleanNumber(item.percent))}｜成交量：${Math.round(cleanNumber(item.volumeLots || item.tradeVolume / 1000)).toLocaleString("zh-TW")} 張`,
      `周轉率：${(cleanNumber(item.turnoverRate)).toFixed(2)}%｜量比：${(cleanNumber(item.volumeRatio)).toFixed(2)}`,
      `預計獲利金額：${money(profit)}`,
      `預計獲利率：${percent(profitPct)}`,
      reason ? `原因：${reason}` : "",
      ""
    );
  });
  lines.push(`策略3合計：${money(totalProfit)}`);
  return lines.join("\n");
}

function buildStrategy2EventReport(payload, today) {
  const events = Array.isArray(payload.events) ? payload.events : [];
  const aRows = events.filter((event) => event.firstAAt);
  const bRows = events.filter((event) => !event.firstAAt && event.firstBAt);
  let totalProfit = 0;
  let bTotalProfit = 0;
  const lines = [`策略2當沖成績單｜${dateSlash(today)}`, "", "來源：09:00-13:30 盤中巡邏紀錄", ""];

  if (!events.length) {
    lines.push(
      "今日 09:00-13:30 當沖巡邏紀錄未取得，無法結算成績單。",
      `資料日期：${payload.date || "--"}｜報告日期：${today}`,
      ""
    );
    return lines.join("\n");
  }

  lines.push(`A區 可進場｜正式進場回測｜${aRows.length} 筆`, "");
  aRows.forEach((event) => {
    const entryPrice = cleanNumber(event.firstAPrice);
    const exitPrice = cleanNumber(event.highAfterA) || cleanNumber(event.highestPrice);
    const profit = entryPrice ? (exitPrice - entryPrice) * LOT_SIZE : 0;
    const profitPct = entryPrice ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
    totalProfit += profit;
    lines.push(
      `名單${event.code} ${event.name || ""}`,
      `交易日期 ${tradeDateLabel(today)}`,
      `首次進入B區：${event.firstBAt || "未記錄"}  價格${formatTradePrice(event.firstBPrice)}元`,
      `B區後最高價：${formatTradePrice(event.highAfterB)}元`,
      `首次進入A區：${event.firstAAt}  進場價${formatTradePrice(entryPrice)}元`,
      `A區後最高價：${formatTradePrice(event.highAfterA)}元`,
      `出場日期:${tradeDateLabel(today)}`,
      `出場價格:${formatTradePrice(exitPrice)}元`,
      `漲幅:${percent(profitPct)} 預計獲利:${money(profit)}`,
      `分數：${Math.round(cleanNumber(event.maxScore)) || "--"}`,
      `策略：${(event.strategies || []).join("、") || "--"}`,
      event.stateReason ? `判斷：${event.stateReason}` : "",
      cleanNumber(event.supportPrice) ? `支撐位：${formatTradePrice(event.supportPrice)}，不破後觀察` : "",
      ""
    );
  });

  lines.push(`B區 待確認｜未正式進場觀察｜${bRows.length} 筆`, "");
  bRows.forEach((event) => {
    const entryPrice = cleanNumber(event.firstBPrice);
    const exitPrice = cleanNumber(event.highAfterB) || cleanNumber(event.highestPrice);
    const profit = entryPrice ? (exitPrice - entryPrice) * LOT_SIZE : 0;
    const profitPct = entryPrice ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
    bTotalProfit += profit;
    lines.push(
      `名單${event.code} ${event.name || ""}`,
      `交易日期 ${tradeDateLabel(today)}`,
      `首次進入B區：${event.firstBAt}  價格${formatTradePrice(event.firstBPrice)}元`,
      `B區後最高價：${formatTradePrice(event.highAfterB || event.highestPrice)}元`,
      `B區觀察漲幅:${percent(profitPct)} 預計獲利:${money(profit)}`,
      "首次進入A區：未進入",
      `最高分數：${Math.round(cleanNumber(event.maxScore)) || "--"}`,
      `策略：${(event.strategies || []).join("、") || "--"}`,
      event.stateReason ? `判斷：${event.stateReason}` : "",
      cleanNumber(event.supportPrice) ? `支撐位：${formatTradePrice(event.supportPrice)}，不破後觀察` : "",
      "結果：未進入A區，不列入策略2正式合計；另列B區觀察合計",
      ""
    );
  });

  lines.push(`策略2合計：${money(totalProfit)}`);
  lines.push(`B區觀察合計：${money(bTotalProfit)}`);
  lines.push(`A區進場：${aRows.length} 筆`);
  lines.push(`B區未進場：${bRows.length} 筆`);
  return lines.join("\n");
}

async function sendReports(reports, mailConfig) {
  const failures = [];
  for (const report of reports) {
    try {
      await sendMail({ ...mailConfig, subject: report.subject, text: report.text });
      console.log(`report sent to ${mailConfig.to}: ${report.subject}`);
    } catch (error) {
      failures.push(`${report.subject}: ${error.message}`);
      console.error(`report failed: ${report.subject}`, error);
    }
  }
  if (failures.length) throw new Error(`Report email failed: ${failures.join(" | ")}`);
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
  const openBuyPayload = readScorecardSource(OPEN_BUY_SCORECARD_SOURCE_FILE, OPEN_BUY_FILE, OPEN_BUY_BACKUP_FILE);
  const strategy3Payload = readScorecardSource(STRATEGY3_SCORECARD_SOURCE_FILE, STRATEGY3_FILE, STRATEGY3_BACKUP_FILE);
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
  ].filter(Boolean))];
  const quotes = await fetchRealtimeMap(codes);
  let totalProfit = 0;
  const reportExitTime = taipeiTimeLabel();
  if (Array.isArray(cache.events)) {
    const text = buildStrategy2EventReport(cache, today);
    console.log(text);
    const openBuyText = buildOpenBuyReport(openBuyPayload, quotes, today, scorecardTracker);
    const strategy3Text = buildStrategy3Report(strategy3Payload, quotes, today, scorecardTracker);
    console.log(openBuyText);
    console.log(strategy3Text);

    const to = process.env.REPORT_EMAIL_TO;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!to || !user || !pass) {
      throw new Error("Missing REPORT_EMAIL_TO, SMTP_USER, or SMTP_PASS");
    }
    await sendReports([
      { subject: `策略1開盤沖成績單｜${dateSlash(today)}`, text: openBuyText },
      { subject: `策略2當沖成績單｜${dateSlash(today)}`, text },
      { subject: `策略3隔日沖成績單｜${dateSlash(today)}`, text: strategy3Text },
    ], {
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT || 465),
      user,
      pass,
      to,
    });
    fs.mkdirSync(REPORT_SENT_PATH, { recursive: true });
    fs.writeFileSync(sentFile, `${JSON.stringify({ date: today, slot: reportSlot, sentAt: new Date().toISOString(), to }, null, 2)}\n`);
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
    const high = settlementHigh(record, quote);
    const low = settlementLow(record, quote);
    const exitPrice = high.price;
    const entryPrice = cleanNumber(record.entryPrice);
    const supportPrice = cleanNumber(record.supportPrice);
    const exitTime = settlementTimeLabel(high);
    const profit = entryPrice ? (exitPrice - entryPrice) * LOT_SIZE : 0;
    const profitPct = entryPrice ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
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
        entryTime: tradeTimeLabel(record.entryAt || record.timestamp, "09:00"),
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
  console.log(openBuyText);
  console.log(strategy3Text);

  const to = process.env.REPORT_EMAIL_TO;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!to || !user || !pass) {
    throw new Error("Missing REPORT_EMAIL_TO, SMTP_USER, or SMTP_PASS");
  }
  await sendReports([
    { subject: `策略1開盤沖成績單｜${dateSlash(today)}`, text: openBuyText },
    { subject: `策略2當沖雷達成績單｜${dateSlash(today)}`, text },
    { subject: `策略3隔日沖成績單｜${dateSlash(today)}`, text: strategy3Text },
  ], {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    user,
    pass,
    to,
  });
  fs.mkdirSync(REPORT_SENT_PATH, { recursive: true });
  fs.writeFileSync(sentFile, `${JSON.stringify({ date: today, slot: reportSlot, sentAt: new Date().toISOString(), to }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
