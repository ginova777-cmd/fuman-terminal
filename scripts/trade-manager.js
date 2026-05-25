const fs = require("fs");
const path = require("path");
const realtimeHandler = require("../api/realtime");
const { cleanNumber, formatTradePrice, roundTradePrice } = require("./intraday-radar-rules");
const { hasLineConfig, sendLineText } = require("./line-push");

const ROOT = path.resolve(__dirname, "..");
const STRATEGY2_REPORT_FILE = path.join(ROOT, "data", "strategy2-intraday-latest.json");
const STATE_FILE = path.join(ROOT, ".trade-manager-cache", "state.json");

const BUDGET_PER_TRADE = Math.max(1000, Number(process.env.TRADE_MANAGER_BUDGET_PER_TRADE || 20000));
const TAKE_PROFIT_PCT = Number(process.env.TRADE_MANAGER_TAKE_PROFIT_PCT || 3);
const STOP_LOSS_PCT = Number(process.env.TRADE_MANAGER_STOP_LOSS_PCT || 2);
const MAX_DAILY_TRADES = Math.max(1, Number(process.env.TRADE_MANAGER_MAX_DAILY_TRADES || 5));
const DRY_RUN = process.env.TRADE_MANAGER_DRY_RUN === "1";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function taipeiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    dateKey: `${byType.year}-${byType.month}-${byType.day}`,
    time: `${byType.hour}:${byType.minute}`,
    minutes: Number(byType.hour) * 60 + Number(byType.minute),
  };
}

function defaultState(dateKey) {
  return {
    date: dateKey,
    notified: {},
    positions: {},
    closed: {},
    dailyTradeCount: 0,
  };
}

function loadState(dateKey) {
  const state = readJson(STATE_FILE, defaultState(dateKey));
  if (state.date !== dateKey) return defaultState(dateKey);
  state.notified ||= {};
  state.positions ||= {};
  state.closed ||= {};
  state.dailyTradeCount ||= Object.keys(state.positions).length + Object.keys(state.closed).length;
  return state;
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function lotPlan(entryPrice) {
  const price = cleanNumber(entryPrice);
  if (!price) return { shares: 0, lots: 0, amount: 0 };
  const shares = Math.max(1000, Math.floor(BUDGET_PER_TRADE / price / 1000) * 1000);
  const lots = Math.max(1, Math.floor(shares / 1000));
  return {
    shares: lots * 1000,
    lots,
    amount: Math.round(lots * 1000 * price),
  };
}

function profitText(entry, current, shares) {
  const pnl = Math.round((cleanNumber(current) - cleanNumber(entry)) * cleanNumber(shares));
  const pct = entry ? ((cleanNumber(current) - cleanNumber(entry)) / cleanNumber(entry)) * 100 : 0;
  const sign = pnl >= 0 ? "+" : "";
  return {
    pct,
    pnl,
    text: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%｜${sign}${pnl.toLocaleString("zh-TW")} 元`,
  };
}

function buildBuyMessage(event, position) {
  return [
    "交易管家｜策略2-A區 可買通知",
    "",
    `股票：${event.code} ${event.name || ""}`,
    `進場時間：${event.firstAAt || "--"}`,
    `建議進場價：${formatTradePrice(position.entryPrice)} 元`,
    `建議投入：${position.amount.toLocaleString("zh-TW")} 元（${position.lots} 張）`,
    `停利價：${formatTradePrice(position.takeProfitPrice)} 元（+${TAKE_PROFIT_PCT}%）`,
    `停損價：${formatTradePrice(position.stopLossPrice)} 元（-${STOP_LOSS_PCT}%）`,
    `今日通知：${position.dailyTradeCount}/${MAX_DAILY_TRADES} 筆`,
    "",
    `原因：${event.stateReason || "首次進入A區，量價條件符合。"}`
  ].join("\n");
}

function buildExitMessage(position, quote, action) {
  const current = cleanNumber(quote?.close) || cleanNumber(position.lastPrice) || cleanNumber(position.entryPrice);
  const pnl = profitText(position.entryPrice, current, position.shares);
  const title = action === "takeProfit" ? "可賣通知｜停利" : "停損通知";
  return [
    `交易管家｜策略2-A區 ${title}`,
    "",
    `股票：${position.code} ${position.name || ""}`,
    `進場價：${formatTradePrice(position.entryPrice)} 元`,
    `目前價：${formatTradePrice(current)} 元`,
    `損益率/損益：${pnl.text}`,
    `建議動作：${action === "takeProfit" ? "停利出場" : "停損出場"}`,
  ].join("\n");
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

async function notify(text) {
  if (!hasLineConfig()) throw new Error("Missing LINE_CHANNEL_ACCESS_TOKEN and LINE_TO or LINE_USER_ID");
  if (DRY_RUN) {
    console.log(text);
    return;
  }
  await sendLineText(text);
}

function getFreshAEvents(payload, today) {
  if (payload.date !== today) return [];
  return (payload.events || [])
    .filter((event) => event.firstAAt)
    .map((event) => ({
      ...event,
      code: normalizeCode(event.code),
      entryPrice: cleanNumber(event.firstAPrice),
    }))
    .filter((event) => event.code && event.entryPrice)
    .sort((a, b) => String(a.firstAAt).localeCompare(String(b.firstAAt)));
}

async function main() {
  const now = taipeiParts();
  const payload = readJson(STRATEGY2_REPORT_FILE, { date: "", events: [] });
  const state = loadState(now.dateKey);
  const events = getFreshAEvents(payload, now.dateKey);
  const eventByCode = new Map(events.map((event) => [event.code, event]));
  const codes = [...new Set([...events.map((event) => event.code), ...Object.keys(state.positions)])];
  const quotesPayload = codes.length ? await callRealtime(codes) : { quotes: [] };
  const quoteByCode = new Map((quotesPayload.quotes || []).map((quote) => [String(quote.code), quote]));
  const messages = [];

  for (const event of events) {
    if (state.notified[event.code] || state.positions[event.code] || state.closed[event.code]) continue;
    if (state.dailyTradeCount >= MAX_DAILY_TRADES) continue;
    const quote = quoteByCode.get(event.code);
    const entryPrice = cleanNumber(event.entryPrice) || cleanNumber(quote?.close);
    if (!entryPrice) continue;
    const plan = lotPlan(entryPrice);
    const position = {
      code: event.code,
      name: event.name || quote?.name || "",
      strategy: "strategy2-A",
      entryTime: event.firstAAt || now.time,
      entryPrice,
      takeProfitPrice: roundTradePrice(entryPrice * (1 + TAKE_PROFIT_PCT / 100)),
      stopLossPrice: roundTradePrice(entryPrice * (1 - STOP_LOSS_PCT / 100)),
      shares: plan.shares,
      lots: plan.lots,
      amount: plan.amount,
      openedAt: new Date().toISOString(),
      lastPrice: cleanNumber(quote?.close) || entryPrice,
      dailyTradeCount: state.dailyTradeCount + 1,
    };
    state.positions[event.code] = position;
    state.notified[event.code] = { buyAt: new Date().toISOString(), entryTime: position.entryTime };
    state.dailyTradeCount += 1;
    messages.push(buildBuyMessage(event, position));
  }

  for (const [code, position] of Object.entries(state.positions)) {
    const quote = quoteByCode.get(code);
    const current = cleanNumber(quote?.close) || cleanNumber(position.lastPrice);
    if (!current) continue;
    position.lastPrice = current;
    position.lastUpdatedAt = new Date().toISOString();
    let action = "";
    if (current >= cleanNumber(position.takeProfitPrice)) action = "takeProfit";
    if (current <= cleanNumber(position.stopLossPrice)) action = "stopLoss";
    if (!action) continue;
    messages.push(buildExitMessage(position, quote, action));
    state.closed[code] = {
      ...position,
      exitPrice: current,
      exitAction: action,
      closedAt: new Date().toISOString(),
    };
    delete state.positions[code];
  }

  writeJson(STATE_FILE, state);
  if (!messages.length) {
    console.log(`trade manager ${now.dateKey} ${now.time}: no new action`);
    return;
  }
  await notify(messages.join("\n\n---\n\n"));
  console.log(`trade manager ${now.dateKey} ${now.time}: sent ${messages.length} message(s)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
