const fs = require("fs");
const path = require("path");
const https = require("https");
const { URL } = require("url");
const { dataPath } = require("./runtime-paths");
const { cleanNumber, roundTradePrice } = require("./intraday-radar-rules");

const DESKTOP_REPORT_DIR = process.env.BACKTEST_REPORT_DIR || path.join(process.env.USERPROFILE || "C:\\Users\\ginov", "OneDrive", "Desktop", "回測報告");
const HISTORY_DIR = dataPath("strategy2-intraday-history");
const LATEST_FILE = dataPath("strategy2-intraday-latest.json");
const BASE_URL = process.env.FUMAN_BASE_URL || "https://fuman-terminal.vercel.app";

const TAKE_PROFIT_PCT = Number(process.env.BACKTEST_TAKE_PROFIT_PCT || process.env.TRADE_MANAGER_TAKE_PROFIT_PCT || 3);
const STOP_LOSS_PCT = Number(process.env.BACKTEST_STOP_LOSS_PCT || process.env.TRADE_MANAGER_STOP_LOSS_PCT || 2);
const MAX_DAILY_TRADES = Math.max(1, Number(process.env.BACKTEST_MAX_DAILY_TRADES || process.env.TRADE_MANAGER_MAX_DAILY_TRADES || 5));
const BUDGET_PER_TRADE = Math.max(1000, Number(process.env.BACKTEST_BUDGET_PER_TRADE || process.env.TRADE_MANAGER_BUDGET_PER_TRADE || 20000));
const MIN_SCORE = Number(process.env.BACKTEST_MIN_A_SCORE || process.env.TRADE_MANAGER_MIN_A_SCORE || 80);
const MIN_VOLUME_LOTS = Number(process.env.BACKTEST_MIN_VOLUME_LOTS || process.env.TRADE_MANAGER_MIN_VOLUME_LOTS || 2000);
const MIN_VALUE = Number(process.env.BACKTEST_MIN_TRADE_VALUE || process.env.TRADE_MANAGER_MIN_TRADE_VALUE || 80000000);
const MIN_PCT = Number(process.env.BACKTEST_MIN_INTRADAY_PCT || process.env.TRADE_MANAGER_MIN_INTRADAY_PCT || 2);
const MAX_PCT = Number(process.env.BACKTEST_MAX_INTRADAY_PCT || process.env.TRADE_MANAGER_MAX_INTRADAY_PCT || 7.5);
const NEAR_HIGH_RATIO = Number(process.env.BACKTEST_NEAR_HIGH_RATIO || process.env.TRADE_MANAGER_NEAR_HIGH_RATIO || 0.985);
const MIN_ENTRY_TIME = process.env.BACKTEST_MIN_ENTRY_TIME || process.env.TRADE_MANAGER_MIN_ENTRY_TIME || "09:05:00";

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

async function fetchJson(url, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = https.request({
      method: "GET",
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      timeout,
      headers: { "User-Agent": "FumanBacktestScorecard/1.0", Accept: "application/json" },
    }, (res) => {
      let chunks = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { chunks += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`${url} HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(chunks));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error(`timeout ${timeout}ms`)));
    req.on("error", reject);
    req.end();
  });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function normalizeVolumeLots(value) {
  const volume = cleanNumber(value);
  if (!volume) return 0;
  return volume >= 100000 ? volume / 1000 : volume;
}

function formatBacktestPrice(value) {
  const price = roundTradePrice(value);
  return Number.isFinite(price) ? Number(price.toFixed(2)) : "";
}

function lotPlan(entryPrice) {
  const price = cleanNumber(entryPrice);
  if (!price) return { shares: 0, lots: 0, amount: 0 };
  const shares = Math.max(1000, Math.floor(BUDGET_PER_TRADE / price / 1000) * 1000);
  const lots = Math.max(1, Math.floor(shares / 1000));
  return { shares: lots * 1000, lots, amount: Math.round(lots * 1000 * price) };
}

function eventText(event) {
  const enhancementText = (event.enhancements || [])
    .flatMap((item) => [item.strategy, item.reason, item.trigger, item.ma35Source])
    .filter(Boolean);
  return [event.strategy, event.reason, event.stateReason, ...(Array.isArray(event.strategies) ? event.strategies : []), ...enhancementText]
    .filter(Boolean)
    .join(" ");
}

function recordsForEvent(payload, event) {
  return (payload.records || [])
    .filter((record) => normalizeCode(record.code) === event.code && record.date === event.date)
    .sort((a, b) => String(a.timestamp || a.entryAt || "").localeCompare(String(b.timestamp || b.entryAt || "")));
}

function latestRecordBefore(records, timeText) {
  const target = String(timeText || "99:99:99").slice(-8);
  return records.filter((record) => String(record.timestamp || record.entryAt || "").slice(-8) <= target).at(-1) || records.at(-1) || {};
}

function timeValue(value) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}

function taipeiUnix(dateText, hour = 0, minute = 0) {
  return Math.floor(new Date(`${dateText}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`).getTime() / 1000);
}

function timeFromUnix(seconds) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(seconds * 1000));
}

async function fetchYahooIntraday(code, market, dateText) {
  const suffix = String(market || "").toUpperCase() === "TPEX" || String(market || "").toLowerCase() === "otc" ? "TWO" : "TW";
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${code}.${suffix}`);
  url.searchParams.set("period1", String(taipeiUnix(dateText, 0, 0)));
  url.searchParams.set("period2", String(taipeiUnix(dateText, 23, 59)));
  url.searchParams.set("interval", "1m");
  url.searchParams.set("includePrePost", "false");
  const payload = await fetchJson(url.toString(), 30000);
  const result = payload?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0] || {};
  const timestamps = result?.timestamp || [];
  const prevClose = cleanNumber(result?.meta?.chartPreviousClose || result?.meta?.previousClose);
  const candles = timestamps.map((timestamp, index) => ({
    timestamp,
    time: timeFromUnix(timestamp),
    open: cleanNumber(quote.open?.[index]),
    high: cleanNumber(quote.high?.[index]),
    low: cleanNumber(quote.low?.[index]),
    close: cleanNumber(quote.close?.[index]),
    volume: cleanNumber(quote.volume?.[index]),
  })).filter((row) => (
    row.open > 0
    && row.high > 0
    && row.low > 0
    && row.close > 0
    && timeValue(row.time) >= timeValue("09:00:00")
    && timeValue(row.time) <= timeValue("13:30:00")
  ));
  return { code, prevClose, candles, source: `Yahoo Finance 1m ${code}.${suffix}` };
}

function minuteVolumeTrend(records, event) {
  const recent = records.slice(-6)
    .map((record) => ({ time: String(record.timestamp || record.entryAt || ""), volume: normalizeVolumeLots(record.volume || record.tradeVolume) }))
    .filter((point) => point.time && point.volume > 0);
  const unique = [];
  for (const point of recent) {
    if (!unique.length || unique.at(-1).time !== point.time) unique.push(point);
    else unique[unique.length - 1] = point;
  }
  if (unique.length < 3) return { ok: /量勢|放量|量/.test(eventText(event)), text: unique.length ? "資料少，以量勢訊號輔助" : "尚無分時量資料" };
  const a = unique.at(-3);
  const b = unique.at(-2);
  const c = unique.at(-1);
  const prevDelta = Math.max(0, b.volume - a.volume);
  const latestDelta = Math.max(0, c.volume - b.volume);
  return { ok: latestDelta > 0 && (prevDelta === 0 || latestDelta >= prevDelta * 0.8 || latestDelta >= 100), text: `近兩段量增 ${Math.round(prevDelta)}→${Math.round(latestDelta)} 張` };
}

function enhancementVolumeTrend(event) {
  const points = (event.enhancements || [])
    .map((item) => ({
      time: String(item.at || ""),
      deltaVolume: normalizeVolumeLots(item.deltaVolume),
      totalVolume: normalizeVolumeLots(item.totalVolume),
      trigger: String(item.trigger || ""),
    }))
    .filter((point) => point.time && (point.deltaVolume > 0 || point.totalVolume > 0));
  if (!points.length) return { ok: false, text: "" };
  const latestPositive = points.filter((point) => point.deltaVolume > 0).at(-1);
  const latest = points.at(-1);
  const positiveCount = points.filter((point) => point.deltaVolume > 0).length;
  return {
    ok: positiveCount >= 1 || /volume/i.test(latest.trigger),
    text: `增強訊號量增 ${Math.round(latestPositive?.deltaVolume || 0)} 張，累計 ${Math.round(latest.totalVolume || 0)} 張`,
  };
}

function hasMa35Enhancement(event) {
  return (event.enhancements || []).some((item) => (
    cleanNumber(item.ma35) > 0
    && (item.aboveMa35 === true || cleanNumber(item.price) >= cleanNumber(item.ma35))
    && (item.ma35TrendUp === true || /MA35/.test(String(item.reason || "")))
  ));
}

function qualityForEvent(payload, event) {
  const records = recordsForEvent(payload, event);
  const latestRecord = latestRecordBefore(records, event.firstAAt);
  const score = cleanNumber(event.maxScore || event.score || latestRecord.score);
  const pct = cleanNumber(event.percent || latestRecord.percent);
  const high = cleanNumber(event.highestPrice || latestRecord.observedHigh || latestRecord.entryHigh);
  const close = cleanNumber(event.firstAPrice || event.entryPrice || latestRecord.observedPrice || latestRecord.entryPrice);
  const volume = normalizeVolumeLots(latestRecord.volume || event.volume || event.tradeVolume);
  const value = cleanNumber(latestRecord.value || event.value) || close * volume * 1000;
  const text = eventText(event);
  const hasMa35BuyPoint = /MA35買點/.test(text) || hasMa35Enhancement(event);
  const hasBreakout = /轉強突破|突破|站上|量勢|放量|爆量/.test(text);
  const recordTrend = minuteVolumeTrend(records, event);
  const enhancementTrend = enhancementVolumeTrend(event);
  const trend = recordTrend.ok ? recordTrend : (enhancementTrend.ok ? enhancementTrend : recordTrend);
  const reasons = [];
  if (score < MIN_SCORE) reasons.push(`分數${Math.round(score)}低於${MIN_SCORE}`);
  if (pct < MIN_PCT) reasons.push(`漲幅${pct.toFixed(2)}%不足`);
  if (pct > MAX_PCT) reasons.push(`漲幅${pct.toFixed(2)}%過熱`);
  if (volume < MIN_VOLUME_LOTS) reasons.push(`成交量${Math.round(volume)}張不足`);
  if (!trend.ok) reasons.push(`分時量未持續上升：${trend.text}`);
  if (!hasMa35BuyPoint) reasons.push("未觸發MA35買點");
  if (!(hasMa35BuyPoint && hasBreakout)) reasons.push("MA35買點後突破動能不足");
  if (value < MIN_VALUE) reasons.push("成交金額不足");
  if (high && close < high * NEAR_HIGH_RATIO) reasons.push("現價離盤中高點太遠");
  return { pass: reasons.length === 0, reasons, score, pct, volume, value, close, high, trendText: trend.text };
}

function getFreshAEvents(payload) {
  return (payload.events || [])
    .filter((event) => event.firstAAt)
    .map((event) => ({
      ...event,
      code: normalizeCode(event.code),
      originalFirstAAt: event.firstAAt,
      originalFirstAPrice: cleanNumber(event.firstAPrice),
      firstAAt: event.firstTradableAAt || event.firstAAt,
      firstAPrice: cleanNumber(event.firstTradableAPrice || event.firstAPrice),
      entryPrice: cleanNumber(event.firstTradableAPrice || event.firstAPrice || event.entryPrice),
      score: cleanNumber(event.maxScore || event.score),
    }))
    .filter((event) => event.code && event.entryPrice)
    .filter((event) => timeValue(event.firstAAt) >= timeValue(MIN_ENTRY_TIME))
    .sort((a, b) => String(a.firstAAt).localeCompare(String(b.firstAAt)) || a.code.localeCompare(b.code));
}

function exitFromRecords(records, position) {
  const entryValue = timeValue(position.entryTime);
  const afterEntry = records.filter((record) => timeValue(record.timestamp || record.entryAt) > entryValue);
  if (!afterEntry.length) {
    return {
      exitPrice: position.lastPrice || position.entryPrice,
      exitTime: "",
      exitReason: "資料不足未結算",
      incomplete: true,
    };
  }
  for (const record of afterEntry) {
    const price = cleanNumber(record.observedPrice || record.entryPrice);
    const time = String(record.timestamp || record.entryAt || position.entryTime).slice(-8);
    if (price >= position.takeProfitPrice) return { exitPrice: position.takeProfitPrice, exitTime: time, exitReason: "停利達標" };
    if (price <= position.stopLossPrice) return { exitPrice: position.stopLossPrice, exitTime: time, exitReason: "停損觸發" };
    position.lastPrice = price || position.lastPrice;
    position.lastTime = time;
  }
  return { exitPrice: position.lastPrice || position.entryPrice, exitTime: position.lastTime || position.entryTime, exitReason: "收盤/資料結算" };
}

function backtestManager(payload) {
  const trades = [];
  const skipped = [];
  const seenCodes = new Set();
  for (const event of getFreshAEvents(payload)) {
    if (trades.length >= MAX_DAILY_TRADES) break;
    if (seenCodes.has(event.code)) continue;
    seenCodes.add(event.code);
    const quality = qualityForEvent(payload, event);
    if (!quality.pass) {
      skipped.push({ code: event.code, name: event.name || "", time: event.firstAAt, reasons: quality.reasons });
      continue;
    }
    const entryPrice = cleanNumber(event.entryPrice || quality.close);
    const plan = lotPlan(entryPrice);
    const position = {
      date: payload.date,
      code: event.code,
      name: event.name || "",
      entryTime: event.firstAAt,
      entryPrice,
      takeProfitPrice: roundTradePrice(entryPrice * (1 + TAKE_PROFIT_PCT / 100)),
      stopLossPrice: roundTradePrice(entryPrice * (1 - STOP_LOSS_PCT / 100)),
      shares: plan.shares,
      lots: plan.lots,
      amount: plan.amount,
      lastPrice: entryPrice,
      lastTime: event.firstAAt,
      score: quality.score,
      pct: quality.pct,
      volume: quality.volume,
    };
    const exit = exitFromRecords(recordsForEvent(payload, event), position);
    const pnl = Math.round((exit.exitPrice - entryPrice) * plan.shares);
    const returnPct = entryPrice ? ((exit.exitPrice - entryPrice) / entryPrice) * 100 : 0;
    trades.push({ ...position, ...exit, pnl, returnPct });
  }
  return { trades, skipped };
}

function recordHighPrice(record) {
  return cleanNumber(record.observedHigh || record.entryHigh || record.high || record.observedPrice || record.entryPrice);
}

function recordObservedPrice(record) {
  return cleanNumber(record.observedPrice || record.close || record.lastPrice || record.entryPrice);
}

function isVerifiedQuoteRecord(record) {
  if (process.env.ALLOW_LEGACY_RADAR_QUOTES === "1") return true;
  return Boolean(record.quoteTime || record.quoteAt || record.quoteTimestamp);
}

function isRadarEntryRecord(record) {
  const stateId = String(record.stateId || "").toLowerCase();
  const stateLabel = String(record.stateLabel || "");
  const strategy = String(record.strategy || "");
  return stateId === "go"
    || stateId === "entry"
    || stateLabel.includes("A區")
    || stateLabel.includes("進場區")
    || strategy.includes("進場區");
}

async function fetchRealtimeQuotes(codes) {
  const quotes = new Map();
  const uniqueCodes = [...new Set(codes.map(normalizeCode).filter(Boolean))];
  for (let i = 0; i < uniqueCodes.length; i += 20) {
    const batch = uniqueCodes.slice(i, i + 20);
    try {
      const payload = await fetchJson(`${BASE_URL}/api/realtime?codes=${encodeURIComponent(batch.join(","))}&t=${Date.now()}`, 20000);
      for (const quote of payload?.quotes || []) {
        const code = normalizeCode(quote.code);
        if (code) quotes.set(code, quote);
      }
    } catch (error) {
      console.log(`realtime quote fallback failed ${batch[0]}-${batch.at(-1)}: ${error.message}`);
    }
  }
  return quotes;
}

async function backtestRadar(payload) {
  const recordsByCode = new Map();
  const byEvent = new Map();
  let skippedUnverified = 0;
  let entryCandidateRecords = 0;
  for (const record of payload.records || []) {
    if (!isVerifiedQuoteRecord(record)) {
      skippedUnverified += 1;
      continue;
    }
    const code = normalizeCode(record.code);
    const eventAt = String(record.timestamp || record.entryAt || "").slice(-8);
    if (!code || !eventAt) continue;
    if (!recordsByCode.has(code)) recordsByCode.set(code, []);
    recordsByCode.get(code).push(record);
    const isAZone = isRadarEntryRecord(record);
    if (!isAZone) continue;
    entryCandidateRecords += 1;
    const key = `${code}|${eventAt}`;
    if (!byEvent.has(key)) byEvent.set(key, []);
    byEvent.get(key).push(record);
  }
  for (const rows of recordsByCode.values()) {
    rows.sort((a, b) => String(a.timestamp || a.entryAt || "").localeCompare(String(b.timestamp || b.entryAt || "")));
  }
  const hits = [];
  for (const [key, rows] of byEvent) {
    rows.sort((a, b) => String(a.timestamp || a.entryAt || "").localeCompare(String(b.timestamp || b.entryAt || "")));
    const first = rows[0] || {};
    const code = normalizeCode(first.code || key.split("|")[0]);
    const eventAt = String(first.timestamp || first.entryAt || key.split("|")[1] || "").slice(-8);
    const entryPrice = formatBacktestPrice(recordObservedPrice(first));
    const strategies = [...new Set(rows.map((record) => record.strategy).filter(Boolean))];
    const eventValue = timeValue(eventAt);
    const futureRows = (recordsByCode.get(code) || []).filter((record) => isVerifiedQuoteRecord(record) && timeValue(record.timestamp || record.entryAt) >= eventValue);
    let exitPrice = entryPrice;
    let exitAt = eventAt;
    for (const record of futureRows) {
      const high = recordHighPrice(record);
      if (high && high >= exitPrice) {
        exitPrice = high;
        exitAt = String(record.observedHighAt || record.timestamp || record.entryAt || eventAt).slice(-8);
      }
    }
    exitPrice = formatBacktestPrice(exitPrice);
    const pnl = Math.round((exitPrice - entryPrice) * 1000);
    const returnPct = entryPrice ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
    const maxScore = Math.max(...rows.map((record) => cleanNumber(record.score)));
    const maxPct = Math.max(...rows.map((record) => cleanNumber(record.percent)));
    const maxVolume = Math.max(...rows.map((record) => normalizeVolumeLots(record.volume || record.tradeVolume)));
    hits.push({
      date: payload.date,
      code,
      name: first.name || "",
      eventAt,
      firstAt: eventAt,
      entryPrice,
      exitAt,
      exitPrice,
      exitSource: "records",
      pnl,
      returnPct,
      maxScore,
      maxPct,
      maxVolume,
      strategies,
      reason: first.reason || first.stateReason || "",
    });
  }
  hits.sort((a, b) => a.eventAt.localeCompare(b.eventAt) || b.pnl - a.pnl || b.returnPct - a.returnPct || a.code.localeCompare(b.code));
  const total = hits.length;
  const wins = hits.filter((hit) => hit.pnl > 0).length;
  const losses = hits.filter((hit) => hit.pnl < 0).length;
  const pnl = hits.reduce((sum, hit) => sum + hit.pnl, 0);
  const avgReturn = total ? hits.reduce((sum, hit) => sum + hit.returnPct, 0) / total : 0;
  const winRate = total ? (wins / total) * 100 : 0;
  if (process.env.ALLOW_EMPTY_RADAR_BACKTEST !== "1" && total === 0 && entryCandidateRecords > 0) {
    throw new Error(`Radar backtest consistency guard blocked empty hits: entryCandidateRecords=${entryCandidateRecords}, skippedUnverified=${skippedUnverified}`);
  }
  return { hits, summary: { total, wins, losses, flats: total - wins - losses, pnl, avgReturn, winRate, skippedUnverified, entryCandidateRecords, eventBuckets: byEvent.size } };
}

function summary(trades) {
  const total = trades.length;
  const wins = trades.filter((trade) => trade.pnl > 0).length;
  const losses = trades.filter((trade) => trade.pnl < 0).length;
  const flats = total - wins - losses;
  const pnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const avgReturn = total ? trades.reduce((sum, trade) => sum + trade.returnPct, 0) / total : 0;
  const winRate = total ? (wins / total) * 100 : 0;
  return { total, wins, losses, flats, pnl, avgReturn, winRate };
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows, columns) {
  return [columns.map((c) => c.label).join(","), ...rows.map((row) => columns.map((c) => csvEscape(c.value(row))).join(","))].join("\n") + "\n";
}

function buildHtml(report) {
  const managerRows = report.manager.trades.map((trade) => `<tr><td>${trade.date}</td><td>${trade.code}</td><td>${trade.name}</td><td>${trade.entryTime}</td><td>${trade.entryPrice}</td><td>${trade.exitTime}</td><td>${trade.exitPrice}</td><td>${trade.exitReason}</td><td>${trade.returnPct.toFixed(2)}%</td><td class="${trade.pnl >= 0 ? "profit" : "loss"}">${trade.pnl.toLocaleString("zh-TW")}</td></tr>`).join("");
  const radarRows = report.radar.hits.slice(0, 100).map((hit, index) => `<tr><td>${index + 1}</td><td>${hit.code}</td><td>${hit.name}</td><td>${hit.eventAt || hit.firstAt}</td><td>${hit.entryPrice}</td><td>${hit.exitPrice}</td><td class="${hit.pnl >= 0 ? "profit" : "loss"}">${hit.pnl.toLocaleString("zh-TW")}</td><td>${Math.round(hit.maxVolume).toLocaleString("zh-TW")}</td><td>${hit.strategies.join(" / ")}</td></tr>`).join("");
  const s = report.manager.summary;
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>輔滿回測報告 ${report.date}</title><style>body{font-family:"Microsoft JhengHei",Arial,sans-serif;margin:24px;background:#f6f7fb;color:#172033}h1{font-size:24px}section{background:white;border:1px solid #d8dee8;border-radius:8px;margin:16px 0;padding:16px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid #e5e7eb;padding:8px;text-align:right}th{text-align:right;background:#f1f5f9}.left,td:nth-child(2),td:nth-child(3){text-align:left}.profit{color:#dc2626;font-weight:800}.loss{color:#16a34a;font-weight:800}.cards{display:flex;gap:10px;flex-wrap:wrap}.card{border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;background:#fafafa}.card b{display:block;font-size:20px;margin-top:4px}</style></head><body><h1>輔滿回測報告 ${report.date}</h1><section><h2>策略2 + 管家邏輯</h2><div class="cards"><div class="card">總筆數<b>${s.total}</b></div><div class="card">勝率<b>${s.winRate.toFixed(1)}%</b></div><div class="card">總損益<b class="${s.pnl >= 0 ? "profit" : "loss"}">${s.pnl.toLocaleString("zh-TW")}</b></div><div class="card">平均報酬<b>${s.avgReturn.toFixed(2)}%</b></div></div><table><thead><tr><th>日期</th><th>股票</th><th>名稱</th><th>進場</th><th>進價</th><th>出場</th><th>出價</th><th>原因</th><th>報酬</th><th>損益</th></tr></thead><tbody>${managerRows}</tbody></table></section><section><h2>即時雷達回測命中</h2><p>命中 ${report.radar.hits.length} 檔，表格先列前 100 檔。</p><table><thead><tr><th>#</th><th>股票</th><th>名稱</th><th>事件時間</th><th>進場價</th><th>出場價</th><th>損益</th><th>最大量</th><th>策略</th></tr></thead><tbody>${radarRows}</tbody></table></section></body></html>`;
}

function loadPayload(dateArg) {
  const candidates = [];
  if (dateArg) candidates.push(path.join(HISTORY_DIR, `${dateArg}.json`));
  candidates.push(LATEST_FILE);
  for (const file of candidates) {
    const payload = readJson(file);
    if (payload && Array.isArray(payload.records)) return { file, payload };
  }
  throw new Error("No strategy2 intraday payload found");
}

async function main() {
  const dateArg = process.argv.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg));
  const { file, payload } = loadPayload(dateArg);
  const manager = backtestManager(payload);
  manager.summary = summary(manager.trades);
  const radar = await backtestRadar(payload);
  const report = { generatedAt: new Date().toISOString(), sourceFile: file, date: payload.date, config: { TAKE_PROFIT_PCT, STOP_LOSS_PCT, MAX_DAILY_TRADES, BUDGET_PER_TRADE, MIN_SCORE, MIN_VOLUME_LOTS, MIN_VALUE, MIN_PCT, MAX_PCT }, manager, radar };

  ensureDir(DESKTOP_REPORT_DIR);
  const stamp = String(payload.date || "unknown").replace(/-/g, "");
  const jsonPath = path.join(DESKTOP_REPORT_DIR, `backtest-strategy2-manager-radar-${stamp}.json`);
  const htmlPath = path.join(DESKTOP_REPORT_DIR, `backtest-strategy2-manager-radar-${stamp}.html`);
  const tradesCsvPath = path.join(DESKTOP_REPORT_DIR, `backtest-trades-${stamp}.csv`);
  const radarCsvPath = path.join(DESKTOP_REPORT_DIR, `backtest-radar-${stamp}.csv`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  fs.writeFileSync(htmlPath, buildHtml(report), "utf8");
  fs.writeFileSync(tradesCsvPath, toCsv(manager.trades, [
    { label: "date", value: (r) => r.date }, { label: "code", value: (r) => r.code }, { label: "name", value: (r) => r.name }, { label: "entryTime", value: (r) => r.entryTime }, { label: "entryPrice", value: (r) => r.entryPrice }, { label: "exitTime", value: (r) => r.exitTime }, { label: "exitPrice", value: (r) => r.exitPrice }, { label: "exitReason", value: (r) => r.exitReason }, { label: "returnPct", value: (r) => r.returnPct.toFixed(2) }, { label: "pnl", value: (r) => r.pnl }
  ]), "utf8");
  fs.writeFileSync(radarCsvPath, toCsv(radar.hits, [
    { label: "date", value: (r) => r.date }, { label: "code", value: (r) => r.code }, { label: "name", value: (r) => r.name }, { label: "eventAt", value: (r) => r.eventAt || r.firstAt }, { label: "entryPrice", value: (r) => r.entryPrice }, { label: "exitPrice", value: (r) => r.exitPrice }, { label: "pnl", value: (r) => r.pnl }, { label: "maxVolume", value: (r) => Math.round(r.maxVolume) }, { label: "strategies", value: (r) => r.strategies.join(" / ") }
  ]), "utf8");

  console.log(`Backtest source: ${file}`);
  console.log(`Manager trades: ${manager.summary.total}, winRate ${manager.summary.winRate.toFixed(1)}%, pnl ${manager.summary.pnl}`);
  console.log(`Radar hits: ${radar.hits.length}`);
  console.log(`Report: ${htmlPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});



