"use strict";

const fs = require("fs");
const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");
const { readSnapshot, upsertSnapshot } = require("../lib/supabase-snapshots");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const DATA_DIR = path.join(RUNTIME_DIR, "data");
const SNAPSHOT_KEY = "strategy2_v2_realtime_observation";
const CONTRACT = "strategy2-v2-realtime-quote-observation-v1";
const SOURCE_NAME = "fugle_daytrade_source";
const MIN_PRICE = 50;
const MAX_HISTORY = 80;
const MAX_PREOPEN_WATCH_ROWS = 20;
const MAX_PREOPEN_WATCH_HISTORY = 360;
const PREOPEN_WATCH_SOURCE = "futopt_preopen_watch_history";
const STRATEGY_DETECTED_SOURCE = "strategy_detected_history";
const LOOP_LOCK_FILE = path.join(RUNTIME_DIR, "state", "strategy2-v2-realtime-observer.lock");

function number(value) {
  const parsed = Number(String(value ?? "").replace(/[,%]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 2) {
  return Number(number(value).toFixed(digits));
}

function bool(value) {
  return value === true || String(value || "").toLowerCase() === "true" || value === 1 || value === "1";
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
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const hour = Number(get("hour") || 0);
  const minute = Number(get("minute") || 0);
  const second = Number(get("second") || 0);
  return {
    date: get("year") + "-" + get("month") + "-" + get("day"),
    ymd: get("year") + get("month") + get("day"),
    hour,
    minute,
    second,
    minuteOfDay: hour * 60 + minute,
  };
}

function normalizeCode(value) {
  const text = String(value || "").trim();
  return /^\d{4}$/.test(text) ? text : "";
}

function iso(value, fallback = "") {
  const stamp = Date.parse(String(value || ""));
  return Number.isFinite(stamp) ? new Date(stamp).toISOString() : fallback;
}

function ageSeconds(value, now = Date.now()) {
  const stamp = Date.parse(String(value || ""));
  return Number.isFinite(stamp) ? Math.max(0, Math.floor((now - stamp) / 1000)) : 999999;
}

function taipeiIso(clock) {
  return clock.date + "T" + String(clock.hour).padStart(2, "0") + ":" + String(clock.minute).padStart(2, "0") + ":" + String(clock.second).padStart(2, "0") + "+08:00";
}

function classifyPreopenBasis({ futurePrice, preopenPrice, basisPercent, relativeToTxfPercent, isStale, hasTrialRow, hasTrialPrice }) {
  if (isStale) return "stale不可正";
  if (futurePrice <= 0) return "資料缺";
  if (!hasTrialRow) return "試撮缺";
  if (!hasTrialPrice || preopenPrice <= 0) return "待試撮";
  if (basisPercent > 0) return "正價差";
  if (basisPercent < 0 && relativeToTxfPercent > 0) return "逆收斂";
  if (basisPercent < 0) return "逆價差";
  return "期貨觀察";
}

function preopenDisplayStatus(basisStatus, sourceStatus) {
  if (basisStatus === "stale不可正") return "stale觀察保存";
  if (basisStatus === "待試撮" || basisStatus === "試撮缺") return basisStatus;
  if (sourceStatus && sourceStatus !== "ready" && sourceStatus !== "ok") return "gate=D觀察保存";
  return "期貨前20觀察";
}

function sortPreopenRows(rows) {
  return [...rows].sort((left, right) => {
    const lScore = number(left.relative_txf_percent ?? left.relativeToTxfPercent) * 1000 + number(left.future_volume ?? left.totalVolume);
    const rScore = number(right.relative_txf_percent ?? right.relativeToTxfPercent) * 1000 + number(right.future_volume ?? right.totalVolume);
    return rScore - lScore;
  });
}

function sourceConfig() {
  return {
    url: terminalSupabaseUrl({ root: ROOT, runtimeDir: RUNTIME_DIR }).replace(/\/+$/, ""),
    key: terminalSupabaseKey({ root: ROOT, runtimeDir: RUNTIME_DIR }),
  };
}

async function readRows(config, table, params, timeoutMs = 10000) {
  const query = new URLSearchParams(params);
  const response = await fetch(config.url + "/rest/v1/" + table + "?" + query.toString(), {
    headers: {
      apikey: config.key,
      Authorization: "Bearer " + config.key,
      Accept: "application/json",
      Range: "0-5000",
    },
    cache: "no-store",
    signal: AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(table + " HTTP " + response.status + ": " + text.slice(0, 180));
  return text ? JSON.parse(text) : [];
}

async function safeRows(config, table, params, errors) {
  try {
    return await readRows(config, table, params);
  } catch (error) {
    errors.push(table + ":" + (error?.message || String(error)).slice(0, 140));
    return [];
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function eligibleMotherPool(row) {
  return row?.source_name === SOURCE_NAME
    && /^(TSE|OTC)$/i.test(String(row?.market || ""))
    && number(row?.price) >= MIN_PRICE
    && number(row?.total_volume) > 0;
}

function observationSignal(row, quote) {
  const price = number(quote?.price);
  const open = number(quote?.open_price || row?.open_price);
  const change = number(quote?.change_percent);
  const volume = number(quote?.total_volume);
  const avg5 = number(row?.avg5_volume);
  const relativeVolume = number(row?.volume_vs_avg5_ratio || row?.relative_volume_ratio);
  const volumeStrong = (avg5 > 0 && volume >= avg5 * 2) || relativeVolume >= 2;
  const maStrong = bool(row?.ma3_turn_up) || bool(row?.ma5_turn_up) || bool(row?.ma10_turn_up) || bool(row?.ma_bull_stack_short) || bool(row?.ma_bull_stack_mid);
  const aboveOpen = open > 0 && price > open;
  const breakout = bool(row?.opening_range_break) && aboveOpen;
  const surge = bool(row?.surge_flag) && change > 2;
  if (breakout && (volumeStrong || maStrong)) return {
    id: "s2_quote_opening_breakout_watch",
    label: "秒級開盤突破觀察",
    reason: "即時 quote 突破開盤區間，量能或均線結構同步轉強",
  };
  if (surge && volumeStrong) return {
    id: "s2_quote_surge_volume_watch",
    label: "秒級量價轉強觀察",
    reason: "即時漲幅與成交量同步放大，等待正式 1 分 K 確認",
  };
  if (change > 2 && aboveOpen && maStrong) return {
    id: "s2_quote_momentum_watch",
    label: "秒級動能觀察",
    reason: "即時價格站上開盤且均線轉強，等待 KD/MACD 與 1 分 K 確認",
  };
  return null;
}

function mapBySymbol(rows, key = "symbol") {
  const map = new Map();
  for (const row of rows) {
    const code = normalizeCode(row?.[key] || row?.underlying_symbol);
    if (code) map.set(code, row);
  }
  return map;
}

async function readIntradayObservations(config, clock, previous, errors) {
  const motherRows = await safeRows(config, "v_fugle_daytrade_mother_pool", {
    select: "trade_date,symbol,name,market,price,open_price,previous_close,total_volume,trade_value,avg5_volume,mother_pool_score,priority_score,quote_seen_at,quote_updated_at,quote_age_seconds,source_name,updated_at,high_price,low_price,volume_vs_avg5_ratio,relative_volume_ratio,ma3_turn_up,ma5_turn_up,ma10_turn_up,ma30_turn_up,ma58_turn_up,ma_bull_stack_short,ma_bull_stack_mid,above_open_price,opening_range_break,surge_flag,volume_spike_flag,pool_reasons",
    trade_date: "eq." + clock.date,
    source_name: "eq." + SOURCE_NAME,
    order: "mother_pool_score.desc",
    limit: "1000",
  }, errors);
  const eligible = motherRows.filter(eligibleMotherPool);
  const symbols = eligible.map((row) => normalizeCode(row.symbol)).filter(Boolean);
  const quoteRows = [];
  for (let index = 0; index < symbols.length; index += 120) {
    const group = symbols.slice(index, index + 120);
    quoteRows.push(...await safeRows(config, "fugle_daytrade_quotes_live", {
      select: "symbol,name,market,quote_seen_at,updated_at,last_trade_time,price,open_price,high_price,low_price,previous_close,change_percent,total_volume,trade_value,bid_price,bid_volume,ask_price,ask_volume,cumulative_bid_volume,cumulative_ask_volume",
      symbol: "in.(" + group.join(",") + ")",
      order: "quote_seen_at.desc",
      limit: "1000",
    }, errors));
  }
  const quoteBySymbol = mapBySymbol(quoteRows);
  const active = previous.activeSignals && typeof previous.activeSignals === "object" ? { ...previous.activeSignals } : {};
  const events = [];
  const nowIso = new Date().toISOString();
  for (const row of eligible) {
    const code = normalizeCode(row.symbol);
    const quote = quoteBySymbol.get(code);
    if (!quote) continue;
    const quoteTime = iso(quote.quote_seen_at || quote.updated_at || quote.last_trade_time, nowIso);
    const fresh = ageSeconds(quoteTime) <= 12;
    const signal = fresh ? observationSignal(row, quote) : null;
    const stateKey = "quote:" + code;
    const state = signal ? signal.id + "|" + quoteTime : "";
    if (!signal) {
      delete active[stateKey];
      continue;
    }
    const previousState = String(active[stateKey] || "");
    const previousSignal = previousState.split("|")[0];
    active[stateKey] = state;
    if (previousSignal === signal.id) continue;
    events.push({
      code,
      symbol: code,
      name: quote.name || row.name || code,
      market: quote.market || row.market || "",
      price: round(quote.price),
      entryPrice: round(quote.price),
      entryAt: quoteTime,
      timestamp: quoteTime,
      observedAt: nowIso,
      scanDate: clock.date,
      tradeDate: clock.date,
      source: "supabase:fugle_daytrade_quotes_live",
      sourceTimestamp: quoteTime,
      entryPriceSource: "fugle_websocket_quote_observation",
      entryCandleTime: "",
      entryTradeDate: clock.date,
      stateId: "watch",
      stateLabel: "秒級策略觀察",
      formalCandidate: false,
      eventOrigin: "strategy2_realtime_quote",
      observationKind: "quote",
      signalId: signal.id,
      signal: signal.label,
      reason: signal.reason,
      score: round(number(row.mother_pool_score) + number(row.priority_score) + (number(row.volume_vs_avg5_ratio || row.relative_volume_ratio) >= 2 ? 12 : 0)),
      pct: round(quote.change_percent),
      totalVolume: number(quote.total_volume),
      tradeValue: number(quote.trade_value),
      volumeVsAvg5Ratio: round(row.volume_vs_avg5_ratio || row.relative_volume_ratio),
      quoteAgeSeconds: ageSeconds(quoteTime),
      motherPoolScore: number(row.mother_pool_score),
      priorityScore: number(row.priority_score),
      poolReasons: row.pool_reasons || "",
    });
  }
  return {
    events,
    activeSignals: active,
    source: {
      motherPoolRows: motherRows.length,
      eligibleMotherPoolRows: eligible.length,
      quoteRows: quoteRows.length,
      freshQuoteRows: quoteRows.filter((row) => ageSeconds(row.quote_seen_at || row.updated_at || row.last_trade_time) <= 12).length,
    },
  };
}

async function readPreopenFutures(config, clock, previous, errors) {
  const [futoptRows, tickerRows, trialRows, healthRows] = await Promise.all([
    safeRows(config, "fugle_daytrade_futopt_quotes_live", {
      select: "future_symbol,underlying_symbol,product,last_price,change_percent,total_volume,updated_at,payload",
      order: "updated_at.desc",
      limit: "2000",
    }, errors),
    safeRows(config, "futopt_tickers", {
      select: "future_symbol,underlying_symbol,end_date,contract_type,product,updated_at",
      order: "underlying_symbol.asc,end_date.asc",
      limit: "5000",
    }, errors),
    safeRows(config, "fugle_preopen_snapshot", {
      select: "symbol,name,market,updated_at,reference_price,trial_price,is_trial,best_bid_price,best_ask_price,bid_volume,ask_volume,payload",
      order: "updated_at.desc",
      limit: "5000",
    }, errors),
    safeRows(config, "v_strategy12_stock_future_contract_health", {
      select: "contract_rows,ready_rows,stale_rows,not_ready_rows,strategy2_futopt_gate_rows,latest_futopt_updated_at,latest_txf_updated_at,source_status,reason,checked_at",
      limit: "1",
    }, errors),
  ]);
  const txf = futoptRows.find((row) => String(row?.product || row?.payload?.product || "").toUpperCase() === "TXF" || String(row?.future_symbol || "").toUpperCase().startsWith("TXF"));
  const txfChange = number(txf?.change_percent ?? txf?.payload?.changePercent);
  const trialBySymbol = mapBySymbol(trialRows);
  const tickersByFuture = new Map(tickerRows.map((row) => [String(row?.future_symbol || "").toUpperCase(), row]));
  const health = healthRows[0] || null;
  const sourceStatus = String(health?.source_status || (number(health?.ready_rows) > 0 ? "ready" : "not_ready")).toLowerCase();
  const snapshotTime = taipeiIso(clock);
  const observedAt = new Date().toISOString();
  const watchRows = [];
  const strategyCandidates = [];
  for (const row of futoptRows) {
    const product = String(row?.product || row?.payload?.product || "").toUpperCase();
    if (product !== "STOCK_FUTURE") continue;
    const code = normalizeCode(row?.underlying_symbol || row?.payload?.underlying_symbol || row?.payload?.underlyingSymbol);
    if (!code) continue;
    const ticker = tickersByFuture.get(String(row?.future_symbol || "").toUpperCase()) || {};
    const trial = trialBySymbol.get(code) || {};
    const change = number(row?.change_percent ?? row?.payload?.changePercent);
    const volume = number(row?.total_volume ?? row?.payload?.total?.tradeVolume);
    const preopenPrice = number(trial?.trial_price || trial?.reference_price);
    const futPrice = number(row?.last_price ?? row?.payload?.lastPrice);
    const basis = preopenPrice > 0 ? futPrice - preopenPrice : 0;
    const basisPercent = preopenPrice > 0 ? (basis / preopenPrice) * 100 : 0;
    const relativeToTxfPercent = change - txfChange;
    const quoteAgeSeconds = ageSeconds(row?.updated_at);
    const hasTrialRow = Boolean(trial?.symbol || trial?.updated_at || trial?.trial_price || trial?.reference_price);
    const hasTrialPrice = preopenPrice > 0;
    const isStale = quoteAgeSeconds > 15;
    const basisStatus = classifyPreopenBasis({
      futurePrice: futPrice,
      preopenPrice,
      basisPercent,
      relativeToTxfPercent,
      isStale,
      hasTrialRow,
      hasTrialPrice,
    });
    const displayStatus = preopenDisplayStatus(basisStatus, sourceStatus);
    const futureSymbol = row?.future_symbol || ticker?.future_symbol || "";
    const watchRow = {
      snapshot_time: snapshotTime,
      trade_date: clock.date,
      symbol: code,
      name: trial?.name || row?.payload?.underlying_name || code,
      future_symbol: futureSymbol,
      future_price: round(futPrice),
      future_change_percent: round(change),
      relative_txf_percent: round(relativeToTxfPercent),
      future_volume: volume,
      preopen_price: round(preopenPrice),
      basis_percent: round(basisPercent),
      basis_status: basisStatus,
      source_status: sourceStatus,
      is_stale: isStale,
      formal_allowed: false,
      display_status: displayStatus,
      code,
      market: trial?.market || "",
      price: round(futPrice),
      entryPrice: round(futPrice),
      entryAt: iso(row?.updated_at, observedAt),
      timestamp: iso(row?.updated_at, observedAt),
      observedAt,
      scanDate: clock.date,
      tradeDate: clock.date,
      source: PREOPEN_WATCH_SOURCE,
      sourceTimestamp: iso(row?.updated_at, ""),
      entryPriceSource: "fugle_futopt_quote_observation",
      stateId: "watch",
      stateLabel: "08:45 股期觀察",
      formalCandidate: false,
      eventOrigin: PREOPEN_WATCH_SOURCE,
      observationKind: "futopt_preopen_watch",
      signalId: "s2_preopen_futopt_watch",
      signal: basisStatus + "／股期觀察",
      reason: "08:45-08:59 股期前20觀察列，相對 TXF " + round(relativeToTxfPercent) + "% ，量 " + volume + "，" + basisStatus,
      futureSymbol,
      futureChangePercent: round(change),
      relativeToTxfPercent: round(relativeToTxfPercent),
      totalVolume: volume,
      trialPrice: round(preopenPrice),
      preopenPrice: round(preopenPrice),
      basis: round(basis),
      basisPercent: round(basisPercent),
      basisStatus,
      sourceStatus,
      isStale,
      formalAllowed: false,
      displayStatus,
      quoteAgeSeconds,
    };
    watchRows.push(watchRow);
    if (!isStale && futPrice > 0 && change > 0 && volume > 0 && relativeToTxfPercent > 0) {
      strategyCandidates.push({
        ...watchRow,
        source: "supabase:fugle_daytrade_futopt_quotes_live",
        eventOrigin: "strategy2_preopen_futopt",
        observationKind: "futopt_preopen",
        signalId: "s2_preopen_futopt_lead",
        signal: basisStatus + "／股期領漲",
        reason: "近月股期相對 TXF " + round(relativeToTxfPercent) + "% ，量 " + volume + "，" + basisStatus,
      });
    }
  }
  const current = sortPreopenRows(watchRows).slice(0, MAX_PREOPEN_WATCH_ROWS);
  const strategyCurrent = sortPreopenRows(strategyCandidates).slice(0, MAX_PREOPEN_WATCH_ROWS);
  const active = previous.activeSignals && typeof previous.activeSignals === "object" ? { ...previous.activeSignals } : {};
  const events = [];
  for (const row of strategyCurrent) {
    const key = "futopt:" + row.code;
    const state = row.signalId + "|" + row.basisStatus;
    const previousState = String(active[key] || "");
    active[key] = state;
    if (previousState !== state) events.push(row);
  }
  return {
    events,
    preopenFutures: current,
    preopenWatchRows: current,
    strategyDetectedRows: strategyCurrent,
    activeSignals: active,
    source: {
      futoptRows: futoptRows.length,
      tickerRows: tickerRows.length,
      trialRows: trialRows.length,
      health,
      txfChangePercent: round(txfChange),
      preopenWatchRows: current.length,
      strategyDetectedRows: strategyCurrent.length,
      preopenWatchSource: PREOPEN_WATCH_SOURCE,
      strategyDetectedSource: STRATEGY_DETECTED_SOURCE,
    },
  };
}

function appendEvents(previous, incoming) {
  const seen = new Map();
  for (const row of [...(Array.isArray(previous) ? previous : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const key = String(row?.eventOrigin || "") + "|" + String(row?.code || "") + "|" + String(row?.signalId || "") + "|" + String(row?.entryAt || "");
    if (row?.code && row?.entryAt) seen.set(key, row);
  }
  return [...seen.values()].sort((left, right) => String(right.entryAt || "").localeCompare(String(left.entryAt || ""))).slice(0, MAX_HISTORY);
}

function appendPreopenWatchHistory(previous, incoming) {
  const seen = new Map();
  for (const row of [...(Array.isArray(previous) ? previous : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const symbol = String(row?.symbol || row?.code || "");
    const futureSymbol = String(row?.future_symbol || row?.futureSymbol || "");
    const snapshotTime = String(row?.snapshot_time || row?.snapshotTime || row?.observedAt || "");
    if (!symbol || !snapshotTime) continue;
    seen.set(snapshotTime + "|" + symbol + "|" + futureSymbol, row);
  }
  return [...seen.values()]
    .sort((left, right) => {
      const timeOrder = String(right.snapshot_time || right.snapshotTime || "").localeCompare(String(left.snapshot_time || left.snapshotTime || ""));
      if (timeOrder !== 0) return timeOrder;
      return number(right.relative_txf_percent ?? right.relativeToTxfPercent) - number(left.relative_txf_percent ?? left.relativeToTxfPercent);
    })
    .slice(0, MAX_PREOPEN_WATCH_HISTORY);
}

async function runOnce() {
  const diagnostic = process.argv.includes("--diagnostic");
  const now = new Date();
  const clock = taipeiParts(now);
  const config = sourceConfig();
  if (!config.url || !config.key) throw new Error("strategy2_realtime_supabase_credentials_missing");
  const previousSnapshot = await readSnapshot(SNAPSHOT_KEY, {
    tradeDate: clock.ymd,
    allowLatestFallback: false,
    timeoutMs: 5000,
  });
  const previous = previousSnapshot?.payload?.dataDate === clock.date ? previousSnapshot.payload : {};
  const errors = [];
  const intradayStart = 9 * 60;
  const preopenStart = 8 * 60 + 45;
  const end = 13 * 60 + 30;
  let phase = "waiting";
  let result = { events: [], activeSignals: previous.activeSignals || {}, source: {} };
  if (clock.minuteOfDay >= preopenStart && clock.minuteOfDay < intradayStart) {
    phase = "preopen_futopt";
    result = await readPreopenFutures(config, clock, previous, errors);
  } else if (clock.minuteOfDay >= intradayStart && clock.minuteOfDay <= end) {
    phase = "intraday_quote";
    result = await readIntradayObservations(config, clock, previous, errors);
  } else if (diagnostic) {
    phase = "diagnostic";
    result = await readIntradayObservations(config, clock, previous, errors);
  }
  const preopenWatchRows = Array.isArray(result.preopenWatchRows) ? result.preopenWatchRows : [];
  const previousPreopenWatchHistory = previous.preopenWatchHistory || previous.futoptPreopenWatchHistory || previous.futopt_preopen_watch_history || [];
  const preopenWatchHistory = appendPreopenWatchHistory(previousPreopenWatchHistory, preopenWatchRows);
  const events = appendEvents(previous.observations, result.events);
  const strategyDetectedHistory = appendEvents(previous.strategyDetectedHistory || previous.strategy_detected_history || previous.observations, result.events);
  const updatedAt = new Date().toISOString();
  const runId = "strategy2-v2-realtime-" + clock.ymd + "-" + String(clock.hour).padStart(2, "0") + String(clock.minute).padStart(2, "0") + String(clock.second).padStart(2, "0");
  const payload = {
    ok: errors.length === 0,
    strategy: "strategy2",
    version: "v2",
    strategyContract: CONTRACT,
    dataDate: clock.date,
    date: clock.date,
    tradeDate: clock.date,
    runId,
    updatedAt,
    phase,
    status: errors.length ? "degraded" : phase === "waiting" ? "waiting" : "observation",
    qualityStatus: errors.length ? "degraded" : "observation",
    unattendedStatus: errors.length ? "NO" : "YES",
    formalDisplayAllowed: false,
    publishAllowed: false,
    source: "supabase:fugle_daytrade_quotes_live+v_fugle_daytrade_mother_pool+fugle_daytrade_futopt_quotes_live",
    pollIntervalSeconds: 3,
    observations: events,
    observationCount: events.length,
    strategyDetectedHistory,
    strategy_detected_history: strategyDetectedHistory,
    preopenFutures: result.preopenFutures || previous.preopenFutures || [],
    preopenWatchRows,
    preopenWatchCount: preopenWatchRows.length,
    preopenWatchHistory,
    preopenWatchHistoryCount: preopenWatchHistory.length,
    futoptPreopenWatchHistory: preopenWatchHistory,
    futopt_preopen_watch_history: preopenWatchHistory,
    historyContracts: {
      futopt_preopen_watch_history: PREOPEN_WATCH_SOURCE,
      strategy_detected_history: STRATEGY_DETECTED_SOURCE,
      preopen_watch_max_batch_rows: MAX_PREOPEN_WATCH_ROWS,
      preopen_watch_max_history_rows: MAX_PREOPEN_WATCH_HISTORY,
    },
    activeSignals: result.activeSignals,
    sourceHealth: result.source,
    errors,
    transport: { source: "strategy2-v2-realtime-observer", snapshotKey: SNAPSHOT_KEY, runId },
  };
  const shouldPublish = result.events.length > 0 || preopenWatchRows.length > 0 || !previous.updatedAt || Date.now() - Date.parse(previous.updatedAt || 0) >= 15000;
  const snapshot = shouldPublish
    ? await upsertSnapshot(SNAPSHOT_KEY, payload, {
      tradeDate: clock.ymd,
      snapshotId: runId,
      source: "strategy2-v2-realtime-observer",
      reason: phase,
      locked: false,
      timeoutMs: 12000,
    })
    : { ok: true, skipped: true, reason: "no_new_event_within_15_seconds" };
  const receipt = {
    strategy: "strategy2",
    version: "v2-realtime-observer",
    strategyContract: CONTRACT,
    dataDate: clock.date,
    runId,
    phase,
    status: payload.status,
    pollIntervalSeconds: payload.pollIntervalSeconds,
    observationCount: payload.observationCount,
    preopenWatchCount: payload.preopenWatchCount,
    preopenWatchHistoryCount: payload.preopenWatchHistoryCount,
    strategyDetectedHistoryCount: strategyDetectedHistory.length,
    sourceHealth: payload.sourceHealth,
    errors,
    snapshot,
    startedAt: now.toISOString(),
    finishedAt: new Date().toISOString(),
  };
  writeJson(path.join(DATA_DIR, "scan-receipts", "strategy2-v2-realtime.json"), receipt);
  console.log(JSON.stringify({ ok: true, runId, phase, observationCount: payload.observationCount, preopenWatchCount: payload.preopenWatchCount, preopenWatchHistoryCount: payload.preopenWatchHistoryCount, newEvents: result.events.length, snapshot: snapshot.ok, skipped: snapshot.skipped || false, errors }, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLoopLock() {
  fs.mkdirSync(path.dirname(LOOP_LOCK_FILE), { recursive: true });
  try {
    fs.writeFileSync(LOOP_LOCK_FILE, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n", { encoding: "utf8", flag: "wx" });
    return true;
  } catch {
    try {
      const existing = JSON.parse(fs.readFileSync(LOOP_LOCK_FILE, "utf8"));
      if (processAlive(existing?.pid)) return false;
    } catch {}
    try { fs.unlinkSync(LOOP_LOCK_FILE); } catch {}
    fs.writeFileSync(LOOP_LOCK_FILE, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n", { encoding: "utf8", flag: "wx" });
    return true;
  }
}

function releaseLoopLock() {
  try {
    const existing = JSON.parse(fs.readFileSync(LOOP_LOCK_FILE, "utf8"));
    if (Number(existing?.pid) === process.pid) fs.unlinkSync(LOOP_LOCK_FILE);
  } catch {}
}

async function main() {
  if (!process.argv.includes("--loop")) return runOnce();
  if (!acquireLoopLock()) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: "strategy2_realtime_observer_already_running" }));
    return;
  }
  const diagnostic = process.argv.includes("--diagnostic");
  const preopenStart = 8 * 60 + 45;
  const end = 13 * 60 + 30;
  try {
    while (true) {
      const minute = taipeiParts().minuteOfDay;
      if (!diagnostic && minute > end) return;
      if (!diagnostic && minute < preopenStart) {
        await sleep(3000);
        continue;
      }
      await runOnce();
      await sleep(3000);
    }
  } finally {
    releaseLoopLock();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, strategy: "strategy2", component: "realtime-observer", error: error?.message || String(error) }, null, 2));
  process.exit(1);
});