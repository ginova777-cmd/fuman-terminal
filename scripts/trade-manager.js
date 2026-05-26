const fs = require("fs");
const path = require("path");
const realtimeHandler = require("../api/realtime");
const { cleanNumber, formatTradePrice, roundTradePrice } = require("./intraday-radar-rules");
const { hasLineConfig, sendLineFlex, sendLineText } = require("./line-push");
const { tradeBuyFlex, tradeExitFlex } = require("./line-flex-templates");

const { ROOT, dataPath, statePath } = require("./runtime-paths");
const STRATEGY2_REPORT_FILE = dataPath("strategy2-intraday-latest.json");
const STATE_FILE = statePath("trade-manager-state.json");

const BUDGET_PER_TRADE = Math.max(1000, Number(process.env.TRADE_MANAGER_BUDGET_PER_TRADE || 20000));
const TAKE_PROFIT_PCT = Number(process.env.TRADE_MANAGER_TAKE_PROFIT_PCT || 3);
const STOP_LOSS_PCT = Number(process.env.TRADE_MANAGER_STOP_LOSS_PCT || 2);
const MAX_DAILY_TRADES = Math.max(1, Number(process.env.TRADE_MANAGER_MAX_DAILY_TRADES || 5));
const DRY_RUN = process.env.TRADE_MANAGER_DRY_RUN === "1";
const BACKFILL_EXISTING = process.env.TRADE_MANAGER_BACKFILL_EXISTING === "1";
const MIN_A_SCORE = Number(process.env.TRADE_MANAGER_MIN_A_SCORE || 80);
const MIN_VOLUME_LOTS = Number(process.env.TRADE_MANAGER_MIN_VOLUME_LOTS || 2000);
const VOLUME_MILESTONES = [2000, 5000, 10000];
const MIN_TRADE_VALUE = Number(process.env.TRADE_MANAGER_MIN_TRADE_VALUE || 80000000);
const MIN_INTRADAY_PCT = Number(process.env.TRADE_MANAGER_MIN_INTRADAY_PCT || 2);
const MAX_INTRADAY_PCT = Number(process.env.TRADE_MANAGER_MAX_INTRADAY_PCT || 7.5);
const REALTIME_TIMEOUT_MS = Math.max(3000, Number(process.env.TRADE_MANAGER_REALTIME_TIMEOUT_MS || 15000));
const NEAR_HIGH_RATIO = Number(process.env.TRADE_MANAGER_NEAR_HIGH_RATIO || 0.985);

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
    initialized: false,
    seenEvents: {},
    notified: {},
    positions: {},
    closed: {},
    dailyTradeCount: 0,
  };
}

function loadState(dateKey) {
  const state = readJson(STATE_FILE, defaultState(dateKey));
  if (state.date !== dateKey) return defaultState(dateKey);
  state.seenEvents ||= {};
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
    `品質：分數${Math.round(position.qualityScore)}｜漲幅${position.qualityPct.toFixed(2)}%｜量${Math.round(position.qualityVolume).toLocaleString("zh-TW")}張(${position.volumeMilestone.toLocaleString("zh-TW")}級距)`,
    `動能：${position.volumeTrendText}｜${position.signalText}｜高點貼近${position.nearHighText}`,
    "",
    `原因：${event.stateReason || "首次進入A區，量價條件符合。"}`
  ].join("\n");
}

function eventKey(event) {
  return `${event.code}:${event.firstAAt || ""}:${formatTradePrice(event.firstAPrice)}`;
}

function quoteTradeValue(quote, event) {
  const close = cleanNumber(quote?.close) || cleanNumber(event.entryPrice);
  const volume = normalizeVolumeLots(cleanNumber(quote?.tradeVolume) || cleanNumber(event.volume) || cleanNumber(event.tradeVolume));
  const value = cleanNumber(quote?.value) || cleanNumber(event.value) || close * volume * 1000;
  return { close, volume, value };
}

function normalizeVolumeLots(value) {
  const volume = cleanNumber(value);
  if (!volume) return 0;
  return volume >= 100000 ? volume / 1000 : volume;
}

function eventText(event) {
  return [
    event.strategy,
    event.reason,
    event.stateReason,
    ...(Array.isArray(event.strategies) ? event.strategies : []),
  ].filter(Boolean).join(" ");
}

function volumeMilestone(volumeLots) {
  return VOLUME_MILESTONES.filter((level) => volumeLots >= level).at(-1) || 0;
}

function recordsForEvent(payload, event) {
  return (payload.records || [])
    .filter((record) => normalizeCode(record.code) === event.code && record.date === event.date)
    .sort((a, b) => String(a.timestamp || a.entryAt || "").localeCompare(String(b.timestamp || b.entryAt || "")));
}

function minuteVolumeTrend(records, event) {
  const recent = records.slice(-6)
    .map((record) => ({
      time: String(record.timestamp || record.entryAt || ""),
      volume: normalizeVolumeLots(record.volume || record.tradeVolume),
    }))
    .filter((point) => point.time && point.volume > 0);
  const unique = [];
  for (const point of recent) {
    if (!unique.length || unique.at(-1).time !== point.time) unique.push(point);
    else unique[unique.length - 1] = point;
  }
  if (unique.length < 3) {
    return {
      ok: /量勢|放量|量/.test(eventText(event)),
      text: unique.length ? "資料少，以量勢訊號輔助" : "尚無分時量資料",
    };
  }
  const a = unique.at(-3);
  const b = unique.at(-2);
  const c = unique.at(-1);
  const prevDelta = Math.max(0, b.volume - a.volume);
  const latestDelta = Math.max(0, c.volume - b.volume);
  const ok = latestDelta > 0 && (prevDelta === 0 || latestDelta >= prevDelta * 0.8 || latestDelta >= 100);
  return {
    ok,
    text: `近兩段量增 ${Math.round(prevDelta).toLocaleString("zh-TW")}→${Math.round(latestDelta).toLocaleString("zh-TW")} 張`,
  };
}

function signalQuality(event) {
  const text = eventText(event);
  const hasMa35 = /MA35|均線|強勢區|VWAP/.test(text);
  const hasBreakout = /轉強突破|突破|站上|量勢/.test(text);
  return {
    dailyTrendOk: hasMa35,
    ma35KdMacdOk: hasMa35 && hasBreakout,
    text: [
      hasMa35 ? "日均線/MA35多頭" : "",
      hasBreakout ? "突破動能向上" : "",
    ].filter(Boolean).join("、") || "缺少均線動能訊號",
  };
}

function intradayQuality(event, quote, payload) {
  const eventRecords = recordsForEvent(payload, event);
  const latestRecord = eventRecords.at(-1) || {};
  const score = cleanNumber(event.score) || cleanNumber(latestRecord.score);
  const pct = cleanNumber(quote?.percent) || cleanNumber(event.percent) || cleanNumber(latestRecord.percent);
  const high = cleanNumber(quote?.high) || cleanNumber(event.highestPrice) || cleanNumber(latestRecord.observedHigh) || cleanNumber(latestRecord.entryHigh);
  const close = cleanNumber(quote?.close) || cleanNumber(event.entryPrice) || cleanNumber(latestRecord.observedPrice) || cleanNumber(latestRecord.entryPrice);
  let { volume, value } = quoteTradeValue(quote, event);
  if (!volume) volume = normalizeVolumeLots(cleanNumber(latestRecord.volume) || cleanNumber(latestRecord.tradeVolume));
  if (!value && close && volume) value = close * volume * 1000;
  const milestone = volumeMilestone(volume);
  const volumeTrend = minuteVolumeTrend(eventRecords, event);
  const signal = signalQuality(event);
  const reasons = [];
  if (score < MIN_A_SCORE) reasons.push(`分數${Math.round(score)}低於${MIN_A_SCORE}`);
  if (pct < MIN_INTRADAY_PCT) reasons.push(`漲幅${pct.toFixed(2)}%不足`);
  if (pct > MAX_INTRADAY_PCT) reasons.push(`漲幅${pct.toFixed(2)}%過熱`);
  if (volume < MIN_VOLUME_LOTS) reasons.push(`成交量${Math.round(volume).toLocaleString("zh-TW")}張不足`);
  if (!milestone) reasons.push("成交量未達2000張級距");
  if (!volumeTrend.ok) reasons.push(`分時量未持續上升（${volumeTrend.text}）`);
  if (!signal.dailyTrendOk) reasons.push("日均線多頭排列不足");
  if (!signal.ma35KdMacdOk) reasons.push("MA35/KD/MACD動能不足");
  if (value < MIN_TRADE_VALUE) reasons.push("成交金額不足");
  if (high && close < high * NEAR_HIGH_RATIO) reasons.push("現價離盤中高點太遠");
  return {
    pass: reasons.length === 0,
    reasons,
    score,
    pct,
    volume,
    value,
    milestone,
    volumeTrendText: volumeTrend.text,
    signalText: signal.text,
    nearHighText: high ? `${((close / high) * 100).toFixed(1)}%` : "--",
  };
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
  const request = new Promise((resolve, reject) => {
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
  const timeout = new Promise((resolve) => setTimeout(() => resolve({ ok: false, quotes: [], timeout: true }), REALTIME_TIMEOUT_MS));
  return Promise.race([request, timeout]);
}

async function notify(message) {
  if (DRY_RUN) {
    console.log(typeof message === "string" ? message : message.text);
    return;
  }
  if (!hasLineConfig()) throw new Error("Missing LINE_CHANNEL_ACCESS_TOKEN and LINE_TO or LINE_USER_ID");
  if (typeof message === "object" && message.flex && process.env.LINE_FLEX_DISABLED !== "1") {
    await sendLineFlex(message.altText || message.text || "交易管家通知", message.flex);
    return;
  }
  await sendLineText(typeof message === "string" ? message : message.text);
}
function getFreshAEvents(payload, today) {
  if (payload.date !== today) return [];
  return (payload.events || [])
    .filter((event) => event.firstAAt)
    .map((event) => ({
      ...event,
      code: normalizeCode(event.code),
      entryPrice: cleanNumber(event.firstAPrice),
      score: cleanNumber(event.maxScore || event.score),
    }))
    .filter((event) => event.code && event.entryPrice)
    .sort((a, b) => String(a.firstAAt).localeCompare(String(b.firstAAt)));
}

async function main() {
  const now = taipeiParts();
  if (DRY_RUN && process.env.TRADE_MANAGER_TEST_DATE) now.dateKey = process.env.TRADE_MANAGER_TEST_DATE;
  if (DRY_RUN && process.env.TRADE_MANAGER_TEST_TIME) now.time = process.env.TRADE_MANAGER_TEST_TIME;
  const payload = readJson(STRATEGY2_REPORT_FILE, { date: "", events: [] });
  const state = loadState(now.dateKey);
  const events = getFreshAEvents(payload, now.dateKey);
  const eventByCode = new Map(events.map((event) => [event.code, event]));
  const codes = [...new Set([...events.map((event) => event.code), ...Object.keys(state.positions)])];
  const quotesPayload = codes.length ? await callRealtime(codes) : { quotes: [] };
  const quoteByCode = new Map((quotesPayload.quotes || []).map((quote) => [String(quote.code), quote]));
  const messages = [];

  if (!state.initialized && !BACKFILL_EXISTING) {
    for (const event of events) {
      state.seenEvents[eventKey(event)] = { seenAt: new Date().toISOString() };
    }
    state.initialized = true;
    writeJson(STATE_FILE, state);
    console.log(`trade manager ${now.dateKey} ${now.time}: initialized, skipped ${events.length} existing event(s)`);
    return;
  }
  state.initialized = true;

  for (const event of events) {
    const key = eventKey(event);
    if (state.seenEvents[key] || state.notified[event.code] || state.positions[event.code] || state.closed[event.code]) continue;
    state.seenEvents[key] = { seenAt: new Date().toISOString() };
    if (state.dailyTradeCount >= MAX_DAILY_TRADES) continue;
    const quote = quoteByCode.get(event.code);
    const quality = intradayQuality(event, quote, payload);
    if (!quality.pass) {
      console.log(`trade manager skip ${event.code}: ${quality.reasons.join("；")}`);
      continue;
    }
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
      qualityScore: quality.score,
      qualityPct: quality.pct,
      qualityVolume: quality.volume,
      qualityValue: quality.value,
      volumeMilestone: quality.milestone,
      volumeTrendText: quality.volumeTrendText,
      signalText: quality.signalText,
      nearHighText: quality.nearHighText,
      dailyTradeCount: state.dailyTradeCount + 1,
    };
    state.positions[event.code] = position;
    state.notified[event.code] = { buyAt: new Date().toISOString(), entryTime: position.entryTime };
    state.dailyTradeCount += 1;
    const text = buildBuyMessage(event, position);
    messages.push({
      text,
      altText: `交易管家可買：${event.code} ${event.name || ""}`.trim(),
      flex: tradeBuyFlex(event, position),
    });
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
    const text = buildExitMessage(position, quote, action);
    const pnl = profitText(position.entryPrice, current, position.shares);
    messages.push({
      text,
      altText: `交易管家${action === "takeProfit" ? "停利" : "停損"}：${position.code} ${position.name || ""}`.trim(),
      flex: tradeExitFlex(position, quote, action, pnl.text),
    });
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
  for (const message of messages) {
    await notify(message);
  }
  console.log(`trade manager ${now.dateKey} ${now.time}: ${DRY_RUN ? "dry-run generated" : "sent"} ${messages.length} message(s)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});







