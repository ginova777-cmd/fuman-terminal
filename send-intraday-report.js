const fs = require("fs");
const path = require("path");
const tls = require("tls");
const { cleanNumber, formatTradePrice } = require("./intraday-radar-rules");

const ROOT = path.resolve(__dirname, "..");
const SIGNAL_FILE = path.join(ROOT, ".intraday-cache", "signals.json");
const BASE_URL = process.env.FUMAN_BASE_URL || "https://fuman-terminal.vercel.app";
const LOT_SIZE = Number(process.env.REPORT_LOT_SIZE || 1000);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

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

function dateSlash(value) {
  return String(value || "").replace(/-/g, "/");
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
    current.observedHigh = Math.max(cleanNumber(current.observedHigh), cleanNumber(record.observedHigh));
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

async function main() {
  const cache = readJson(SIGNAL_FILE, { date: "", records: [] });
  const today = cache.date || taipeiDateKey();
  const records = mergeRecords(cache.records || []);
  const codes = [...new Set(records.map((record) => record.code))];
  const quotes = await fetchRealtimeMap(codes);
  let totalProfit = 0;

  const lines = [`策略2當沖雷達成績單｜${dateSlash(today)}`, ""];
  if (!records.length) {
    lines.push("今天沒有偵測到符合條件的標的。", "");
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
    const exitPrice = cleanNumber(quote.high) || cleanNumber(record.observedHigh) || cleanNumber(record.observedPrice);
    const entryPrice = cleanNumber(record.entryPrice);
    const supportPrice = cleanNumber(record.supportPrice);
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

  const to = process.env.REPORT_EMAIL_TO;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!to || !user || !pass) {
    console.log("SMTP secrets missing; report printed only.");
    return;
  }
  await sendMail({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    user,
    pass,
    to,
    subject: `策略2當沖雷達成績單｜${dateSlash(today)}`,
    text,
  });
  console.log(`report sent to ${to}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
