"use strict";

const fs = require("fs");
const path = require("path");

const {
  fetchFutoptQuotesLive,
  fetchFutoptTickerMap,
  fetchPreopenSnapshotHistory,
  fetchPreopenSnapshots,
} = require("../lib/supabase-public-slot");
const { dataPath } = require("./runtime-paths");

const OUT_FILE = dataPath("star-preopen-latest.json");
const BACKUP_FILE = dataPath("star-preopen-backup.json");
const SCORECARD_SOURCE_FILE = dataPath("star-preopen-scorecard-source.json");
const OPEN_BUY_SCORECARD_SOURCE_FILE = dataPath("open-buy-scorecard-source.json");

const PREOPEN_START_MINUTES = Number(process.env.STAR_PREOPEN_START_MINUTES || 8 * 60 + 45);
const PREOPEN_END_MINUTES = Number(process.env.STAR_PREOPEN_END_MINUTES || 8 * 60 + 59);
const FINAL_START_MINUTES = Number(process.env.STAR_FINAL_START_MINUTES || 8 * 60 + 58);
const FINAL_END_MINUTES = Number(process.env.STAR_FINAL_END_MINUTES || 8 * 60 + 59);
const HISTORY_LOOKBACK_SECONDS = Number(process.env.STAR_HISTORY_LOOKBACK_SECONDS || 60);

const THRESHOLDS = {
  futurePct: Number(process.env.STAR_MIN_FUTURE_PCT || 2),
  futureRelativeTxf: Number(process.env.STAR_MIN_FUTURE_RELATIVE_TXF || 1),
  futureVolume: Number(process.env.STAR_MIN_FUTURE_VOLUME || 80),
  trialPct: Number(process.env.STAR_MIN_TRIAL_PCT || 2),
  bidAskRatio: Number(process.env.STAR_MIN_BID_ASK_RATIO || 1.5),
  finalSnapshotCount: Number(process.env.STAR_FINAL_MIN_SNAPSHOTS || 3),
  finalVolatilityPct: Number(process.env.STAR_FINAL_MAX_TRIAL_VOLATILITY_PCT || 2),
  finalTrialPct: Number(process.env.STAR_FINAL_MIN_TRIAL_PCT || 6),
  finalBidAskRatio: Number(process.env.STAR_FINAL_MIN_BID_ASK_RATIO || 3),
  finalFutureVolume: Number(process.env.STAR_FINAL_MIN_FUTURE_VOLUME || 120),
  finalFutureRelativeTxf: Number(process.env.STAR_FINAL_MIN_FUTURE_RELATIVE_TXF || 2),
};

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
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

function taipeiDateKey(date = new Date()) {
  const parts = taipeiParts(date);
  return `${parts.year}${parts.month}${parts.day}`;
}

function taipeiMinuteOfDay(date = new Date()) {
  const parts = taipeiParts(date);
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function taipeiTimeText(date = new Date()) {
  const parts = taipeiParts(date);
  return `${parts.hour}:${parts.minute}:${parts.second}`;
}

function percentChange(price, reference) {
  const p = cleanNumber(price);
  const r = cleanNumber(reference);
  return r > 0 ? ((p - r) / r) * 100 : 0;
}

function bidAskRatio(bidVolume, askVolume) {
  const bid = cleanNumber(bidVolume);
  const ask = cleanNumber(askVolume);
  if (bid > 0 && ask <= 0) return 99;
  return ask > 0 ? bid / ask : 0;
}

function futurePct(quote) {
  const direct = cleanNumber(quote?.change_percent);
  if (direct) return direct;
  return percentChange(quote?.last_price, quote?.previous_close);
}

function quoteVolume(quote) {
  return cleanNumber(quote?.total_volume ?? quote?.volume);
}

function normalizePreopen(row) {
  const code = normalizeCode(row?.symbol || row?.code);
  const trialPrice = cleanNumber(row?.trial_price);
  const referencePrice = cleanNumber(row?.reference_price);
  const bestBidPrice = cleanNumber(row?.best_bid_price);
  return {
    code,
    name: row?.name || code,
    market: row?.market || "",
    updatedAt: row?.updated_at || row?.observed_at || "",
    observedAt: row?.observed_at || row?.updated_at || "",
    referencePrice,
    trialPrice,
    trialPct: percentChange(trialPrice, referencePrice),
    bidVolume: cleanNumber(row?.bid_volume),
    askVolume: cleanNumber(row?.ask_volume),
    bidAskRatio: bidAskRatio(row?.bid_volume, row?.ask_volume),
    bestBidPrice,
    bestAskPrice: cleanNumber(row?.best_ask_price),
    bestBidOk: bestBidPrice > 0 && trialPrice > 0 && bestBidPrice >= trialPrice,
    isTrial: row?.is_trial === true,
    isLimitUpBid: row?.is_limit_up_bid === true,
  };
}

function recentHistory(rows, nowMs) {
  const cutoff = nowMs - HISTORY_LOOKBACK_SECONDS * 1000;
  return (rows || [])
    .map(normalizePreopen)
    .filter((row) => row.trialPrice > 0)
    .filter((row) => {
      const ms = Date.parse(row.observedAt || row.updatedAt || "");
      return Number.isFinite(ms) && ms >= cutoff && ms <= nowMs + 5000;
    })
    .sort((a, b) => Date.parse(a.observedAt || a.updatedAt || "") - Date.parse(b.observedAt || b.updatedAt || ""));
}

function historyVolatilityPct(history) {
  const prices = history.map((row) => cleanNumber(row.trialPrice)).filter((value) => value > 0);
  if (prices.length < 2) return 0;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min > 0 ? ((max - min) / min) * 100 : 0;
}

function chooseFutureTicker(tickers) {
  const nowDate = taipeiDateKey();
  const eligible = (tickers || [])
    .filter((row) => row?.future_symbol)
    .filter((row) => String(row?.product || "").toUpperCase().includes("STOCK") || normalizeCode(row?.underlying_symbol))
    .sort((a, b) => String(a.end_date || "99999999").localeCompare(String(b.end_date || "99999999")));
  return eligible.find((row) => String(row.end_date || "99999999").replace(/\D/g, "") >= nowDate) || eligible[0] || null;
}

function ruleResult(ok, label) {
  return ok ? null : label;
}

function buildReason(item) {
  return [
    `期貨漲幅 ${item.futurePct.toFixed(2)}%`,
    `相對 TXF ${item.futureRelativeTxf.toFixed(2)}%`,
    `期貨量 ${Math.round(item.futureVolume)}`,
    `試撮漲幅 ${item.trialPct.toFixed(2)}%`,
    `委買賣比 ${item.bidAskRatio.toFixed(2)}`,
    item.finalBlindBuy ? "FinalBlindBuy 通過" : "STAR 盤前候選",
  ].join("，");
}

function buildScore(item) {
  const base = 55
    + Math.max(0, item.futureRelativeTxf) * 5
    + Math.max(0, item.futurePct) * 2
    + Math.max(0, item.trialPct) * 3
    + Math.min(15, Math.log10(Math.max(1, item.futureVolume)) * 5)
    + Math.min(12, item.bidAskRatio * 2);
  return Math.round(Math.min(99, base + (item.finalBlindBuy ? 10 : 0)));
}

async function main() {
  const now = new Date();
  const minute = taipeiMinuteOfDay(now);
  const windowActive = minute >= PREOPEN_START_MINUTES && minute <= PREOPEN_END_MINUTES;
  const finalWindowActive = minute >= FINAL_START_MINUTES && minute <= FINAL_END_MINUTES;
  const date = taipeiDateKey(now);
  const updatedAt = now.toISOString();

  const [tickerResult, preopenResult, quoteResult] = await Promise.all([
    fetchFutoptTickerMap(),
    fetchPreopenSnapshots(),
    fetchFutoptQuotesLive(),
  ]);

  const tickerMap = tickerResult.byUnderlying || new Map();
  const preopenRows = preopenResult.rows || [];
  const quoteMap = quoteResult.bySymbol || new Map();
  const txfQuote = quoteResult.txf || quoteMap.get("TXF") || null;
  const txfPct = futurePct(txfQuote);
  const candidates = [];
  const watch = [];

  for (const raw of preopenRows) {
    const preopen = normalizePreopen(raw);
    if (!/^\d{4}$/.test(preopen.code) || preopen.trialPrice <= 0 || preopen.referencePrice <= 0) continue;
    const ticker = chooseFutureTicker(tickerMap.get(preopen.code) || []);
    if (!ticker) continue;
    const futureQuote = quoteMap.get(String(ticker.future_symbol || "").toUpperCase());
    if (!futureQuote) continue;

    const fpct = futurePct(futureQuote);
    const fvol = quoteVolume(futureQuote);
    const relative = fpct - txfPct;
    const baseFailures = [
      ruleResult(fpct >= THRESHOLDS.futurePct, `期貨漲幅 ${fpct.toFixed(2)}% < ${THRESHOLDS.futurePct}%`),
      ruleResult(relative >= THRESHOLDS.futureRelativeTxf, `相對 TXF ${relative.toFixed(2)}% < ${THRESHOLDS.futureRelativeTxf}%`),
      ruleResult(fvol >= THRESHOLDS.futureVolume, `期貨量 ${Math.round(fvol)} < ${THRESHOLDS.futureVolume}`),
      ruleResult(preopen.trialPct >= THRESHOLDS.trialPct, `試撮漲幅 ${preopen.trialPct.toFixed(2)}% < ${THRESHOLDS.trialPct}%`),
      ruleResult(preopen.bidAskRatio >= THRESHOLDS.bidAskRatio, `委買賣比 ${preopen.bidAskRatio.toFixed(2)} < ${THRESHOLDS.bidAskRatio}`),
      ruleResult(preopen.bestBidOk, "最佳買價未達試撮價"),
    ].filter(Boolean);
    if (baseFailures.length) continue;

    watch.push(preopen.code);
    candidates.push({
      date,
      code: preopen.code,
      name: preopen.name,
      market: preopen.market,
      futureSymbol: ticker.future_symbol,
      futureName: ticker.name || "",
      futurePct: Number(fpct.toFixed(4)),
      txfPct: Number(txfPct.toFixed(4)),
      futureRelativeTxf: Number(relative.toFixed(4)),
      futureVolume: fvol,
      trialPrice: preopen.trialPrice,
      referencePrice: preopen.referencePrice,
      trialPct: Number(preopen.trialPct.toFixed(4)),
      bidAskRatio: Number(preopen.bidAskRatio.toFixed(4)),
      bidVolume: preopen.bidVolume,
      askVolume: preopen.askVolume,
      bestBidPrice: preopen.bestBidPrice,
      bestAskPrice: preopen.bestAskPrice,
      bestBidOk: preopen.bestBidOk,
      isLimitUpBid: preopen.isLimitUpBid,
      stockFutureOk: true,
      preopenFutureOk: true,
      preopenTrialOk: true,
      trialAuctionOk: true,
      finalBlindBuy: false,
      finalBlindBuyOk: false,
      finalReasons: [],
      updatedAt: preopen.updatedAt || updatedAt,
    });
  }

  let historyByCode = new Map();
  if (candidates.length) {
    const history = await fetchPreopenSnapshotHistory(candidates.map((item) => item.code), {
      sinceIso: new Date(now.getTime() - HISTORY_LOOKBACK_SECONDS * 1000).toISOString(),
      limit: Math.max(300, candidates.length * 12),
    });
    historyByCode = history.byCode || new Map();
  }

  const matches = candidates.map((item) => {
    const history = recentHistory(historyByCode.get(item.code) || [], now.getTime());
    const earliest = history[0] || null;
    const latest = history[history.length - 1] || null;
    const latestTrialPct = latest ? latest.trialPct : item.trialPct;
    const latestBidAskRatio = latest ? latest.bidAskRatio : item.bidAskRatio;
    const latestBestBidOk = latest ? latest.bestBidOk : item.bestBidOk;
    const latestIsLimitUpBid = latest ? latest.isLimitUpBid : item.isLimitUpBid;
    const latestNotWeaker = !earliest || !latest || latest.trialPrice >= earliest.trialPrice;
    const volatility = historyVolatilityPct(history);
    const finalFailures = [
      ruleResult(finalWindowActive, "不在 08:58~08:59 終判窗口"),
      ruleResult(history.length >= THRESHOLDS.finalSnapshotCount, `1分鐘 snapshot ${history.length} < ${THRESHOLDS.finalSnapshotCount}`),
      ruleResult(volatility <= THRESHOLDS.finalVolatilityPct, `1分鐘試撮波動 ${volatility.toFixed(2)}% > ${THRESHOLDS.finalVolatilityPct}%`),
      ruleResult(latestTrialPct >= THRESHOLDS.finalTrialPct, `終判試撮漲幅 ${latestTrialPct.toFixed(2)}% < ${THRESHOLDS.finalTrialPct}%`),
      ruleResult(latestBidAskRatio >= THRESHOLDS.finalBidAskRatio, `終判委買賣比 ${latestBidAskRatio.toFixed(2)} < ${THRESHOLDS.finalBidAskRatio}`),
      ruleResult(latestBestBidOk, "終判最佳買價未達試撮價"),
      ruleResult(latestIsLimitUpBid, "終判不是漲停委買"),
      ruleResult(item.futureVolume >= THRESHOLDS.finalFutureVolume, `終判期貨量 ${Math.round(item.futureVolume)} < ${THRESHOLDS.finalFutureVolume}`),
      ruleResult(item.futureRelativeTxf >= THRESHOLDS.finalFutureRelativeTxf, `終判相對 TXF ${item.futureRelativeTxf.toFixed(2)}% < ${THRESHOLDS.finalFutureRelativeTxf}%`),
      ruleResult(latestNotWeaker, "最新試撮弱於最早 snapshot"),
    ].filter(Boolean);
    const finalBlindBuy = finalFailures.length === 0;
    const out = {
      ...item,
      snapshotCount1m: history.length,
      trialVolatility1m: Number(volatility.toFixed(4)),
      latestTrialPct: Number(latestTrialPct.toFixed(4)),
      latestBidAskRatio: Number(latestBidAskRatio.toFixed(4)),
      latestNotWeaker,
      finalBlindBuy,
      finalBlindBuyOk: finalBlindBuy,
      finalReasons: finalFailures,
      stateId: finalBlindBuy ? "final_blind_buy" : "star_watch",
      status: finalBlindBuy ? "FinalBlindBuy" : "STAR候選",
      strategy: "STAR",
      strategyIds: finalBlindBuy ? ["star", "final_blind_buy"] : ["star_watch"],
      quoteDate: date,
      reason: "",
    };
    out.score = buildScore(out);
    out.reason = buildReason(out);
    return out;
  }).sort((a, b) => Number(b.finalBlindBuy) - Number(a.finalBlindBuy)
    || b.score - a.score
    || b.trialPct - a.trialPct
    || b.futureRelativeTxf - a.futureRelativeTxf
    || b.futureVolume - a.futureVolume);

  const finalMatches = matches.filter((item) => item.finalBlindBuy);
  const scorecardPayload = {
    ok: true,
    source: "star-preopen-scorecard-source",
    date,
    usedDate: date,
    quoteDate: date,
    updatedAt,
    matches: finalMatches,
  };
  const payload = {
    ok: true,
    strategy: "STAR",
    date,
    usedDate: date,
    quoteDate: date,
    updatedAt,
    taipeiTime: taipeiTimeText(now),
    windowActive,
    finalWindowActive,
    thresholds: THRESHOLDS,
    source: {
      tickers: tickerResult.count || 0,
      futuresQuotes: quoteResult.count || 0,
      preopenSnapshots: preopenRows.length,
      txfPct: Number(txfPct.toFixed(4)),
    },
    matches,
    finalMatches,
    watchCount: watch.length,
    matchCount: matches.length,
    finalMatchCount: finalMatches.length,
  };

  const previous = readJson(OUT_FILE, null);
  if (previous?.matches?.length) writeJson(BACKUP_FILE, previous);
  writeJson(OUT_FILE, payload);
  writeJson(SCORECARD_SOURCE_FILE, scorecardPayload);
  if (finalMatches.length || process.env.STAR_SYNC_OPEN_BUY_SOURCE === "1") {
    const openBuySource = readJson(OPEN_BUY_SCORECARD_SOURCE_FILE, { ok: true, matches: [] });
    const nonStar = (openBuySource.matches || []).filter((item) => !(item?.strategyIds || []).includes("star"));
    writeJson(OPEN_BUY_SCORECARD_SOURCE_FILE, {
      ...openBuySource,
      ok: true,
      source: "open-buy-scorecard-source+star",
      updatedAt,
      usedDate: date,
      quoteDate: date,
      matches: [...finalMatches, ...nonStar],
      starInjectedAt: updatedAt,
      starFinalMatchCount: finalMatches.length,
    });
  }

  console.log(`STAR preopen ok: candidates ${matches.length}, FinalBlindBuy ${finalMatches.length}, window=${windowActive}, finalWindow=${finalWindowActive}`);
  if (!windowActive) console.log("STAR preopen note: outside 08:45~08:59, wrote diagnostics only.");
}

main().catch((error) => {
  const payload = {
    ok: false,
    strategy: "STAR",
    date: taipeiDateKey(),
    updatedAt: new Date().toISOString(),
    error: error?.message || String(error),
    matches: [],
    finalMatches: [],
  };
  writeJson(OUT_FILE, payload);
  console.error(`STAR preopen failed: ${payload.error}`);
  process.exitCode = 1;
});
