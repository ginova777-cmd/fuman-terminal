const fs = require("fs");
const path = require("path");
const realtimeHandler = require("../api/realtime");
const { cleanNumber, formatTradePrice, roundTradePrice } = require("./intraday-radar-rules");
const { hasLineConfig, sendLineFlex, sendLineText } = require("./line-push");
const { tradeBuyFlex, tradeExitFlex } = require("./line-flex-templates");
const { hasTelegramConfig, sendTelegramText } = require("./telegram-push");

const { ROOT, dataPath, statePath } = require("./runtime-paths");
const OPEN_BUY_FILE = dataPath("open-buy-latest.json");
const STRATEGY2_REPORT_FILE = dataPath("strategy2-intraday-latest.json");
const STRATEGY5_FILE = dataPath("strategy5-latest.json");
const STATE_FILE = statePath("trade-manager-state.json");

const TAKE_PROFIT_PCT = Number(process.env.TRADE_MANAGER_TAKE_PROFIT_PCT || 3);
const STOP_LOSS_PCT = Number(process.env.TRADE_MANAGER_STOP_LOSS_PCT || 2);
const MAX_DAILY_TRADES = Math.max(1, Number(process.env.TRADE_MANAGER_MAX_DAILY_TRADES || 5));
const MAX_DAILY_AMOUNT = Math.max(0, Number(process.env.TRADE_MANAGER_MAX_DAILY_AMOUNT || 5000000));
const DEFAULT_BUDGET_PER_TRADE = MAX_DAILY_AMOUNT ? Math.floor(MAX_DAILY_AMOUNT / MAX_DAILY_TRADES) : 20000;
const BUDGET_PER_TRADE = Math.max(1000, Number(process.env.TRADE_MANAGER_BUDGET_PER_TRADE || DEFAULT_BUDGET_PER_TRADE));
const DRY_RUN = process.env.TRADE_MANAGER_DRY_RUN === "1";
const BACKFILL_EXISTING = process.env.TRADE_MANAGER_BACKFILL_EXISTING === "1";
const ENABLE_STRATEGY1 = process.env.TRADE_MANAGER_ENABLE_STRATEGY1 !== "0";
const ENABLE_STRATEGY2 = process.env.TRADE_MANAGER_ENABLE_STRATEGY2 !== "0";
const ENABLE_STRATEGY5 = process.env.TRADE_MANAGER_ENABLE_STRATEGY5 !== "0";
const MIN_A_SCORE = Number(process.env.TRADE_MANAGER_MIN_A_SCORE || 80);
const MIN_VOLUME_LOTS = Number(process.env.TRADE_MANAGER_MIN_VOLUME_LOTS || 2000);
const VOLUME_MILESTONES = [2000, 5000, 10000];
const MIN_TRADE_VALUE = Number(process.env.TRADE_MANAGER_MIN_TRADE_VALUE || 80000000);
const LIST_MIN_TRADE_VALUE = Number(process.env.TRADE_MANAGER_LIST_MIN_TRADE_VALUE || 50000000);
const LIST_MIN_VOLUME_LOTS = Number(process.env.TRADE_MANAGER_LIST_MIN_VOLUME_LOTS || 1000);
const MIN_INTRADAY_PCT = Number(process.env.TRADE_MANAGER_MIN_INTRADAY_PCT || 2);
const MAX_INTRADAY_PCT = Number(process.env.TRADE_MANAGER_MAX_INTRADAY_PCT || 7.5);
const REALTIME_TIMEOUT_MS = Math.max(3000, Number(process.env.TRADE_MANAGER_REALTIME_TIMEOUT_MS || 15000));
const NEAR_HIGH_RATIO = Number(process.env.TRADE_MANAGER_NEAR_HIGH_RATIO || 0.985);
const MIN_ENTRY_TIME = process.env.TRADE_MANAGER_MIN_ENTRY_TIME || "09:05:00";
const STRATEGY5_MIN_ENTRY_TIME = process.env.TRADE_MANAGER_STRATEGY5_MIN_ENTRY_TIME || "09:00:00";
const MAX_ENTRY_TIME = process.env.TRADE_MANAGER_MAX_ENTRY_TIME || "13:20:00";
const FORCE_DAY_EXIT_TIME = process.env.TRADE_MANAGER_FORCE_DAY_EXIT_TIME || "13:25:00";
const SMART_STOP_MIN_PCT = Number(process.env.TRADE_MANAGER_SMART_STOP_MIN_PCT || 0.8);
const SMART_STOP_MAX_PCT = Number(process.env.TRADE_MANAGER_SMART_STOP_MAX_PCT || 3.2);
const PROFIT_EXIT_MIN_PCT = Number(process.env.TRADE_MANAGER_PROFIT_EXIT_MIN_PCT || 1.5);
const STRATEGY5_PROFIT_EXIT_MIN_PCT = Number(process.env.TRADE_MANAGER_STRATEGY5_PROFIT_EXIT_MIN_PCT || process.env.STRATEGY5_PROTECT_PROFIT_PCT || 0.8);
const SELL_PRESSURE_VOLUME_DELTA_LOTS = Number(process.env.TRADE_MANAGER_SELL_PRESSURE_VOLUME_DELTA_LOTS || 300);
const STRATEGY5_SELL_PRESSURE_VOLUME_DELTA_LOTS = Number(process.env.TRADE_MANAGER_STRATEGY5_SELL_PRESSURE_VOLUME_DELTA_LOTS || 80);
const SELL_PRESSURE_DROP_PCT = Number(process.env.TRADE_MANAGER_SELL_PRESSURE_DROP_PCT || 0.35);
const SELL_PRESSURE_HIGH_GIVEBACK_PCT = Number(process.env.TRADE_MANAGER_SELL_PRESSURE_HIGH_GIVEBACK_PCT || 0.8);

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
    dailyTradeAmount: 0,
  };
}

function sumPositionAmounts(groups) {
  return groups.reduce((sum, group) => (
    sum + Object.values(group || {}).reduce((inner, position) => inner + cleanNumber(position.amount), 0)
  ), 0);
}

function loadState(dateKey) {
  const state = readJson(STATE_FILE, defaultState(dateKey));
  if (state.date !== dateKey) return defaultState(dateKey);
  state.seenEvents ||= {};
  state.notified ||= {};
  state.positions ||= {};
  state.closed ||= {};
  state.dailyTradeCount ||= Object.keys(state.positions).length + Object.keys(state.closed).length;
  state.dailyTradeAmount ||= sumPositionAmounts([state.positions, state.closed]);
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smartStopLoss(event, quote, entryPrice, quality = {}) {
  const entry = cleanNumber(entryPrice);
  if (!entry) return { price: 0, pct: 0, basis: "無有效進場價" };
  const pct = cleanNumber(quality.pct) || cleanNumber(event.percent) || cleanNumber(quote?.percent);
  const score = cleanNumber(quality.score) || cleanNumber(event.score) || 80;
  const volume = cleanNumber(quality.volume) || normalizeVolumeLots(cleanNumber(quote?.tradeVolume) || cleanNumber(event.volume));
  const strategy = event.strategy || "strategy2-entry";
  let riskPct = strategy === "strategy1-open" ? 1.1 : strategy === "strategy5" ? 1.5 : 1.3;
  if (pct >= 5) riskPct += 0.35;
  if (pct >= 7) riskPct += 0.35;
  if (volume >= 5000) riskPct += 0.2;
  if (score >= 95) riskPct -= 0.15;
  riskPct = clamp(riskPct, SMART_STOP_MIN_PCT, SMART_STOP_MAX_PCT);

  const minStop = roundTradePrice(entry * (1 - SMART_STOP_MIN_PCT / 100));
  const maxStop = roundTradePrice(entry * (1 - SMART_STOP_MAX_PCT / 100));
  const candidates = [];
  const addCandidate = (label, rawPrice) => {
    const value = cleanNumber(rawPrice);
    if (!value || value >= entry) return;
    const pctAway = ((entry - value) / entry) * 100;
    if (pctAway < SMART_STOP_MIN_PCT || pctAway > SMART_STOP_MAX_PCT) return;
    candidates.push({ label, price: roundTradePrice(value), pctAway });
  };

  addCandidate("名單原始停損", event.stopLoss);
  addCandidate("盤中低點下緣", cleanNumber(quote?.low) ? cleanNumber(quote.low) * 0.995 : 0);
  addCandidate("候選資料低點下緣", cleanNumber(event.low) ? cleanNumber(event.low) * 0.995 : 0);
  addCandidate("MA35防守", cleanNumber(event.ma35) ? cleanNumber(event.ma35) * 0.995 : 0);
  addCandidate("波動風險", entry * (1 - riskPct / 100));

  const selected = candidates.length
    ? candidates.sort((a, b) => b.price - a.price)[0]
    : { label: "固定風險", price: roundTradePrice(entry * (1 - riskPct / 100)), pctAway: riskPct };
  const price = Math.max(maxStop, Math.min(minStop, selected.price));
  const pctAway = ((entry - price) / entry) * 100;
  return {
    price,
    pct: pctAway,
    basis: `${selected.label}，風險${pctAway.toFixed(2)}%`,
  };
}

function exitSignal(position, quote, current) {
  const entry = cleanNumber(position.entryPrice);
  const isStrategy5 = position.strategy === "strategy5";
  const previousPrice = cleanNumber(position.lastPrice);
  const previousVolume = cleanNumber(position.lastVolume);
  const volume = normalizeVolumeLots(cleanNumber(quote?.tradeVolume));
  const high = cleanNumber(quote?.high) || cleanNumber(position.highestPrice) || current;
  const profitPct = entry ? ((current - entry) / entry) * 100 : 0;
  const deltaVolume = previousVolume && volume > previousVolume ? volume - previousVolume : 0;
  const dropPct = previousPrice && current < previousPrice ? ((previousPrice - current) / previousPrice) * 100 : 0;
  const highGivebackPct = high && current < high ? ((high - current) / high) * 100 : 0;
  const fib618 = cleanNumber(position.ibFib618);
  const fibBroken = !isStrategy5 || !fib618 || current < fib618;
  const minProfitPct = isStrategy5 ? STRATEGY5_PROFIT_EXIT_MIN_PCT : PROFIT_EXIT_MIN_PCT;
  const minSellDelta = isStrategy5 ? STRATEGY5_SELL_PRESSURE_VOLUME_DELTA_LOTS : SELL_PRESSURE_VOLUME_DELTA_LOTS;
  const largeSellVolume = deltaVolume >= minSellDelta;
  const priceWeak = dropPct >= SELL_PRESSURE_DROP_PCT || highGivebackPct >= SELL_PRESSURE_HIGH_GIVEBACK_PCT;
  const profitSellPressure = profitPct >= minProfitPct && largeSellVolume && priceWeak;
  const buyMomentumFailed = isStrategy5
    && profitPct < minProfitPct
    && fibBroken
    && priceWeak
    && (largeSellVolume || current < previousPrice);
  const hardStop = current <= cleanNumber(position.stopLossPrice) && fibBroken;
  return {
    action: hardStop ? "stopLoss" : profitSellPressure ? "takeProfit" : buyMomentumFailed ? "momentumFail" : "",
    profitPct,
    deltaVolume,
    dropPct,
    highGivebackPct,
    volume,
    high,
    reason: hardStop
      ? `跌破防守價 ${formatTradePrice(position.stopLossPrice)}`
      : profitSellPressure
      ? `獲利${profitPct.toFixed(2)}%，本輪新增${Math.round(deltaVolume).toLocaleString("zh-TW")}張，回落${dropPct.toFixed(2)}%，高點回吐${highGivebackPct.toFixed(2)}%`
      : buyMomentumFailed
      ? `策略5買量未延續且跌破IB 0.618 ${formatTradePrice(fib618)}，本輪新增${Math.round(deltaVolume).toLocaleString("zh-TW")}張，回落${dropPct.toFixed(2)}%，高點回吐${highGivebackPct.toFixed(2)}%`
      : "",
  };
}

function buildBuyMessage(event, position) {
  const title = event.strategy === "strategy1-open"
    ? "交易管家｜策略1 可買通知"
    : event.strategy === "strategy5"
    ? "交易管家｜策略5 可買通知"
    : "交易管家｜策略2-進場區 可買通知";
  return [
    title,
    "",
    `股票：${event.code} ${event.name || ""}`,
    `進場時間：${event.firstAAt || "--"}`,
    `建議進場價：${formatTradePrice(position.entryPrice)} 元`,
    `停利邏輯：獲利${event.strategy === "strategy5" ? STRATEGY5_PROFIT_EXIT_MIN_PCT : PROFIT_EXIT_MIN_PCT}%以上，且出現放量賣壓才提醒`,
    `智慧停損：${formatTradePrice(position.stopLossPrice)} 元（-${position.stopLossPct.toFixed(2)}%）`,
    `停損依據：${position.stopLossBasis}`,
    event.strategy === "strategy5" ? `IB防守：IBH ${formatTradePrice(position.ibHigh)}｜IBL ${formatTradePrice(position.ibLow)}｜0.618 ${formatTradePrice(position.ibFib618)}` : "",
    `今日通知：${position.dailyTradeCount}/${MAX_DAILY_TRADES} 筆`,
    `品質：分數${Math.round(position.qualityScore)}｜漲幅${position.qualityPct.toFixed(2)}%｜量${Math.round(position.qualityVolume).toLocaleString("zh-TW")}張(${position.volumeMilestone.toLocaleString("zh-TW")}級距)`,
    `動能：${position.volumeTrendText}｜${position.signalText}｜高點貼近${position.nearHighText}`,
    "",
    `原因：${event.stateReason || "首次進入進場區，量價條件符合。"}`
  ].join("\n");
}

function eventKey(event) {
  return `${event.strategy || "strategy2-A"}:${event.code}:${event.firstAAt || ""}:${formatTradePrice(event.firstAPrice)}`;
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
  const hasMa35BuyPoint = /MA35買點/.test(text);
  const hasBreakout = /轉強突破|突破|站上|量勢/.test(text);
  return {
    dailyTrendOk: hasMa35BuyPoint,
    ma35KdMacdOk: hasMa35BuyPoint && hasBreakout,
    text: [
      hasMa35BuyPoint ? "MA35買點" : "",
      hasBreakout ? "突破動能向上" : "",
    ].filter(Boolean).join("、") || "缺少MA35買點",
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
  if (!signal.dailyTrendOk) reasons.push("未觸發MA35買點");
  if (!signal.ma35KdMacdOk) reasons.push("MA35買點後突破動能不足");
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

function strategy5Quality(event, quote, now) {
  const current = cleanNumber(quote?.close);
  const volume = normalizeVolumeLots(cleanNumber(quote?.tradeVolume || event.volume));
  const value = cleanNumber(quote?.value) || (current && volume ? current * volume * 1000 : 0);
  const pct = cleanNumber(quote?.percent || event.percent);
  const high = cleanNumber(quote?.high);
  const reasons = [];
  if (!current) reasons.push("即時報價不足");
  if (timeValue(now.time) < timeValue(event.firstAAt)) reasons.push("尚未到策略5進場時間");
  if (timeValue(now.time) > timeValue("09:30:00")) reasons.push("策略5開盤交易時間已過");
  if (Number.isFinite(pct) && pct < -1.5) reasons.push(`盤中轉弱 ${pct.toFixed(2)}%`);
  if (Number.isFinite(pct) && pct > 8.5) reasons.push(`漲幅${pct.toFixed(2)}%過熱`);
  if (volume < LIST_MIN_VOLUME_LOTS) reasons.push(`成交量${Math.round(volume).toLocaleString("zh-TW")}張不足`);
  if (value < LIST_MIN_TRADE_VALUE) reasons.push("成交金額不足");
  if (high && current && current < high * 0.97) reasons.push("現價離盤中高點過遠");
  return {
    pass: reasons.length === 0,
    reasons,
    score: cleanNumber(event.score) || 100,
    pct: Number.isFinite(pct) ? pct : 0,
    volume,
    value,
    milestone: volumeMilestone(volume),
    volumeTrendText: "策略5前日名單，盤中量價確認",
    signalText: "策略5｜VWAP與買量由成績單/盤中結構回測校驗",
    nearHighText: high && current ? `${((current / high) * 100).toFixed(1)}%` : "--",
  };
}

function listStrategyQuality(event, quote, now) {
  const current = cleanNumber(quote?.close);
  const volume = normalizeVolumeLots(cleanNumber(quote?.tradeVolume || event.volume || event.tradeVolume));
  const value = cleanNumber(quote?.value) || cleanNumber(event.value) || (current && volume ? current * volume * 1000 : 0);
  const pct = cleanNumber(quote?.percent || event.percent);
  const score = cleanNumber(event.score || event.activeMatch?.score) || 80;
  const high = cleanNumber(quote?.high);
  const noChase = cleanNumber(event.noChase);
  const reasons = [];
  if (!current) reasons.push("即時報價不足");
  if (timeValue(now.time) < timeValue(MIN_ENTRY_TIME)) reasons.push(`尚未到進場時間 ${MIN_ENTRY_TIME}`);
  if (current && noChase && current > noChase) reasons.push(`現價${formatTradePrice(current)}超過追價上限${formatTradePrice(noChase)}`);
  if (Number.isFinite(pct) && pct < -1.5) reasons.push(`盤中轉弱 ${pct.toFixed(2)}%`);
  if (Number.isFinite(pct) && pct > MAX_INTRADAY_PCT) reasons.push(`漲幅${pct.toFixed(2)}%過熱`);
  if (volume < LIST_MIN_VOLUME_LOTS) reasons.push(`成交量${Math.round(volume).toLocaleString("zh-TW")}張不足`);
  if (value < LIST_MIN_TRADE_VALUE) reasons.push("成交金額不足");
  if (high && current && current < high * 0.97) reasons.push("現價離盤中高點過遠");
  return {
    pass: reasons.length === 0,
    reasons,
    score,
    pct: Number.isFinite(pct) ? pct : 0,
    volume,
    value,
    milestone: volumeMilestone(volume),
    volumeTrendText: `${event.strategyLabel || event.strategy || "名單"}，盤中量${Math.round(volume).toLocaleString("zh-TW")}張`,
    signalText: event.activeMatch?.short || event.setup || event.status || event.strategyLabel || event.strategy,
    nearHighText: high && current ? `${((current / high) * 100).toFixed(1)}%` : "--",
  };
}

function buildExitMessage(position, quote, action) {
  const current = cleanNumber(quote?.close) || cleanNumber(position.lastPrice) || cleanNumber(position.entryPrice);
  const pnl = profitText(position.entryPrice, current, position.shares);
  const title = action === "takeProfit" ? "可賣通知｜放量賣壓停利" : action === "momentumFail" ? "可賣通知｜買量轉弱" : action === "dayClose" ? "當沖強制出場" : "停損通知";
  const actionText = action === "takeProfit" ? "放量賣壓停利出場" : action === "momentumFail" ? "買量未延續，先出場" : action === "dayClose" ? "當天交易結束，不留倉" : "停損出場";
  return [
    `交易管家｜${position.strategy || "策略"} ${title}`,
    "",
    `股票：${position.code} ${position.name || ""}`,
    `進場價：${formatTradePrice(position.entryPrice)} 元`,
    `目前價：${formatTradePrice(current)} 元`,
    `損益率/損益：${pnl.text}`,
    position.exitReason ? `出場訊號：${position.exitReason}` : "",
    `建議動作：${actionText}`,
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
  return Promise.race([request, timeout]).catch((error) => ({
    ok: false,
    quotes: [],
    error: error?.message || String(error),
  }));
}

async function notify(message) {
  if (DRY_RUN) {
    console.log(typeof message === "string" ? message : message.text);
    return;
  }
  if (hasTelegramConfig()) {
    await sendTelegramText(typeof message === "string" ? message : message.text);
    return;
  }
  if (!hasLineConfig()) throw new Error("Missing Telegram or LINE notification config");
  if (typeof message === "object" && message.flex && process.env.LINE_FLEX_DISABLED !== "1") {
    await sendLineFlex(message.altText || message.text || "交易管家通知", message.flex);
    return;
  }
  await sendLineText(typeof message === "string" ? message : message.text);
}

function timeValue(value) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}

function isAfterTime(current, target) {
  return timeValue(current) >= timeValue(target);
}

function forceDayExitReason(now) {
  return `當沖規則：${now.time} 已到 ${FORCE_DAY_EXIT_TIME}，交易管家不留倉`;
}

function closePosition(state, code, position, quote, action, reason) {
  const current = cleanNumber(quote?.close) || cleanNumber(position.lastPrice) || cleanNumber(position.entryPrice);
  if (!current) return null;
  position.lastPrice = current;
  position.lastVolume = normalizeVolumeLots(cleanNumber(quote?.tradeVolume)) || cleanNumber(position.lastVolume);
  position.highestPrice = Math.max(cleanNumber(position.highestPrice), cleanNumber(quote?.high), current);
  position.lastUpdatedAt = new Date().toISOString();
  position.exitReason = reason || position.exitReason || "";
  const closed = {
    ...position,
    exitPrice: current,
    exitAction: action,
    closedAt: new Date().toISOString(),
  };
  state.closed[code] = closed;
  delete state.positions[code];
  return closed;
}

function getFreshAEvents(payload, today) {
  if (!ENABLE_STRATEGY2) return [];
  if (payload.date !== today) return [];
  return (payload.events || [])
    .filter((event) => event.firstAAt)
    .map((event) => ({
      ...event,
      strategy: "strategy2-entry",
      strategyLabel: "策略2",
      code: normalizeCode(event.code),
      originalFirstAAt: event.firstAAt,
      originalFirstAPrice: cleanNumber(event.firstAPrice),
      firstAAt: event.firstTradableAAt || event.firstAAt,
      firstAPrice: cleanNumber(event.firstTradableAPrice || event.firstAPrice),
      entryPrice: cleanNumber(event.firstTradableAPrice || event.firstAPrice),
      score: cleanNumber(event.maxScore || event.score),
    }))
    .filter((event) => event.code && event.entryPrice)
    .filter((event) => timeValue(event.firstAAt) >= timeValue(MIN_ENTRY_TIME))
    .sort((a, b) => String(a.firstAAt).localeCompare(String(b.firstAAt)));
}

function getStrategy1Events(today) {
  if (!ENABLE_STRATEGY1) return [];
  const payload = readJson(OPEN_BUY_FILE, { matches: [] });
  return (payload.matches || [])
    .map((item) => ({
      ...item,
      strategy: "strategy1-open",
      strategyLabel: "策略1",
      code: normalizeCode(item.code),
      firstAAt: timeValue(MIN_ENTRY_TIME) > timeValue("09:00:00") ? MIN_ENTRY_TIME : "09:00:00",
      firstAPrice: cleanNumber(item.entryPrice || item.open || item.close),
      entryPrice: 0,
      score: cleanNumber(item.score) || 80,
      stateReason: item.reason || "策略1名單，交由交易管家盤中擇時當沖",
      strategies: ["策略1"],
      sourceDate: payload.usedDate || item.date || "",
      tradeDate: today,
    }))
    .filter((event) => event.code)
    .sort((a, b) => (cleanNumber(b.score) - cleanNumber(a.score)) || String(a.code).localeCompare(String(b.code)));
}

function getStrategy5Events(today) {
  if (!ENABLE_STRATEGY5) return [];
  const payload = readJson(STRATEGY5_FILE, { matches: [] });
  return (payload.matches || [])
    .map((item) => ({
      ...item,
      strategy: "strategy5",
      strategyLabel: "策略5",
      code: normalizeCode(item.code),
      firstAAt: STRATEGY5_MIN_ENTRY_TIME,
      firstAPrice: cleanNumber(item.open || item.close),
      entryPrice: 0,
      score: cleanNumber(item.score || item.activeMatch?.score) || 80,
      stateReason: item.activeMatch?.reason || item.reason || "策略5名單，交由交易管家盤中擇時當沖",
      strategies: ["策略5"],
    }))
    .filter((event) => event.code)
    .sort((a, b) => (cleanNumber(b.score) - cleanNumber(a.score)) || String(a.code).localeCompare(String(b.code)));
}

async function main() {
  const now = taipeiParts();
  if (DRY_RUN && process.env.TRADE_MANAGER_TEST_DATE) now.dateKey = process.env.TRADE_MANAGER_TEST_DATE;
  if (DRY_RUN && process.env.TRADE_MANAGER_TEST_TIME) now.time = process.env.TRADE_MANAGER_TEST_TIME;
  const payload = readJson(STRATEGY2_REPORT_FILE, { date: "", events: [] });
  const state = loadState(now.dateKey);
  const events = [...getStrategy1Events(now.dateKey), ...getFreshAEvents(payload, now.dateKey), ...getStrategy5Events(now.dateKey)]
    .sort((a, b) => String(a.firstAAt).localeCompare(String(b.firstAAt)) || (cleanNumber(b.score) - cleanNumber(a.score)));
  const eventByCode = new Map(events.map((event) => [event.code, event]));
  const codes = [...new Set([...events.map((event) => event.code), ...Object.keys(state.positions)])];
  const quotesPayload = codes.length ? await callRealtime(codes) : { quotes: [] };
  const quoteByCode = new Map((quotesPayload.quotes || []).map((quote) => [String(quote.code), quote]));
  const messages = [];
  const openedThisRun = new Set();
  const afterMaxEntryTime = isAfterTime(now.time, MAX_ENTRY_TIME);
  const afterForceDayExitTime = isAfterTime(now.time, FORCE_DAY_EXIT_TIME);

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

  if (afterForceDayExitTime) {
    for (const [code, position] of Object.entries(state.positions)) {
      const quote = quoteByCode.get(code);
      const closed = closePosition(state, code, position, quote, "dayClose", forceDayExitReason(now));
      if (!closed) continue;
      const pnl = profitText(closed.entryPrice, closed.exitPrice, closed.shares);
      messages.push({
        text: buildExitMessage(closed, quote, "dayClose"),
        altText: `交易管家當沖出場：${closed.code} ${closed.name || ""}`.trim(),
        flex: tradeExitFlex(closed, { ...quote, close: closed.exitPrice }, "dayClose", pnl.text),
      });
    }
  }

  for (const event of events) {
    if (timeValue(event.firstAAt) > timeValue(now.time)) continue;
    if (afterMaxEntryTime) {
      state.seenEvents[eventKey(event)] ||= { seenAt: new Date().toISOString(), skipped: `超過進場截止 ${MAX_ENTRY_TIME}` };
      continue;
    }
    const key = eventKey(event);
    if (state.seenEvents[key] || state.notified[event.code] || state.positions[event.code] || state.closed[event.code]) continue;
    state.seenEvents[key] = { seenAt: new Date().toISOString() };
    if (state.dailyTradeCount >= MAX_DAILY_TRADES) continue;
    const quote = quoteByCode.get(event.code);
    const quality = event.strategy === "strategy2-entry"
      ? intradayQuality(event, quote, payload)
      : event.strategy === "strategy5"
      ? strategy5Quality(event, quote, now)
      : listStrategyQuality(event, quote, now);
    if (!quality.pass) {
      console.log(`trade manager skip ${event.code}: ${quality.reasons.join("；")}`);
      continue;
    }
    const entryPrice = cleanNumber(event.entryPrice) || cleanNumber(quote?.close);
    if (!entryPrice) continue;
    const plan = lotPlan(entryPrice);
    const nextDailyAmount = cleanNumber(state.dailyTradeAmount) + cleanNumber(plan.amount);
    if (MAX_DAILY_AMOUNT && nextDailyAmount > MAX_DAILY_AMOUNT) {
      console.log(`trade manager skip ${event.code}: 今日交易金額${nextDailyAmount.toLocaleString("zh-TW")}超過上限${MAX_DAILY_AMOUNT.toLocaleString("zh-TW")}`);
      continue;
    }
    const stopLoss = smartStopLoss(event, quote, entryPrice, quality);
    const ibHigh = cleanNumber(quote?.high) || entryPrice;
    const ibLow = cleanNumber(quote?.low) || entryPrice;
    const ibFib618 = ibHigh > ibLow ? roundTradePrice(ibHigh - (ibHigh - ibLow) * 0.618) : 0;
    const position = {
      code: event.code,
      name: event.name || quote?.name || "",
      strategy: event.strategy || "strategy2-entry",
      entryTime: event.firstAAt || now.time,
      entryPrice,
      takeProfitPrice: roundTradePrice(entryPrice * (1 + TAKE_PROFIT_PCT / 100)),
      stopLossPrice: stopLoss.price,
      stopLossPct: stopLoss.pct,
      stopLossBasis: stopLoss.basis,
      ibHigh,
      ibLow,
      ibFib618,
      shares: plan.shares,
      lots: plan.lots,
      amount: plan.amount,
      openedAt: new Date().toISOString(),
      lastPrice: cleanNumber(quote?.close) || entryPrice,
      lastVolume: normalizeVolumeLots(cleanNumber(quote?.tradeVolume)),
      highestPrice: cleanNumber(quote?.high) || cleanNumber(quote?.close) || entryPrice,
      qualityScore: quality.score,
      qualityPct: quality.pct,
      qualityVolume: quality.volume,
      qualityValue: quality.value,
      volumeMilestone: quality.milestone,
      volumeTrendText: quality.volumeTrendText,
      signalText: quality.signalText,
      nearHighText: quality.nearHighText,
      dailyTradeCount: state.dailyTradeCount + 1,
      dailyTradeAmount: nextDailyAmount,
    };
    state.positions[event.code] = position;
    openedThisRun.add(event.code);
    state.notified[event.code] = { buyAt: new Date().toISOString(), entryTime: position.entryTime };
    state.dailyTradeCount += 1;
    state.dailyTradeAmount = nextDailyAmount;
    const text = buildBuyMessage(event, position);
    messages.push({
      text,
      altText: `交易管家可買：${event.code} ${event.name || ""}`.trim(),
      flex: tradeBuyFlex(event, position),
    });
  }

  for (const [code, position] of Object.entries(state.positions)) {
    if (openedThisRun.has(code)) continue;
    const quote = quoteByCode.get(code);
    const current = cleanNumber(quote?.close) || cleanNumber(position.lastPrice);
    if (!current) continue;
    const signal = exitSignal(position, quote, current);
    position.lastPrice = current;
    position.lastVolume = signal.volume || cleanNumber(position.lastVolume);
    position.highestPrice = Math.max(cleanNumber(position.highestPrice), signal.high || current, current);
    position.lastUpdatedAt = new Date().toISOString();
    const action = signal.action;
    if (!action) continue;
    const closed = closePosition(state, code, position, quote, action, signal.reason);
    if (!closed) continue;
    const pnl = profitText(closed.entryPrice, closed.exitPrice, closed.shares);
    messages.push({
      text: buildExitMessage(closed, quote, action),
      altText: `交易管家${action === "takeProfit" ? "停利" : "停損"}：${closed.code} ${closed.name || ""}`.trim(),
      flex: tradeExitFlex(closed, quote, action, pnl.text),
    });
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







