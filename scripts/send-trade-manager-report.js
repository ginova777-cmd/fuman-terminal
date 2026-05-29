const fs = require("fs");
const path = require("path");
const tls = require("tls");
const realtimeHandler = require("../api/realtime");
const { cleanNumber, formatTradePrice } = require("./intraday-radar-rules");
const { hasLineConfig, sendLineText, splitLineText } = require("./line-push");

const { ROOT, statePath } = require("./runtime-paths");
const STATE_FILE = statePath("trade-manager-state.json");
const REQUIRED_DAILY_TRADES = Math.max(1, Number(process.env.TRADE_MANAGER_REQUIRED_DAILY_TRADES || 10));

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

function callRealtime(codes) {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", query: { codes: codes.join(",") } };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        if (this.statusCode >= 400) reject(new Error(payload?.error || `realtime HTTP ${this.statusCode}`));
        else resolve(payload);
      },
      end() { resolve({ ok: false, quotes: [] }); },
    };
    Promise.resolve(realtimeHandler(req, res)).catch(reject);
  });
}

function formatMoney(value) {
  const number = Math.round(cleanNumber(value));
  const sign = number >= 0 ? "+" : "";
  return `${sign}${number.toLocaleString("zh-TW")} 元`;
}

function positionResult(position, quote = null) {
  const entry = cleanNumber(position.entryPrice);
  const exit = cleanNumber(position.exitPrice) || cleanNumber(quote?.close) || cleanNumber(position.lastPrice) || entry;
  const shares = cleanNumber(position.shares);
  const pnl = (exit - entry) * shares;
  const pct = entry ? ((exit - entry) / entry) * 100 : 0;
  return {
    exit,
    pnl,
    pct,
    pctText: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
    pnlText: formatMoney(pnl),
  };
}

function actionLabel(action) {
  if (action === "takeProfit") return "停利";
  if (action === "stopLoss") return "停損";
  if (action === "dayClose") return "當沖出場";
  return "追蹤中";
}

function timeLabel(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "--";
  return date.toLocaleTimeString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function maxDrawdownFromResults(results) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const result of results) {
    equity += result.pnl;
    if (equity > peak) peak = equity;
    const drawdown = peak - equity;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  return maxDrawdown;
}

function maxLosingStreak(results) {
  let current = 0;
  let max = 0;
  for (const result of results) {
    if (result.pnl < 0) {
      current += 1;
      if (current > max) max = current;
    } else {
      current = 0;
    }
  }
  return max;
}

function buildReport(state, quotes) {
  const closed = Object.values(state.closed || {})
    .sort((a, b) => Date.parse(a.closedAt || "") - Date.parse(b.closedAt || ""));
  const open = Object.values(state.positions || {});
  const rows = [...closed, ...open];
  const closedResults = closed.map((item) => positionResult(item, quotes.get(item.code)));
  const openResults = open.map((item) => positionResult(item, quotes.get(item.code)));
  const totalPnl = [...closedResults, ...openResults].reduce((sum, item) => sum + item.pnl, 0);
  const wins = closedResults.filter((item) => item.pnl > 0).length;
  const winRate = closed.length ? `${((wins / closed.length) * 100).toFixed(0)}%` : "--";
  const maxDrawdown = maxDrawdownFromResults(closedResults);
  const losingStreak = maxLosingStreak(closedResults);
  const lines = [
    `交易管家成績單｜${dateSlash(state.date)}`,
    "",
    `今日交易計畫：${rows.length}/${REQUIRED_DAILY_TRADES} 筆`,
    `已出場：${closed.length} 筆｜追蹤中：${open.length} 筆`,
    `日內結清：${closed.length}/${rows.length || REQUIRED_DAILY_TRADES} 筆${open.length ? "｜尚有未結清部位" : "｜全數日內"}`,
    `已出場勝率：${winRate}`,
    `最大回撤：${formatMoney(-maxDrawdown)}`,
    `最大連輸：${losingStreak} 筆`,
    `合計損益：${formatMoney(totalPnl)}`,
    "",
  ];

  if (!rows.length) {
    lines.push("今天交易管家沒有建立交易計畫。");
    return lines.join("\n");
  }

  closed.forEach((item, index) => {
    const result = positionResult(item, quotes.get(item.code));
    lines.push(...[
      `#${index + 1} ${item.code} ${item.name || ""}`,
      `狀態：${actionLabel(item.exitAction)}`,
      `日內：${item.exitAction === "dayClose" || item.closedAt ? "是" : "否"}${item.forcedMinimumTrade ? "｜保底交易" : ""}`,
      `進場時間：${item.entryTime || "--"}  進場價格:${formatTradePrice(item.entryPrice)}元`,
      `出場時間：${timeLabel(item.closedAt)}  出場價格:${formatTradePrice(result.exit)}元`,
      `損益率:${result.pctText}｜損益:${result.pnlText}`,
      item.stopLossBasis ? `智慧停損：${formatTradePrice(item.stopLossPrice)}元｜${item.stopLossBasis}` : "",
      ""
    ].filter(Boolean));
  });

  open.forEach((item, index) => {
    const result = positionResult(item, quotes.get(item.code));
    lines.push(...[
      `#${closed.length + index + 1} ${item.code} ${item.name || ""}`,
      "狀態：追蹤中",
      `日內：尚未結清${item.forcedMinimumTrade ? "｜保底交易" : ""}`,
      `進場時間：${item.entryTime || "--"}  進場價格:${formatTradePrice(item.entryPrice)}元`,
      `目前價格:${formatTradePrice(result.exit)}元`,
      `損益率:${result.pctText}｜損益:${result.pnlText}`,
      `停利價:${formatTradePrice(item.takeProfitPrice)}元｜停損價:${formatTradePrice(item.stopLossPrice)}元`,
      item.stopLossBasis ? `智慧停損：${item.stopLossBasis}` : "",
      ""
    ].filter(Boolean));
  });

  return lines.join("\n").trim();
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
}

async function sendMail({ subject, text }) {
  console.log("trade manager email disabled; Google Sheet upload only");
  return false;
  const to = process.env.REPORT_EMAIL_TO;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!to || !user || !pass) return false;
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT || 465);
  const socket = tls.connect({ host, port, servername: host });
  await new Promise((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
  });
  await smtpCommand(socket, null);
  await smtpCommand(socket, "EHLO fuman-terminal");
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
  return true;
}

async function main() {
  const today = taipeiDateKey();
  const state = readJson(STATE_FILE, { date: today, positions: {}, closed: {} });
  if (state.date !== today) {
    state.date = today;
    state.positions = {};
    state.closed = {};
  }
  const codes = [...new Set([...Object.keys(state.positions || {}), ...Object.keys(state.closed || {})])];
  let quotesPayload = { quotes: [] };
  try {
    quotesPayload = codes.length ? await callRealtime(codes) : { quotes: [] };
  } catch (error) {
    console.error(`trade manager report realtime skipped: ${error.message}`);
  }
  const quotes = new Map((quotesPayload.quotes || []).map((quote) => [String(quote.code), quote]));
  const report = buildReport(state, quotes);
  const subject = `交易管家成績單｜${dateSlash(today)}`;
  console.log(report);

  console.log("trade manager report notifications skipped; Google Sheet upload only");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

