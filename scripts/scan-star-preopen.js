"use strict";

const fs = require("fs");
const path = require("path");

const {
  fetchFutoptStockMappingReady,
  fetchStockFutureLiveContracts,
  fetchPreopenFinalBlindBuyReady,
  fetchPreopenSnapshotHistory,
  fetchPreopenSnapshots,
  fetchSourceStatus,
} = require("../lib/supabase-public-slot");
const { upsertSnapshot } = require("../lib/supabase-snapshots");
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
  futureVolume: Number(process.env.STAR_MIN_FUTURE_VOLUME || 50),
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

function normalizeBool(value) {
  return value === true || String(value).toLowerCase() === "true";
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
    updatedAt: row?.updated_at || row?.observed_at || row?.latest_observed_at || "",
    observedAt: row?.observed_at || row?.latest_observed_at || row?.updated_at || "",
    referencePrice,
    trialPrice,
    trialPct: percentChange(trialPrice, referencePrice),
    bidVolume: cleanNumber(row?.bid_volume),
    askVolume: cleanNumber(row?.ask_volume),
    bidAskRatio: bidAskRatio(row?.bid_volume, row?.ask_volume),
    bestBidPrice,
    bestAskPrice: cleanNumber(row?.best_ask_price),
    bestBidOk: bestBidPrice > 0 && trialPrice > 0 && bestBidPrice >= trialPrice,
    isTrial: normalizeBool(row?.is_trial),
    isLimitUpBid: normalizeBool(row?.is_limit_up_bid),
    limitUpPrice: cleanNumber(row?.limit_up_price),
  };
}

function normalizeMapping(row) {
  const code = normalizeCode(row?.stock_symbol || row?.underlying_symbol || row?.symbol);
  const sourceStatus = String(row?.source_status || "").trim().toLowerCase();
  return {
    code,
    name: row?.stock_name || row?.underlying_name || code,
    futureSymbol: String(row?.future_symbol || "").trim().toUpperCase(),
    futureLastPrice: cleanNumber(row?.futopt_last_price),
    futurePct: cleanNumber(row?.futopt_change_percent ?? row?.fut_change_percent ?? row?.change_percent),
    txfPct: cleanNumber(row?.txf_change_percent),
    futureRelativeTxf: cleanNumber(row?.relative_to_txf_percent ?? row?.rel_to_txf),
    futureVolume: cleanNumber(row?.futopt_total_volume ?? row?.total_volume),
    quoteUpdatedAt: row?.futopt_updated_at || row?.quote_updated_at || row?.updated_at || "",
    quoteAgeSeconds: cleanNumber(row?.quote_age_seconds),
    hasMapping: normalizeBool(row?.has_mapping) || row?.source_status !== undefined,
    hasQuote: normalizeBool(row?.has_quote) || row?.source_status !== undefined,
    quoteFresh180s: normalizeBool(row?.quote_fresh_180s) || sourceStatus === "ready",
    sourceStatus,
    futoptReady: normalizeBool(row?.futopt_ready) || sourceStatus === "ready",
    sourceTables: row?.source_status !== undefined ? ["v_stock_future_live_contract"] : ["v_futopt_stock_mapping_ready"],
  };
}

function basisPercent(futureLastPrice, trialPrice) {
  const future = cleanNumber(futureLastPrice);
  const trial = cleanNumber(trialPrice);
  return trial > 0 ? ((future - trial) / trial) * 100 : 0;
}

function compactStageItem(item = {}) {
  return {
    code: item.code,
    name: item.name,
    futureSymbol: item.futureSymbol,
    futureLastPrice: cleanNumber(item.futureLastPrice),
    futurePct: cleanNumber(item.futurePct),
    txfPct: cleanNumber(item.txfPct),
    futureRelativeTxf: cleanNumber(item.futureRelativeTxf),
    futureVolume: cleanNumber(item.futureVolume),
    sourceStatus: item.sourceStatus || "",
    futureQuoteUpdatedAt: item.futureQuoteUpdatedAt || item.quoteUpdatedAt || "",
    trialPrice: cleanNumber(item.trialPrice),
    referencePrice: cleanNumber(item.referencePrice),
    trialPct: cleanNumber(item.trialPct),
    bidAskRatio: cleanNumber(item.bidAskRatio),
    bidVolume: cleanNumber(item.bidVolume),
    askVolume: cleanNumber(item.askVolume),
    bestBidPrice: cleanNumber(item.bestBidPrice),
    bestAskPrice: cleanNumber(item.bestAskPrice),
    basisPct: cleanNumber(item.basisPct),
    basisType: item.basisType || "",
    isLimitUpBid: Boolean(item.isLimitUpBid),
    score: cleanNumber(item.score),
    reason: item.reason || "",
    sourceTables: Array.isArray(item.sourceTables) ? item.sourceTables : [],
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

  const [mappingResult, preopenResult, sourceStatus] = await Promise.all([
    fetchStockFutureLiveContracts().catch(() => fetchFutoptStockMappingReady()),
    fetchPreopenSnapshots(),
    fetchSourceStatus().catch((error) => ({ ok: false, error: error?.message || String(error), rows: [] })),
  ]);

  const mappings = (mappingResult.rows || []).map(normalizeMapping).filter((row) => /^\d{4}$/.test(row.code));
  const preopenByCode = new Map((preopenResult.rows || []).map(normalizePreopen).filter((row) => /^\d{4}$/.test(row.code)).map((row) => [row.code, row]));
  const futureInitialMatches = mappings
    .filter((mapping) => mapping.futoptReady || mapping.sourceStatus === "stale")
    .filter((mapping) => mapping.futurePct >= THRESHOLDS.futurePct)
    .filter((mapping) => mapping.futureRelativeTxf >= THRESHOLDS.futureRelativeTxf)
    .filter((mapping) => mapping.futureVolume >= THRESHOLDS.futureVolume)
    .map((mapping) => compactStageItem({
      ...mapping,
      futureQuoteUpdatedAt: mapping.quoteUpdatedAt,
      reason: [
        `期貨漲幅 ${mapping.futurePct.toFixed(2)}%`,
        `相對 TXF ${mapping.futureRelativeTxf.toFixed(2)}%`,
        `期貨量 ${Math.round(mapping.futureVolume)}`,
        mapping.sourceStatus === "stale" ? "source stale 只觀察" : "source ready",
      ].join("，"),
    }))
    .sort((a, b) => b.futurePct - a.futurePct
      || b.futureRelativeTxf - a.futureRelativeTxf
      || b.futureVolume - a.futureVolume);
  const candidates = [];
  const diagnostics = {
    futoptQuoteLiveHasStockFutures: mappings.some((row) => row.hasQuote && row.futureSymbol && row.futureSymbol !== "TXF"),
    futoptReadyCount: mappings.filter((row) => row.futoptReady).length,
    futoptMappedCount: mappings.filter((row) => row.hasMapping).length,
    futoptQuoteCount: mappings.filter((row) => row.hasQuote).length,
    futoptFresh180Count: mappings.filter((row) => row.quoteFresh180s).length,
    preopenSnapshotCount: preopenByCode.size,
    finalBlindBuyReadyCount: 0,
    finalBlindBuyHas3SnapshotsCount: 0,
    sourceStatusOk: sourceStatus.ok === true,
    sourceStatusPayload: sourceStatus.latest?.payload || {},
  };

  for (const mapping of mappings) {
    if (!mapping.futoptReady || !mapping.hasMapping || !mapping.hasQuote || !mapping.quoteFresh180s) continue;
    const preopen = preopenByCode.get(mapping.code);
    if (!preopen || preopen.trialPrice <= 0 || preopen.referencePrice <= 0) continue;
    const baseFailures = [
      ruleResult(mapping.futurePct >= THRESHOLDS.futurePct, `期貨漲幅 ${mapping.futurePct.toFixed(2)}% < ${THRESHOLDS.futurePct}%`),
      ruleResult(mapping.futureRelativeTxf >= THRESHOLDS.futureRelativeTxf, `相對 TXF ${mapping.futureRelativeTxf.toFixed(2)}% < ${THRESHOLDS.futureRelativeTxf}%`),
      ruleResult(mapping.futureVolume >= THRESHOLDS.futureVolume, `期貨量 ${Math.round(mapping.futureVolume)} < ${THRESHOLDS.futureVolume}`),
      ruleResult(preopen.trialPct >= THRESHOLDS.trialPct, `試撮漲幅 ${preopen.trialPct.toFixed(2)}% < ${THRESHOLDS.trialPct}%`),
      ruleResult(preopen.bidAskRatio >= THRESHOLDS.bidAskRatio, `委買賣比 ${preopen.bidAskRatio.toFixed(2)} < ${THRESHOLDS.bidAskRatio}`),
      ruleResult(preopen.bestBidOk, "最佳買價未達試撮價"),
    ].filter(Boolean);
    if (baseFailures.length) continue;

    candidates.push({
      date,
      code: mapping.code,
      name: preopen.name || mapping.name,
      market: preopen.market,
      futureSymbol: mapping.futureSymbol,
      futureLastPrice: mapping.futureLastPrice,
      futurePct: Number(mapping.futurePct.toFixed(4)),
      txfPct: Number(mapping.txfPct.toFixed(4)),
      futureRelativeTxf: Number(mapping.futureRelativeTxf.toFixed(4)),
      futureVolume: mapping.futureVolume,
      sourceStatus: mapping.sourceStatus,
      futureQuoteUpdatedAt: mapping.quoteUpdatedAt,
      futureQuoteAgeSeconds: mapping.quoteAgeSeconds,
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
      limitUpPrice: preopen.limitUpPrice,
      basisPct: Number(basisPercent(mapping.futureLastPrice, preopen.trialPrice).toFixed(4)),
      basisType: basisPercent(mapping.futureLastPrice, preopen.trialPrice) > 0 ? "positive" : basisPercent(mapping.futureLastPrice, preopen.trialPrice) < 0 ? "negative" : "flat",
      stockFutureOk: true,
      preopenFutureOk: true,
      preopenTrialOk: true,
      trialAuctionOk: true,
      finalBlindBuy: false,
      finalBlindBuyOk: false,
      finalReasons: [],
      updatedAt: preopen.updatedAt || updatedAt,
      sourceTables: [...new Set([...(mapping.sourceTables || []), "fugle_preopen_snapshot"])],
    });
  }

  let finalReadyResult = { ok: true, rows: [], count: 0 };
  if (candidates.length) {
    finalReadyResult = await fetchPreopenFinalBlindBuyReady(candidates.map((item) => item.code), {
      limit: Math.max(100, candidates.length),
    });
    diagnostics.finalBlindBuyReadyCount = (finalReadyResult.rows || []).filter((row) => normalizeBool(row?.final_blind_buy_history_ready)).length;
    diagnostics.finalBlindBuyHas3SnapshotsCount = (finalReadyResult.rows || []).filter((row) => normalizeBool(row?.has_3_snapshots_last_1m) || cleanNumber(row?.snapshots_last_1m) >= 3).length;
  }
  const finalReadyByCode = new Map((finalReadyResult.rows || []).map((row) => [normalizeCode(row?.symbol), row]).filter(([code]) => /^\d{4}$/.test(code)));

  let historyByCode = new Map();
  if (candidates.length) {
    const history = await fetchPreopenSnapshotHistory(candidates.map((item) => item.code), {
      sinceIso: new Date(now.getTime() - HISTORY_LOOKBACK_SECONDS * 1000).toISOString(),
      limit: Math.max(300, candidates.length * 12),
    });
    historyByCode = history.byCode || new Map();
  }

  const matches = candidates.map((item) => {
    const ready = finalReadyByCode.get(item.code) || {};
    const readyPreopen = normalizePreopen(ready);
    const history = recentHistory(historyByCode.get(item.code) || [], now.getTime());
    const earliest = history[0] || null;
    const latest = history[history.length - 1] || null;
    const latestTrialPct = readyPreopen.trialPrice ? readyPreopen.trialPct : (latest ? latest.trialPct : item.trialPct);
    const latestBidAskRatio = readyPreopen.trialPrice ? readyPreopen.bidAskRatio : (latest ? latest.bidAskRatio : item.bidAskRatio);
    const latestBestBidOk = readyPreopen.trialPrice ? readyPreopen.bestBidOk : (latest ? latest.bestBidOk : item.bestBidOk);
    const latestIsLimitUpBid = readyPreopen.trialPrice ? readyPreopen.isLimitUpBid : (latest ? latest.isLimitUpBid : item.isLimitUpBid);
    const snapshotsLast1m = Math.max(cleanNumber(ready?.snapshots_last_1m), history.length);
    const historyReady = normalizeBool(ready?.final_blind_buy_history_ready);
    const has3Snapshots = normalizeBool(ready?.has_3_snapshots_last_1m) || snapshotsLast1m >= THRESHOLDS.finalSnapshotCount;
    const latestNotWeaker = !earliest || !latest || latest.trialPrice >= earliest.trialPrice;
    const volatility = historyVolatilityPct(history);
    const finalFailures = [
      ruleResult(finalWindowActive, "不在 08:58~08:59 終判窗口"),
      ruleResult(has3Snapshots, `ready view 1分鐘 snapshot ${snapshotsLast1m} < ${THRESHOLDS.finalSnapshotCount}`),
      ruleResult(historyReady, "final_blind_buy_history_ready=false"),
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
      snapshotCount1m: snapshotsLast1m,
      historyReady,
      has3SnapshotsLast1m: has3Snapshots,
      finalReadyLatestObservedAt: ready?.latest_observed_at || "",
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
      sourceTables: [...new Set([...item.sourceTables, "v_fugle_preopen_final_blind_buy_ready", "v_fugle_preopen_snapshot_history"])],
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
  const preopenConfirmMatches = matches.map(compactStageItem);
  const finalStageMatches = finalMatches.map(compactStageItem);
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
    mode: "supabase-first",
    date,
    usedDate: date,
    quoteDate: date,
    updatedAt,
    taipeiTime: taipeiTimeText(now),
    windowActive,
    finalWindowActive,
    thresholds: THRESHOLDS,
    source: {
      projectUrl: "https://cpmpfhbzutkiecccekfr.supabase.co",
      primary: ["v_stock_future_live_contract", "fugle_preopen_snapshot", "v_fugle_preopen_final_blind_buy_ready"],
      secondary: ["v_fugle_preopen_snapshot_history"],
      noDirectFugleApi: true,
      futureSourceUsed: mappingResult.source || "v_futopt_stock_mapping_ready",
      mappingReadyRows: mappingResult.count || mappings.length,
      preopenSnapshots: preopenResult.count || preopenByCode.size,
      finalReadyRows: finalReadyResult.count || 0,
    },
    diagnostics,
    emptyResultChecklist: [
      "futopt_quotes_live 是否有個股期貨，不是只有 TXF",
      "v_futopt_stock_mapping_ready 的 futopt_ready 數量",
      "fugle_preopen_snapshot 是否有今日 08:45 後資料",
      "v_fugle_preopen_final_blind_buy_ready 是否在 08:58~08:59 有 snapshots_last_1m >= 3",
      "source_status.payload.futopt_ok / preopen_ok / preopen_history_ok 是否為 true",
    ],
    stageRules: {
      futureInitial0846: "time>=08:45; futopt_change_percent>=2; relative_to_txf_percent>=1; futopt_total_volume>=50; source_status ready preferred, stale observe only",
      preopenConfirm0855: "future initial + trial_change_percent>=2; bid_volume/ask_volume>=1.5; best_bid_price>=trial_price; basis=(futopt_last_price-trial_price)/trial_price*100",
      finalJudgement0858: "trial_change_percent>=6; bid/ask>=3; best_bid>=trial; is_limit_up_bid=true; futopt_total_volume>=120; relative_to_txf_percent>=2; optional 3 snapshots/1m and trial volatility<=2%",
    },
    stageCounts: {
      futureInitial0846: futureInitialMatches.length,
      preopenConfirm0855: preopenConfirmMatches.length,
      finalJudgement0858: finalStageMatches.length,
    },
    futureInitialMatches,
    preopenConfirmMatches,
    finalMatches: finalStageMatches,
    matches,
    rawFinalMatches: finalMatches,
    watchCount: matches.length,
    matchCount: matches.length,
    finalMatchCount: finalMatches.length,
  };

  const previous = readJson(OUT_FILE, null);
  if (previous?.matches?.length) writeJson(BACKUP_FILE, previous);
  writeJson(OUT_FILE, payload);
  writeJson(SCORECARD_SOURCE_FILE, scorecardPayload);
  const snapshotResult = await upsertSnapshot("strategy1_star_preopen_latest", payload, {
    tradeDate: date,
    source: "star-preopen-latest",
    reason: "strategy1-three-stage-preopen",
  });
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

  console.log(`STAR preopen ok: 08:46 ${futureInitialMatches.length}, 08:55 ${preopenConfirmMatches.length}, FinalBlindBuy ${finalMatches.length}, futoptReady=${diagnostics.futoptReadyCount}, preopen=${diagnostics.preopenSnapshotCount}, finalReady=${diagnostics.finalBlindBuyReadyCount}, window=${windowActive}, finalWindow=${finalWindowActive}, snapshot=${snapshotResult.ok ? "ok" : snapshotResult.reason || snapshotResult.error || "failed"}`);
  if (!windowActive) console.log("STAR preopen note: outside 08:45~08:59, wrote Supabase diagnostics only.");
}

main().catch((error) => {
  const payload = {
    ok: false,
    strategy: "STAR",
    mode: "supabase-first",
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
