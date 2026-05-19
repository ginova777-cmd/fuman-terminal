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

async function main() {
  const cache = readJson(SIGNAL_FILE, { date: "", records: [] });
  const today = cache.date || taipeiDateKey();
  const records = cache.records || [];
  const codes = [...new Set(records.map((record) => record.code))];
  const quotes = await fetchRealtimeMap(codes);
  let totalProfit = 0;

  const lines = [`策略2當沖雷達成績單｜${dateSlash(today)}`, ""];
  if (!records.length) {
    lines.push("今天沒有偵測到符合條件的標的。", "");
  }

  records.forEach((record) => {
    const quote = quotes.get(record.code) || {};
    const exitPrice = cleanNumber(quote.high) || cleanNumber(record.observedHigh) || cleanNumber(record.observedPrice);
    const entryPrice = cleanNumber(record.entryPrice);
    const profit = entryPrice ? (exitPrice - entryPrice) * LOT_SIZE : 0;
    const profitPct = entryPrice ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
    totalProfit += profit;
    lines.push(
      dateSlash(record.timestamp),
      `標的：${record.code} ${record.name}`,
      `策略：${record.strategy}`,
      `建議進場價：${formatTradePrice(entryPrice)}`,
      `出場價：${formatTradePrice(exitPrice)}`,
      `預計獲利金額：${money(profit)}`,
      `預計獲利率：${profitPct >= 0 ? "+" : ""}${profitPct.toFixed(2)}%`,
      ""
    );
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
