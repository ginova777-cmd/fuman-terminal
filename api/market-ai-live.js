const { buildMarketCalendarContract, installMarketCalendarResponse } = require("../lib/market-calendar-contract");
const fs = require("fs");
const path = require("path");

const latestStrategy = require("./latest-strategy");
const realtimeRadarLatest = require("./realtime-radar-latest");
const market = require("./market");
const heatmap = require("./heatmap");
const { readSnapshot } = require("../lib/supabase-snapshots");
const {
  attachRunTimeSourceEvidence,
  buildRunTimeSourceSnapshotFields,
} = require("../lib/run-time-source-snapshot-contract");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_ROOT = process.env.FUMAN_RUNTIME_DIR || process.env.FUMAN_RUNTIME_ROOT || "C:\\fuman-runtime";
const CACHE_FILE = "market-ai-live.json";
const BREADTH_FILE = "market-ai-breadth-latest.json";
const MARKET_SUMMARY_FILE = "market-summary.json";
const STOCKS_SLIM_FILE = "stocks-slim.json";
const AI_WINDOW_START_SECONDS = 9 * 60 * 60;
const AI_WINDOW_END_SECONDS = 13 * 60 * 60 + 30 * 60;
const AI_TODAY_REQUIRED_START_SECONDS = 8 * 60 * 60;
const SNAPSHOT_TIMEOUT_MS = Number(process.env.FUMAN_MARKET_AI_SNAPSHOT_TIMEOUT_MS || 1500);
const HEATMAP_LIVE_TIMEOUT_MS = Number(process.env.FUMAN_MARKET_AI_HEATMAP_LIVE_TIMEOUT_MS || 7000);
const ALLOW_CODE_REPO_CACHE = process.env.FUMAN_MARKET_AI_ALLOW_CODE_REPO_CACHE === "1";
const MARKET_AI_RUN_TIME_SOURCE_SNAPSHOT_REQUIRED_FIELD = "source_snapshot_captured_at";

function cacheCandidates(file = CACHE_FILE) {
  const candidates = [path.join(RUNTIME_ROOT, "data", file)];
  if (ALLOW_CODE_REPO_CACHE) candidates.push(path.join(ROOT, "data", file));
  return candidates;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readLatestCachedFile(file) {
  const rows = cacheCandidates(file)
    .filter((file) => fs.existsSync(file))
    .map((file) => {
      const payload = readJson(file);
      const parsed = Date.parse(payload?.updatedAt || payload?.generatedAt || "");
      const mtime = fs.statSync(file).mtimeMs;
      return { file, payload, freshness: Number.isFinite(parsed) ? parsed : mtime };
    })
    .sort((a, b) => b.freshness - a.freshness);
  return rows[0]?.payload || null;
}

function readCachedPayload() {
  return readLatestCachedFile(CACHE_FILE);
}

function hasBreadthPayload(payload) {
  return Boolean(payload && Number(payload.sample || 0) > 0 && Number(payload.up || 0) + Number(payload.down || 0) > 0);
}

function readCachedBreadth() {
  const payload = readLatestCachedFile(BREADTH_FILE);
  return hasBreadthPayload(payload) ? payload : null;
}

function readCachedMarketSummary() {
  return readLatestCachedFile(MARKET_SUMMARY_FILE);
}

function readCachedStocksSlim() {
  return readLatestCachedFile(STOCKS_SLIM_FILE);
}

function writeJsonAtomic(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temp, `${JSON.stringify(payload)}\n`, "utf8");
  fs.renameSync(temp, file);
}

function shouldRefresh(request) {
  const query = request.query || {};
  return request.method === "POST" || query.refresh === "1" || query.fresh === "1";
}

function taipeiClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  const hour = Number(parts.hour || 0);
  const minute = Number(parts.minute || 0);
  const second = Number(parts.second || 0);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    ymd: `${parts.year}${parts.month}${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    seconds: hour * 60 * 60 + minute * 60 + second,
    weekday: String(parts.weekday || ""),
  };
}

function isMarketAiDetectWindow(clock = taipeiClock()) {
  return clock.seconds >= AI_WINDOW_START_SECONDS && clock.seconds <= AI_WINDOW_END_SECONDS;
}

function isMarketAiPreOpenWindow(clock = taipeiClock()) {
  return clock.seconds < AI_WINDOW_START_SECONDS;
}

function isMarketAiTodayRequiredWindow(clock = taipeiClock()) {
  return clock.seconds >= AI_TODAY_REQUIRED_START_SECONDS && clock.seconds <= AI_WINDOW_END_SECONDS;
}

function isMarketAiPostClose(clock = taipeiClock()) {
  return clock.seconds > AI_WINDOW_END_SECONDS;
}

function isWeekendClosedSession(session = {}) {
  return session?.closed === true && session?.reason === "weekend";
}

function compactDate(value) {
  const text = String(value || "");
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(parsed)).replace(/\D/g, "");
  }
  return text.replace(/\D/g, "").slice(0, 8);
}

function marketPayloadTradeDates(payload) {
  const stocks = Array.isArray(payload?.market?.stocks) ? payload.market.stocks : [];
  const stockDates = stocks
    .map((stock) => stock?.quoteDate || stock?.date || stock?.Date || stock?.tradeDate)
    .map(compactDate)
    .filter(Boolean);
  return [
    payload?.market?.sourceTradeDate,
    payload?.market?.marketDates?.twse,
    payload?.market?.marketDates?.tpex,
    ...stockDates,
  ];
}

function rowTradeDate(row) {
  return compactDate(firstText(row, [
    "quoteDate",
    "tradeDate",
    "resolvedTradeDate",
    "sourceTradeDate",
    "date",
    "Date",
    "radarDate",
    "marketDataDate",
    "timestamp",
    "updatedAt",
    "quoteUpdatedAt",
    "radarUpdatedAt",
  ], ""));
}

function payloadTradeDate(payload) {
  const rowDates = rowsFromPayload(payload).map(rowTradeDate).filter(Boolean);
  return [
    payload?.resolvedTradeDate,
    payload?.tradeDate,
    payload?.sourceTradeDate,
    payload?.date,
    payload?.marketDataDate,
    payload?.dashboard?.tradeDate,
    payload?.snapshot?.tradeDate,
    payload?.marketSession?.marketDataDate,
    payload?.market?.resolvedTradeDate,
    payload?.market?.sourceTradeDate,
    payload?.market?.marketDates?.twse,
    payload?.market?.marketDates?.tpex,
    payload?.heatmap?.resolvedTradeDate,
    payload?.heatmap?.tradeDate,
    payload?.health?.today,
    payload?.heatmapDetectWindow?.taipeiDate,
    payload?.realtimeRadar?.date,
    payload?.realtimeRadar?.tradeDate,
    payload?.realtimeRadar?.marketSession?.marketDataDate,
    ...rowDates,
  ].map(compactDate).filter(Boolean).sort().at(-1) || "";
}

function isTodayDate(value, clock) {
  const date = compactDate(value);
  return Boolean(date && date === clock.ymd);
}

function filterRowsForToday(rows, clock, parentIsToday) {
  return normalizeArray(rows).filter((row) => {
    const date = rowTradeDate(row);
    return date ? date === clock.ymd : parentIsToday;
  });
}

function newestMarketDataDate(breadth, marketSummary, stocksSlim, cached) {
  return [
    marketSummary?.marketDates?.twse,
    marketSummary?.marketDates?.tpex,
    stocksSlim?.resolvedTradeDate,
    stocksSlim?.marketDates?.twse,
    stocksSlim?.marketDates?.tpex,
    ...marketPayloadTradeDates(cached),
  ].map(compactDate).filter(Boolean).sort().at(-1) || "";
}

function isWeekend(clock) {
  const weekday = String(clock?.weekday || "").toLowerCase();
  return weekday.startsWith("sat") || weekday.startsWith("sun");
}

function marketSessionState(clock, breadth, marketSummary, stocksSlim, cached) {
  const marketDataDate = newestMarketDataDate(breadth, marketSummary, stocksSlim, cached);
  const hasTodayMarketData = Boolean(marketDataDate && marketDataDate === clock.ymd);
  const weekend = isWeekend(clock);
  const postClose = isMarketAiPostClose(clock);
  const closed = weekend || postClose;
  return {
    taipeiDate: clock.date,
    today: clock.ymd,
    marketDataDate,
    hasTodayMarketData,
    closed,
    stale: !hasTodayMarketData,
    reason: weekend
      ? "weekend"
      : postClose
        ? (hasTodayMarketData ? "post_close_today_market_data" : "post_close_awaiting_today_market_data")
        : hasTodayMarketData
          ? "today-market-data"
          : "awaiting-today-market-data",
  };
}

function requiresTodayLiveSource(clock, session) {
  return Boolean(isMarketAiTodayRequiredWindow(clock) && !session?.closed);
}

function requiresTodayDetection(clock, session) {
  return Boolean(requiresTodayLiveSource(clock, session) && !session?.hasTodayMarketData);
}

function reconcileMarketSessionWithFreshness(session, dataFreshness, clock) {
  const base = { ...(session || {}) };
  if (base.closed && base.reason === "weekend") return base;
  const today = clock?.ymd || base.today || "";
  const hasLiveToday = Boolean(
    (dataFreshness?.heatmapUsable === true && dataFreshness?.heatmapTradeDate === today)
    || (dataFreshness?.radarIsToday === true && dataFreshness?.radarTradeDate === today)
    || (dataFreshness?.baseIsToday === true && dataFreshness?.baseTradeDate === today)
  );
  if (!hasLiveToday) return base;
  return {
    ...base,
    today,
    marketDataDate: today,
    hasTodayMarketData: true,
    stale: false,
    reason: dataFreshness?.heatmapUsable === true ? "live-heatmap-today" : "live-source-today",
    freshnessReconciledBy: "market-ai-live",
  };
}

function canServeCachedPayload(request, detectWindowActive, mustDetectToday) {
  return Boolean(!mustDetectToday && (!shouldRefresh(request) || !detectWindowActive));
}

function wantsFastCachedPayload(request) {
  const query = request?.query || {};
  return Boolean(
    query.shell === "1"
    || query.compact === "1"
    || query.canvas === "1"
    || query.fast === "1"
    || query.snapshot === "1"
  );
}

function cachedResponsePayload(cached, breadth, clock, reason = "cache") {
  return {
    ...cached,
    breadth: hasBreadthPayload(cached.breadth) ? cached.breadth : breadth || null,
    cacheSource: cached.cacheSource || "runtime:market-ai-live.json",
    servedAt: new Date().toISOString(),
    aiDetectWindow: {
      timezone: "Asia/Taipei",
      start: "09:00:00",
      end: "13:30:00",
      active: isMarketAiDetectWindow(clock),
      reason,
      hasSnapshot: reason === "after-1330-cache" || reason === "supabase-snapshot",
      taipeiDate: clock.date,
      taipeiTime: clock.time,
    },
  };
}

function normalizeNonTradingCachePayload(payload, session) {
  const marketDataDate = session?.marketDataDate || "";
  const marketDates = marketDataDate
    ? { ...(payload?.market?.marketDates || {}), twse: marketDataDate, tpex: marketDataDate }
    : payload?.market?.marketDates;
  return {
    ...payload,
    reason: "non-trading-day-cache",
    market: payload?.market ? {
      ...payload.market,
      trading: false,
      marketStatus: "closed",
      today: session?.today || payload.market.today,
      resolvedTradeDate: marketDataDate || payload.market.resolvedTradeDate,
      sourceTradeDate: marketDataDate || payload.market.sourceTradeDate,
      marketDates,
    } : payload?.market,
    summary: payload?.summary ? {
      ...payload.summary,
      trading: false,
      marketStatus: "closed",
    } : payload?.summary,
    aiDetectWindow: payload?.aiDetectWindow ? {
      ...payload.aiDetectWindow,
      reason: "non-trading-day-cache",
    } : payload?.aiDetectWindow,
    marketSession: { ...session, closed: true },
  };
}

function capture(handler, req) {
  return new Promise((resolve) => {
    const headers = {};
    const res = {
      setHeader(key, value) { headers[String(key).toLowerCase()] = value; },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ statusCode: this.statusCode || 200, headers, payload });
      },
      end() {
        resolve({ statusCode: this.statusCode || 204, headers, payload: null });
      },
    };
    Promise.resolve(handler(req, res)).catch((error) => {
      resolve({ statusCode: 500, headers, payload: { ok: false, error: error?.message || String(error) } });
    });
  });
}

function count(payload) {
  return Array.isArray(payload?.rows) ? payload.rows.length
    : Array.isArray(payload?.records) ? payload.records.length
      : Array.isArray(payload?.events) ? payload.events.length
        : Array.isArray(payload?.matches) ? payload.matches.length
          : 0;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(String(value).replace(/[,%]/g, "").trim());
  return Number.isFinite(number) ? number : null;
}

function retainedNonSourceEvidenceIssues(issues) {
  if (!Array.isArray(issues)) return [];
  return issues.filter((issue) => !/^(quote_coverage_at_run_|source_status_at_run_|intraday_1m_readiness_at_run_|ma_readiness_at_run_|preopen_futopt_daily_readiness_at_run_|run_quality_|run_time_source_snapshot_)/.test(String(issue || "")));
}

function buildHeatmapQuoteCoverage(payload = {}) {
  const health = payload?.health || {};
  const strict = payload?.strictQuoteContract || {};
  const freshQuotes = optionalNumber(strict.rows ?? health.formalSourceRows ?? payload.realtimeStockCount ?? health.realtimeStockCount);
  const activeSymbols = optionalNumber(health.stockCount ?? payload.stockCount ?? strict.rawRows ?? health.formalSourceRawRows);
  const explicitCoverage = optionalNumber(
    strict.fresh_quote_coverage_120s
      ?? strict.freshQuoteCoverage120s
      ?? health.fresh_quote_coverage_120s
      ?? health.freshQuoteCoverage120s
      ?? payload.fresh_quote_coverage_120s
      ?? payload.freshQuoteCoverage120s
  );
  const freshQuoteCoverage120s = explicitCoverage !== null
    ? explicitCoverage
    : freshQuotes !== null && activeSymbols ? Math.min(1, freshQuotes / activeSymbols) : null;
  const quoteAgeSeconds = optionalNumber(
    strict.latestAgeSeconds
      ?? health.formalSourceLatestAgeSeconds
      ?? payload.quote_age_seconds
      ?? payload.quoteAgeSeconds
  );
  const ok = (strict.ok ?? health.formalSourceOk ?? health.isHealthy) !== false;
  return {
    status: ok ? "ready" : "degraded",
    ok,
    fresh_quote_coverage_120s: freshQuoteCoverage120s,
    freshQuoteCoverage120s: freshQuoteCoverage120s,
    fresh_quotes: freshQuotes,
    freshQuotes,
    active_symbols: activeSymbols,
    activeSymbols,
    quote_age_seconds: quoteAgeSeconds,
    quoteAgeSeconds,
    latest_updated_at: strict.latestUpdatedAt || health.formalSourceLatestUpdatedAt || payload.updatedAt || "",
    latestUpdatedAt: strict.latestUpdatedAt || health.formalSourceLatestUpdatedAt || payload.updatedAt || "",
    formalSource: payload.formalSource || health.formalSource || strict.source || "",
  };
}

function firstText(row, keys, fallback = "") {
  for (const key of keys) {
    const value = key.split(".").reduce((current, part) => current?.[part], row);
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return fallback;
}

function firstNumber(row, keys, fallback = 0) {
  for (const key of keys) {
    const value = key.split(".").reduce((current, part) => current?.[part], row);
    const number = cleanNumber(value);
    if (number) return number;
  }
  return fallback;
}

function firstNumberWithKey(row, keys, fallback = 0) {
  for (const key of keys) {
    const value = key.split(".").reduce((current, part) => current?.[part], row);
    const number = cleanNumber(value);
    if (number) return { value: number, key };
  }
  return { value: fallback, key: "" };
}

function rowsFromPayload(payload) {
  for (const key of ["rows", "items", "signals", "records", "events", "matches", "data", "top", "hotStocks"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  if (Array.isArray(payload?.snapshot?.rows)) return payload.snapshot.rows;
  if (Array.isArray(payload?.market?.stocks)) return payload.market.stocks;
  if (Array.isArray(payload?.breadth?.stocks)) return payload.breadth.stocks;
  return [];
}

function heatmapStocks(payload) {
  return normalizeArray(payload?.sectors)
    .flatMap((sector) => normalizeArray(sector?.stocks).map((stock) => ({
      ...stock,
      industry: stock.industry || sector.name || sector.industry || "",
      sector: sector.name || sector.industry || "",
      sectorPct: cleanNumber(sector.pct ?? sector.avgPct),
      sectorUp: cleanNumber(sector.up),
      sectorDown: cleanNumber(sector.down),
    })));
}

const PCT_KEYS = ["percent", "pct", "changePercent", "change_percent"];

function scoreRow(row, source = "") {
  const pct = firstNumberWithKey(row, PCT_KEYS).value;
  const value = firstNumber(row, ["value", "tradeValue", "TradeValue", "amount", "amountYi"]);
  const baseScore = firstNumber(row, ["score", "aiScore", "rankScore", "finalScore"]);
  const side = firstText(row, ["side", "direction", "state"], "");
  const risk = /short|空|弱|風險/i.test(`${side} ${firstText(row, ["reason", "signal", "summary"], "")}`);
  const score = baseScore || 50 + Math.max(pct, 0) * 7 + Math.min(value / 100000000, 18) + (/雷達|radar/i.test(source) ? 8 : 0);
  return Math.max(1, Math.min(100, Math.round(risk ? score - 8 : score)));
}

function normalizeStockRow(row, source, extraTags = []) {
  const code = firstText(row, ["code", "Code", "symbol", "stockId", "stock_id", "ticker"], "").trim();
  if (!/^\d{4}$/.test(code)) return null;
  const name = firstText(row, ["name", "Name", "stockName", "stock_name", "company"], code);
  const pctInfo = firstNumberWithKey(row, PCT_KEYS);
  const pct = pctInfo.value;
  const close = firstNumber(row, ["price", "close", "ClosingPrice", "lastPrice", "latestClose"]);
  const value = firstNumber(row, ["value", "tradeValue", "TradeValue", "amount", "amountYi"]);
  const volume = firstNumber(row, ["volume", "tradeVolume", "TradeVolume", "totalVolume"]);
  const side = firstText(row, ["side", "direction", "state"], pct < 0 ? "空" : "多");
  const reason = firstText(row, ["reason", "signal", "description", "summary", "memo", "note"], source);
  const industry = firstText(row, ["industry", "sector", "officialIndustry", "primaryIndustry", "category", "group"], "--");
  const tags = [
    ...normalizeArray(row?.signalTags),
    ...normalizeArray(row?.tags),
    ...extraTags,
    industry && industry !== "--" ? industry : "",
  ].filter(Boolean);
  return {
    code,
    name,
    close,
    price: close,
    pct,
    percent: pct,
    percentSource: pctInfo.key,
    quoteDate: rowTradeDate(row),
    value,
    tradeValue: value,
    volume,
    tradeVolume: volume,
    score: scoreRow(row, source),
    side,
    reason,
    source,
    industry,
    tags: [...new Set(tags)].slice(0, 6),
  };
}

function mergeStockRows(...lists) {
  const byCode = new Map();
  for (const row of lists.flat()) {
    if (!row?.code) continue;
    const previous = byCode.get(row.code);
    if (!previous || cleanNumber(row.score) > cleanNumber(previous.score)) {
      byCode.set(row.code, row);
    }
  }
  return [...byCode.values()].sort((a, b) => cleanNumber(b.score) - cleanNumber(a.score) || cleanNumber(b.pct) - cleanNumber(a.pct));
}

function groupPayload(label, source, rows, note = "") {
  return {
    label,
    source,
    note,
    count: rows.length,
    rows,
  };
}

function applyMarketCalendarToSession(session, marketCalendar = null) {
  if (!marketCalendar || marketCalendar.marketOpen !== false) return session;
  return {
    ...(session || {}),
    status: "closed",
    closed: true,
    reason: marketCalendar.reason || "market_closed",
    marketStatus: "closed",
    marketOpen: false,
    displayTradeDate: marketCalendar.displayTradeDate || session?.displayTradeDate || "",
    marketCalendar,
  };
}


function openingReportObservationRows(clock = taipeiClock(), session = {}) {
  let report = session?.openingMorningReport || null;
  if (!report) {
    try {
      report = readOpeningMorningReport(clock);
    } catch (_) {
      report = null;
    }
  }
  if (!report || report.ok === false) return [];

  const priorityNames = normalizeArray(report.priority_industries)
    .map((row) => String(row?.display_name || row?.industry || "").trim())
    .filter(Boolean)
    .slice(0, 3);
  const rankByIndustry = new Map(priorityNames.map((name, index) => [name, index + 1]));
  const recommendationRows = [
    ...normalizeArray(report.priority_industries).flatMap((industryRow) => {
      const industry = String(industryRow?.display_name || industryRow?.industry || "").trim();
      return normalizeArray(industryRow?.a_symbols).map((stock) => ({
        ...stock,
        industry,
        bias: industryRow?.bias || "",
      }));
    }),
    ...normalizeArray(report.recommended_symbols),
  ];
  const seenCodes = new Set();

  return recommendationRows
    .map((row, index) => {
      const code = String(row?.symbol || row?.code || "").trim();
      if (!code || seenCodes.has(code)) return null;
      seenCodes.add(code);
      const name = String(row?.name || row?.stockName || code).trim();
      const industry = String(row?.industry || priorityNames[Math.min(priorityNames.length - 1, Math.floor(index / 8))] || "晨報產業").trim();
      const rank = rankByIndustry.get(industry) || Math.min(3, Math.floor(index / 8) + 1);
      return normalizeStockRow({
        code,
        name,
        industry,
        sector: industry,
        pct: 0,
        percent: 0,
        score: Math.max(60, 99 - rank * 4 - index),
        side: "觀察",
        reason: `08:30 晨報第 ${rank} 強產業：${industry}；僅供開盤前海外產業觀察排序。`,
        signalTags: ["晨報Top3", "產業日報", `第${rank}強`],
      }, "晨報產業觀察", ["晨報Top3", "產業日報"]);
    })
    .filter(Boolean);
}

function heatmapSourceIssue(payload, heatmapIsToday, session = {}, clock = taipeiClock()) {
  if (!payload || !Object.keys(payload).length) return "熱力圖水源無回應";
  const health = payload.health || {};
  const sectors = normalizeArray(payload.sectors);
  const stockCount = cleanNumber(payload.stockCount || health.stockCount);
  const realtimeStockCount = cleanNumber(payload.realtimeStockCount || health.realtimeStockCount);
  const badDate = cleanNumber(health.badDate);
  const notRealtime = cleanNumber(health.notRealtime);
  const noPrice = cleanNumber(health.noPrice);
  if (!heatmapIsToday) return "";
  if (health.isHealthy === false) {
    const strictFreshnessRequired = session?.requiresTodayLiveSource === true || (session?.closed !== true && isMarketAiTodayRequiredWindow(clock));
    const quoteAgeOnly = badDate === 0
      && notRealtime === 0
      && noPrice === 0
      && stockCount > 0
      && realtimeStockCount > 0;
    if (!strictFreshnessRequired && quoteAgeOnly) return "";
    return `熱力圖即時報價水源不健康：realtime ${realtimeStockCount.toLocaleString("zh-TW")} / stock ${stockCount.toLocaleString("zh-TW")}，badDate ${badDate}，notRealtime ${notRealtime}，noPrice ${noPrice}，quoteTime ${health.quoteTime || "--"}`;
  }
  if (!sectors.length) return `熱力圖今天無族群資料：stock ${stockCount.toLocaleString("zh-TW")}，realtime ${realtimeStockCount.toLocaleString("zh-TW")}`;
  return "";
}

function buildMarketAiInsights(payload, heatmapPayload, radarPayload, clock, session) {
  const heatmapTradeDate = payloadTradeDate(heatmapPayload);
  const radarTradeDate = payloadTradeDate(radarPayload);
  const baseTradeDate = payloadTradeDate(payload);
  const heatmapIsToday = isTodayDate(heatmapTradeDate, clock);
  const radarIsToday = isTodayDate(radarTradeDate, clock);
  const baseIsToday = isTodayDate(baseTradeDate, clock);
  const heatmapIssue = heatmapSourceIssue(heatmapPayload, heatmapIsToday, session, clock);
  const marketClosedDisplay = session?.marketOpen === false || session?.marketCalendar?.marketOpen === false || session?.closed === true;
  const preOpenMarketAi = !marketClosedDisplay && isMarketAiPreOpenWindow(clock);
  const heatmapUsable = !preOpenMarketAi && (marketClosedDisplay ? normalizeArray(heatmapPayload?.sectors).length > 0 : heatmapIsToday) && !heatmapIssue;
  const heatmapQuoteCoverage = buildHeatmapQuoteCoverage(heatmapPayload || {});
  const sourceIssues = [
    heatmapIssue,
    !marketClosedDisplay && radarTradeDate && !radarIsToday ? `即時功能非今日資料：${radarTradeDate}` : "",
    !marketClosedDisplay && baseTradeDate && !baseIsToday ? `AI cache 非今日資料：${baseTradeDate}` : "",
  ].filter(Boolean);
  const staleSources = [
    !marketClosedDisplay && heatmapTradeDate && !heatmapIsToday ? `熱力圖 ${heatmapTradeDate}` : "",
    !marketClosedDisplay && radarTradeDate && !radarIsToday ? `即時功能 ${radarTradeDate}` : "",
    !marketClosedDisplay && baseTradeDate && !baseIsToday ? `AI cache ${baseTradeDate}` : "",
  ].filter(Boolean);

  const sectors = heatmapUsable ? normalizeArray(heatmapPayload?.sectors) : [];
  const sectorStocks = heatmapUsable ? heatmapStocks(heatmapPayload) : [];
  const radarRows = filterRowsForToday(rowsFromPayload(radarPayload), clock, radarIsToday);
  const baseRows = filterRowsForToday(rowsFromPayload(payload), clock, baseIsToday);
  const heatmapUp = sectors.reduce((sum, sector) => sum + cleanNumber(sector?.up), 0);
  const heatmapDown = sectors.reduce((sum, sector) => sum + cleanNumber(sector?.down), 0);
  const strongSectors = sectors.filter((sector) => cleanNumber(sector?.pct ?? sector?.avgPct) > 0)
    .sort((a, b) => cleanNumber(b?.pct ?? b?.avgPct) - cleanNumber(a?.pct ?? a?.avgPct))
    .slice(0, 5);
  const weakSectors = sectors.filter((sector) => cleanNumber(sector?.pct ?? sector?.avgPct) < 0)
    .sort((a, b) => cleanNumber(a?.pct ?? a?.avgPct) - cleanNumber(b?.pct ?? b?.avgPct))
    .slice(0, 5);

  const normalizedRadar = radarRows.map((row) => normalizeStockRow(row, "盤中訊號", [firstText(row, ["side", "direction"], "多")])).filter(Boolean);
  const normalizedBase = baseRows.map((row) => normalizeStockRow(row, "AI 判讀", ["AI 判讀"])).filter(Boolean);
  const normalizedHeatmap = sectorStocks
    .sort((a, b) => cleanNumber(b.value ?? b.tradeValue ?? b.amountYi) - cleanNumber(a.value ?? a.tradeValue ?? a.amountYi))
    .slice(0, 120)
    .map((row) => normalizeStockRow(row, "熱力圖", [cleanNumber(row.pct) >= 0 ? "動能強" : "風險高"]))
    .filter(Boolean);

  let allRows = mergeStockRows(normalizedBase, normalizedRadar, normalizedHeatmap).slice(0, 60);
  const candidateOpeningFallbackRows = openingReportObservationRows(clock, session).slice(0, 60);
  const shouldUseOpeningFallback = candidateOpeningFallbackRows.length > 0
    && normalizedRadar.length === 0
    && normalizedHeatmap.length === 0
    && (!allRows.length || normalizedBase.length === allRows.length);
  const openingFallbackRows = shouldUseOpeningFallback ? candidateOpeningFallbackRows : [];
  if (openingFallbackRows.length) allRows = openingFallbackRows;
  const rowUp = allRows.filter((row) => cleanNumber(row.pct) > 0).length;
  const rowDown = allRows.filter((row) => cleanNumber(row.pct) < 0).length;
  const sample = heatmapUsable
    ? cleanNumber(heatmapPayload?.stockCount || heatmapPayload?.sample || heatmapPayload?.count || payload?.breadth?.sample) || sectorStocks.length || heatmapUp + heatmapDown
    : allRows.length;
  const up = heatmapUsable ? heatmapUp : rowUp;
  const down = heatmapUsable ? heatmapDown : rowDown;
  const upRatio = sample ? up / sample * 100 : 0;
  const downRatio = sample ? down / sample * 100 : 0;

  const momentumRows = allRows
    .filter((row) => cleanNumber(row.pct) > 0 || /動能|強勢|多/i.test(`${row.tags.join(" ")} ${row.reason}`))
    .sort((a, b) => cleanNumber(b.pct) - cleanNumber(a.pct) || cleanNumber(b.score) - cleanNumber(a.score))
    .slice(0, 20);
  const institutionRows = allRows
    .filter((row) => /法人|外資|投信|買超|籌碼|資金/i.test(`${row.tags.join(" ")} ${row.reason} ${row.source}`))
    .sort((a, b) => cleanNumber(b.score) - cleanNumber(a.score))
    .slice(0, 20);
  const intradayRows = normalizedRadar
    .filter((row) => !/short|空/i.test(`${row.side} ${row.reason}`))
    .sort((a, b) => cleanNumber(b.score) - cleanNumber(a.score))
    .slice(0, 20);
  const riskRows = mergeStockRows(
    normalizedRadar.filter((row) => /short|空|弱|風險/i.test(`${row.side} ${row.reason} ${row.tags.join(" ")}`)),
    allRows.filter((row) => cleanNumber(row.pct) < 0)
  ).slice(0, 20);

  const allGroupRows = allRows.slice(0, 30);
  const openingReportFallbackUsed = openingFallbackRows.length > 0 || allGroupRows.some((row) => row?.source === "晨報產業觀察");
  const openingReportFallbackRowCount = openingFallbackRows.length || (openingReportFallbackUsed ? allGroupRows.filter((row) => row?.source === "晨報產業觀察").length : 0);
  const isPriorityCandidate = (row) => !/short|空|弱|風險/i.test(`${row.side} ${row.reason} ${row.tags.join(" ")}`) && cleanNumber(row.pct) >= 0;
  const fallbackIndustryNames = [...new Set(openingFallbackRows.map((row) => row.industry).filter(Boolean))].slice(0, 3);
  const strongNames = (strongSectors.map((sector) => sector.name || sector.industry).filter(Boolean).slice(0, 3).length
    ? strongSectors.map((sector) => sector.name || sector.industry).filter(Boolean).slice(0, 3)
    : fallbackIndustryNames);
  const weakNames = weakSectors.map((sector) => sector.name || sector.industry).filter(Boolean).slice(0, 3);
  const topStock = allGroupRows.find(isPriorityCandidate) || null;
  const hasDirectionalBreadth = !preOpenMarketAi && up + down > 0;
  const confidence = preOpenMarketAi ? "觀察" : !hasDirectionalBreadth ? "觀察" : Math.abs(up - down) >= Math.max(sample * 0.08, 60) ? "高" : Math.abs(up - down) >= Math.max(sample * 0.03, 25) ? "中" : "觀察";
  const bias = preOpenMarketAi ? "等待開盤" : hasDirectionalBreadth ? (up >= down ? "多方壓制" : "空方壓制") : "等待方向";
  const action = preOpenMarketAi ? "等待 09:00-13:30 市場 AI 正式偵測，不使用昨日 cache 判斷多空。" : hasDirectionalBreadth ? (up >= down ? "降低追價" : "等待方向") : "等待方向";
  const tradeDate = heatmapUsable ? (heatmapPayload?.resolvedTradeDate || heatmapPayload?.tradeDate || heatmapPayload?.health?.today || clock.ymd) : radarIsToday ? radarTradeDate : clock.ymd;
  const priorityStaleBlocked = Boolean(staleSources.length && !topStock);
  const priorityObservation = topStock ? {
    title: `${topStock.code} ${topStock.name}`,
    text: `${topStock.source}，分數 ${topStock.score}，族群 ${topStock.industry}。`,
    stock: topStock,
    staleBlocked: false,
  } : {
    title: "--",
    text: staleSources.length
      ? `等待今日 ${clock.ymd} 即時資料；已排除 ${staleSources.join("、")}，舊 snapshot 不產生優先觀察。`
      : "等待指數與 AI 簡報資料。",
    stock: null,
    staleBlocked: priorityStaleBlocked,
  };

  const groups = {
    all: groupPayload("全部", "AI merge disabled: simple market-ai", allGroupRows, "綜合分數排序"),
    momentum: groupPayload("動能強", "market-ai momentum", momentumRows, "優先看漲幅與成交額延續"),
    institution: groupPayload("法人買超", "radar/chip tags", institutionRows, "只列有法人、外資、投信或籌碼文字的標的"),
    intraday: groupPayload("盤中線索", "disabled", [], "即時掃描已停用"),
    risk: groupPayload("風險高", "radar short + weak heatmap", riskRows, "偏空、弱勢或風險標的先控管"),
  };
  const filters = [
    { key: "all", ...groups.all },
    { key: "momentum", ...groups.momentum },
    { key: "institution", ...groups.institution },
    { key: "intraday", ...groups.intraday },
    { key: "risk", ...groups.risk },
  ];

  const todayPoints = [
    preOpenMarketAi
      ? "市場廣度：尚未進入 09:00-13:30 市場 AI 偵測窗，開盤前不使用昨日 cache 判斷多空。"
      : hasDirectionalBreadth
        ? `市場廣度：樣本 ${sample.toLocaleString("zh-TW")}，上漲 ${up.toLocaleString("zh-TW")} / 下跌 ${down.toLocaleString("zh-TW")}，目前判定為${bias}。`
        : `市場廣度：樣本 ${sample.toLocaleString("zh-TW")}，漲跌方向等待 heatmap snapshot 補齊，不用舊 fallback 假判斷。`,
    sourceIssues.length ? `水源狀態：${sourceIssues[0]}。` : `水源狀態：今日正式水源可用。`,
    `族群聚焦：${strongNames.length ? strongNames.join("、") : "等待強勢族群成形"}。`,
    `優先觀察：${topStock ? `${topStock.code} ${topStock.name}，${topStock.reason}` : priorityObservation.text}。`,
    `風險提醒：${weakNames.length ? weakNames.join("、") : "暫無明顯弱勢族群"}，高分標的仍需量價確認。`,
  ];
  const riskNotes = [
    { title: sourceIssues.length ? "水源異常" : "水源正常", text: sourceIssues[0] || "正式 API 水源目前未回報 stale 或 no data。" },
    { title: "族群集中", text: strongNames.length ? `強勢集中於 ${strongNames.join("、")}，追價要等第二波確認。` : "強勢族群尚未集中，避免用單檔急拉當大盤方向。" },
    { title: "弱勢排除", text: weakNames.length ? `${weakNames.join("、")} 偏弱，先從觀察名單排除風險高標的。` : "弱勢族群沒有明顯擴散，仍需留意尾盤翻弱。" },
  ];
  const reasoning = [
    { key: "breadth", title: `上漲 ${upRatio.toFixed(2)}% / 下跌 ${downRatio.toFixed(2)}%`, text: heatmapUsable ? `樣本 ${sample.toLocaleString("zh-TW")} 檔，依熱力圖 API 判斷市場方向。` : (heatmapIssue || "今日熱力圖尚未完成，暫不使用舊 snapshot 判斷市場方向。") },
    { key: "radar", title: "簡單指數報告", text: "只採 API-only 最新資料，不讀舊 DOM snapshot。" },
    { key: "sector", title: `強族群前 ${Math.min(3, strongNames.length)} 名`, text: strongNames.join("、") || "等待族群擴散。" },
    { key: "risk", title: groups.risk.count ? "風險標的先排除" : "風險暫無集中", text: groups.risk.rows.slice(0, 4).map((row) => `${row.code} ${row.name}`).join("、") || weakNames.join("、") || "等待風險訊號。" },
  ];

  return {
    rows: allGroupRows,
    count: allGroupRows.length,
    hotStocks: allGroupRows.slice(0, 10),
    groups,
    filters,
    todayPoints,
    riskNotes,
    priorityObservation,
    sectorFocus: {
      title: strongNames.length ? strongNames.join("、") : "等待族群擴散",
      sectors: strongSectors.map((sector) => ({
        name: sector.name || sector.industry || "--",
        pct: cleanNumber(sector.pct ?? sector.avgPct),
        up: cleanNumber(sector.up),
        down: cleanNumber(sector.down),
        count: cleanNumber(sector.count),
      })),
    },
    reasoning,
    dashboard: {
      sample,
      up,
      down,
      flat: Math.max(0, sample - up - down),
      upRatio: Number(upRatio.toFixed(2)),
      downRatio: Number(downRatio.toFixed(2)),
      bias,
      confidence,
      action,
      tradeDate,
      dataSources: {
        heatmapRows: sectorStocks.length,
        heatmapSectors: sectors.length,
        radarRows: normalizedRadar.length,
        aiRows: normalizedBase.length,
        openingReportFallbackRows: openingReportFallbackRowCount,
      },
    },
    dataFreshness: {
      today: clock.ymd,
      heatmapTradeDate,
      heatmapIsToday,
      heatmapUsable,
      radarTradeDate,
      radarIsToday,
      baseTradeDate,
      baseIsToday,
      staleSources,
      sourceIssues,
      heatmapQuoteCoverage,
      priorityStaleBlocked,
      preOpenMarketAi,
      openingReportFallbackUsed,
      detectionWindow: "09:00-13:30",
    },
    fieldCompleteness: {
      todayPoints: todayPoints.length >= 4,
      riskNotes: riskNotes.length >= 2,
      priorityObservation: Boolean(priorityObservation),
      sectorFocus: Boolean(strongSectors.length || weakSectors.length || sectors.length || allGroupRows.length || staleSources.length),
      hotStocks: allGroupRows.length > 0 || staleSources.length > 0,
      reasoning: reasoning.length >= 4,
      filters: filters.length === 5,
    },
  };
}

function withTimeout(promise, timeoutMs, fallback) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function heatmapQueryForMarketAi(baseQuery, mustDetectToday) {
  const query = { ...(baseQuery || {}) };
  if (mustDetectToday) {
    delete query.snapshot;
    delete query.cache;
    delete query.fast;
    delete query.compact;
    delete query.shell;
    return {
      ...query,
      limit: "999",
      stocks: "999",
      source: "market-ai-live",
    };
  }

  return {
    ...query,
    snapshot: "1",
    compact: "1",
    shell: "1",
    limit: "60",
  };
}


function usesSimpleMarketAiReport(request = {}) {
  const query = request?.query || {};
  return query.simpleReport === "1"
    || query.indexOnly === "1"
    || query.indexReport === "1"
    || query.simple === "1";
}

function marketIndexItem(marketPayload = {}, matcher) {
  return normalizeArray(marketPayload.indexes).find((item) => matcher(String(item?.["指數"] || item?.name || item?.title || ""))) || null;
}

function signedMarketPercent(item = {}) {
  const rawPct = optionalNumber(item?.["漲跌百分比"] ?? item?.pct ?? item?.changePercent ?? item?.change_percent);
  if (rawPct === null) return null;
  const signText = String(item?.["漲跌"] ?? item?.sign ?? "");
  const signed = signText.includes("-") || signText.includes("跌") ? -Math.abs(rawPct) : Math.abs(rawPct);
  return Number(signed.toFixed(2));
}

function signedFuturesPercent(futures = {}) {
  const raw = optionalNumber(futures?.pct ?? futures?.changePercent ?? futures?.change_percent);
  if (raw === null) return null;
  const text = String(futures?.pct ?? futures?.change ?? "");
  const signed = text.includes("-") || futures?.basisSide === "short" ? -Math.abs(raw) : Math.abs(raw);
  return Number(signed.toFixed(2));
}

function formatSignedPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "--";
  const number = Number(value);
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function reportScoreFromPct(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 50;
  return Math.max(1, Math.min(100, Math.round(50 + Number(value) * 18)));
}

function buildIndexReportRows({ weighted, otc, futures, weightedPct, otcPct, futuresPct, action, riskText, updatedAt, tradeDate }) {
  const rows = [];
  if (weighted) {
    rows.push({
      rank: rows.length + 1,
      code: "TWSE",
      name: "加權指數",
      title: "加權指數",
      close: cleanNumber(weighted["收盤指數"]),
      price: weighted["收盤指數"] || "--",
      pct: weightedPct ?? 0,
      percent: weightedPct ?? 0,
      percentSource: "index-change-percent",
      score: reportScoreFromPct(weightedPct),
      side: weightedPct > 0 ? "long" : weightedPct < 0 ? "short" : "flat",
      reason: `${weighted._source || "TWSE"} ${formatSignedPercent(weightedPct)}`,
      source: weighted._source || "TWSE index",
      industry: "大盤",
      tags: ["加權指數", "低成本指數"],
      updatedAt,
      quoteDate: tradeDate,
    });
  }
  if (otc) {
    rows.push({
      rank: rows.length + 1,
      code: "OTC",
      name: "櫃買指數",
      title: "櫃買指數",
      close: cleanNumber(otc["收盤指數"]),
      price: otc["收盤指數"] || "--",
      pct: otcPct ?? 0,
      percent: otcPct ?? 0,
      percentSource: "index-change-percent",
      score: reportScoreFromPct(otcPct),
      side: otcPct > 0 ? "long" : otcPct < 0 ? "short" : "flat",
      reason: `${otc._source || "OTC"} ${formatSignedPercent(otcPct)}`,
      source: otc._source || "OTC index",
      industry: "櫃買",
      tags: ["櫃買指數", "低成本指數"],
      updatedAt,
      quoteDate: tradeDate,
    });
  }
  if (futures) {
    rows.push({
      rank: rows.length + 1,
      code: "TXF",
      name: "台指期近月",
      title: futures.name || "台指期近月",
      close: cleanNumber(futures.price),
      price: futures.price || "--",
      pct: futuresPct ?? 0,
      percent: futuresPct ?? 0,
      percentSource: "futures-change-percent",
      score: reportScoreFromPct(futuresPct),
      side: futures.basisSide || (futuresPct > 0 ? "long" : futuresPct < 0 ? "short" : "flat"),
      reason: futures.basisLabel || `${futures.change || ""} ${formatSignedPercent(futuresPct)}`.trim(),
      source: "TAIFEX MIS",
      industry: "期貨",
      tags: ["台指期", "期貨校正"],
      updatedAt,
      quoteDate: tradeDate,
    });
  }
  rows.push({
    rank: rows.length + 1,
    code: "REPORT",
    name: "操作建議",
    title: "操作建議",
    pct: 0,
    percent: 0,
    percentSource: "report-only",
    score: 50,
    side: "report",
    reason: action,
    source: "AI index report",
    industry: "報告",
    tags: ["AI 判讀", "操作建議"],
    updatedAt,
    quoteDate: tradeDate,
  });
  rows.push({
    rank: rows.length + 1,
    code: "RISK",
    name: "風險提醒",
    title: "風險提醒",
    pct: 0,
    percent: 0,
    percentSource: "report-only",
    score: 50,
    side: "risk",
    reason: riskText,
    source: "AI index report",
    industry: "報告",
    tags: ["風險", "不追價"],
    updatedAt,
    quoteDate: tradeDate,
  });
  return rows;
}

function isTaiwanStockObservationRow(row) {
  return /^\d{4}$/.test(String(row?.code || row?.Code || row?.stockId || "").trim());
}

function groupIndexReportRows(rows) {
  const stockRows = normalizeArray(rows).filter(isTaiwanStockObservationRow);
  const riskRows = stockRows.filter((row) => row.side === "short" || row.side === "risk");
  const momentumRows = stockRows.filter((row) => row.side === "long");
  return {
    all: groupPayload("簡單報告", "market index report", stockRows, "只整合 AI 判讀、加權指數、櫃買指數與台指期夜盤"),
    momentum: groupPayload("偏多線索", "market index report", momentumRows, "加權、櫃買、台指期的偏多項目"),
    institution: groupPayload("籌碼/族群", "disabled", [], "簡單報告模式不掃個股籌碼"),
    intraday: groupPayload("盤中線索", "disabled", [], "即時掃描已停用，不訂閱 Fugle 全市場"),
    risk: groupPayload("風險", "market index report", riskRows, "大盤轉弱或資料不足時只做提醒"),
  };
}

async function buildSimpleMarketAiReport(request, clock, session, deps = {}) {
  const req = { ...request, method: "GET", url: "/api/market?canvas=1&limit=12", query: { canvas: "1", limit: "12" } };
  const marketResult = deps.marketResult || await withTimeout(capture(market, req), 10000, { statusCode: 504, payload: { ok: false, error: "market_timeout" } });
  const marketPayload = marketResult?.payload || {};
  const updatedAt = marketPayload.updatedAt || new Date().toISOString();
  const tradeDate = compactDate(marketPayload.today || marketPayload.resolvedTradeDate || marketPayload.sourceTradeDate || updatedAt) || clock.ymd;
  const marketClosedDisplay = session?.marketOpen === false || session?.marketCalendar?.marketOpen === false || session?.closed === true;
  const preOpenMarketAi = !marketClosedDisplay && isMarketAiPreOpenWindow(clock);
  const weighted = marketIndexItem(marketPayload, (name) => name.includes("加權") || name.includes("發行量"));
  const otc = marketIndexItem(marketPayload, (name) => name.includes("櫃買"));
  const futures = marketPayload.futuresNear || marketPayload.futures || null;
  const weightedIndexTrend = marketPayload.weightedIndexTrend || null;
  const weightedPct = signedMarketPercent(weighted);
  const otcPct = signedMarketPercent(otc);
  const futuresPct = signedFuturesPercent(futures);
  const pctValues = [weightedPct, otcPct, futuresPct].filter((value) => value !== null);
  const weightedScore = weightedPct ?? 0;
  const otcScore = otcPct ?? weightedScore;
  const futuresScore = futuresPct ?? weightedScore;
  const trendScore = Number((weightedScore * 0.55 + otcScore * 0.25 + futuresScore * 0.20).toFixed(2));
  const rawBias = pctValues.length === 0 ? "資料不足" : trendScore >= 0.35 ? "偏多" : trendScore <= -0.35 ? "偏空" : "中性整理";
  const bias = preOpenMarketAi ? "等待開盤" : rawBias;
  const confidence = preOpenMarketAi ? "觀察" : pctValues.length >= 3 && Math.abs(trendScore) >= 0.5 ? "中高" : pctValues.length >= 2 ? "中" : "低";
  const action = preOpenMarketAi
    ? "等待 09:00-13:30 市場 AI 正式偵測，不使用開盤前指數或昨日 cache 判斷多空。"
    : rawBias === "偏多"
      ? "只看指數方向偏多，仍以分批與停損控風險，不啟動個股雷達。"
      : rawBias === "偏空"
        ? "大盤偏弱，先降槓桿與觀察反彈品質，不用熱力圖硬找強勢股。"
        : "盤面偏整理，維持觀察清單與資金控管，等待加權指數與台指期同向。";
  const riskText = pctValues.length < 2
    ? "可用指數資料不足，這份報告只能顯示保守結論，不寫 latest。"
    : "此模式不掃全市場、不訂 Fugle WebSocket；只適合簡報觀察，不作正式進場水源。";
  const rows = buildIndexReportRows({ weighted, otc, futures, weightedPct, otcPct, futuresPct, action, riskText, updatedAt, tradeDate });
  const groups = groupIndexReportRows(rows);
  const filters = ["all", "momentum", "institution", "intraday", "risk"].map((key) => ({ key, ...groups[key] }));
  const up = pctValues.filter((value) => value > 0).length;
  const down = pctValues.filter((value) => value < 0).length;
  const flat = pctValues.length - up - down;
  const todayPoints = [
    `加權指數：${weighted?.["收盤指數"] || "--"}（${formatSignedPercent(weightedPct)}）`,
    `櫃買指數：${otc?.["收盤指數"] || "--"}（${formatSignedPercent(otcPct)}）`,
    `台指期近月：${futures?.price || "--"}（${formatSignedPercent(futuresPct)}）`,
    action,
  ];
  const riskNotes = [
    { title: "水源成本", text: "熱力圖與即時掃描已從 AI 判讀預設鏈路停用，不常駐 Fugle WebSocket。" },
    { title: "正式水源", text: "這是 display-only 報告，不 publish latest，也不升級 daytrade formal entry。" },
    { title: "資料不足", text: riskText },
  ];
  const reasoning = [
    { key: "twse", title: "加權指數", text: weighted ? `來源 ${weighted._source || "market API"}，變動 ${formatSignedPercent(weightedPct)}。` : "尚未取得加權指數。" },
    { key: "otc", title: "櫃買指數", text: otc ? `來源 ${otc._source || "market API"}，變動 ${formatSignedPercent(otcPct)}。` : "尚未取得櫃買指數。" },
    { key: "txf", title: "台指期", text: futures ? `${futures.name || "TXF"} ${futures.price || "--"}，${futures.basisLabel || formatSignedPercent(futuresPct)}。` : "尚未取得台指期資料。" },
    { key: "policy", title: "資源規則", text: "報告模式只整合市場指數與 AI 判讀，不使用 shared source 升級正式水源。" },
  ];
  const dashboard = {
    sample: pctValues.length,
    up,
    down,
    flat,
    upRatio: pctValues.length ? Number((up / pctValues.length * 100).toFixed(2)) : 0,
    downRatio: pctValues.length ? Number((down / pctValues.length * 100).toFixed(2)) : 0,
    bias,
    confidence,
    action,
    tradeDate,
    dataSources: {
      weightedIndex: weighted ? { price: weighted["收盤指數"] || "", pct: weightedPct, source: weighted._source || "" } : null,
      otcIndex: otc ? { price: otc["收盤指數"] || "", pct: otcPct, source: otc._source || "" } : null,
      txfNear: futures ? { price: futures.price || "", pct: futuresPct, source: "TAIFEX MIS", basisLabel: futures.basisLabel || "" } : null,
      weightedIndexTrend,
      heatmapRows: 0,
      radarRows: 0,
      heatmapDisabled: true,
      realtimeRadarDisabled: true,
    },
  };
  const ok = Boolean(marketPayload.ok !== false && (weighted || otc || futures));
  return {
    ok,
    source: "market-ai-index-report",
    cacheSource: "api/market-ai-live",
    reportMode: "weighted-index-simple-report",
    displayOnly: true,
    publishAllowed: false,
    preservePreviousGood: true,
    fallbackUsed: false,
    fallbackAllowed: false,
    usesHeatmap: false,
    usesRealtimeRadar: false,
    updatedAt,
    market: marketPayload,
    weightedIndexTrend,
    heatmap: { disabled: true, reason: "user_disabled_heatmap_for_simple_report", stockCount: 0, sectorCount: 0 },
    realtimeRadar: { disabled: true, reason: "user_disabled_realtime_radar_for_simple_report", rows: [] },
    breadth: deps.breadth || null,
    rows,
    count: rows.length,
    hotStocks: rows.filter(isTaiwanStockObservationRow).slice(0, 10),
    groups,
    filters,
    todayPoints,
    riskNotes,
    priorityObservation: {
      title: "加權指數簡報",
      text: action,
      stock: null,
      staleBlocked: false,
    },
    sectorFocus: {
      title: "停用熱力圖",
      sectors: [],
    },
    reasoning,
    dashboard,
    dataFreshness: {
      today: clock.ymd,
      reportTradeDate: tradeDate,
      baseTradeDate: tradeDate,
      baseIsToday: tradeDate === clock.ymd,
      heatmapTradeDate: "",
      heatmapIsToday: false,
      heatmapUsable: false,
      heatmapDisabled: true,
      radarTradeDate: "",
      radarIsToday: false,
      realtimeRadarDisabled: true,
      staleSources: [],
      sourceIssues: [],
      reportWarnings: ok ? [] : [marketPayload.error || "market_index_source_unavailable"],
      heatmapQuoteCoverage: { status: "not_required", ok: true, reason: "simple_index_report_no_heatmap" },
      priorityStaleBlocked: false,
      preOpenMarketAi,
      detectionWindow: "09:00-13:30",
    },
    fieldCompleteness: {
      todayPoints: todayPoints.length >= 4,
      riskNotes: riskNotes.length >= 2,
      priorityObservation: true,
      sectorFocus: true,
      hotStocks: true,
      reasoning: reasoning.length >= 4,
      filters: filters.length === 5,
      simpleIndexReport: true,
      heatmapDisabled: true,
      realtimeRadarDisabled: true,
    },
    summary: {
      marketStatus: marketPayload.marketStatus || "",
      trading: marketPayload.trading === true,
      sample: dashboard.sample,
      up,
      down,
      bias,
      confidence,
      action,
      rows: rows.length,
      hotStocks: Math.min(3, rows.length),
      strategy2Count: 0,
      realtimeRadarCount: 0,
      reportMode: "weighted-index-simple-report",
      filterCounts: Object.fromEntries(Object.entries(groups).map(([key, group]) => [key, group.count])),
    },
    aiDetectWindow: {
      timezone: "Asia/Taipei",
      start: "09:00:00",
      end: "13:30:00",
      active: isMarketAiDetectWindow(clock),
      reason: "simple-index-report-only",
      taipeiDate: clock.date,
      taipeiTime: clock.time,
    },
    marketSession: {
      ...session,
      requiresTodayDetection: false,
      requiresTodayLiveSource: false,
      stale: false,
      reason: session?.reason || "simple-index-report",
    },
  };
}

async function enrichMarketAiPayload(payload, request, clock, session, deps = {}) {
  const mustDetectToday = session?.requiresTodayDetection === true;
  const marketClosedDisplay = session?.marketOpen === false || session?.marketCalendar?.marketOpen === false;
  const requireLiveHeatmap = marketClosedDisplay
    || session?.requiresTodayLiveSource === true
    || mustDetectToday
    || Boolean(isMarketAiDetectWindow(clock) && !session?.closed);
  const req = {
    ...request,
    method: "GET",
    query: heatmapQueryForMarketAi(request.query, requireLiveHeatmap),
  };
  const embeddedHeatmap = !requireLiveHeatmap && Array.isArray(payload?.heatmap?.sectors) ? payload.heatmap : null;
  const heatmapPayload = deps.heatmapPayload || embeddedHeatmap || await withTimeout(
    capture(heatmap, req).then((result) => result.payload || null),
    marketClosedDisplay ? 25000 : (requireLiveHeatmap ? HEATMAP_LIVE_TIMEOUT_MS : 1900),
    null
  );
  const radarPayload = deps.radarPayload || payload?.realtimeRadar || await withTimeout(
    capture(realtimeRadarLatest, req).then((result) => result.payload || null),
    1900,
    payload?.realtimeRadar || null
  );
  const insights = buildMarketAiInsights(payload, heatmapPayload || {}, radarPayload || {}, clock, session);
  const marketSession = reconcileMarketSessionWithFreshness(payload?.marketSession || session, insights.dataFreshness, clock);
  return {
    ...payload,
    ok: payload?.ok !== false,
    updatedAt: payload?.updatedAt || new Date().toISOString(),
    marketSession,
    heatmap: heatmapPayload ? {
      source: heatmapPayload.source || "",
      cacheSource: heatmapPayload.cacheSource || heatmapPayload.cache?.source || "",
      updatedAt: heatmapPayload.updatedAt || heatmapPayload.servedAt || "",
      resolvedTradeDate: heatmapPayload.resolvedTradeDate || heatmapPayload.tradeDate || "",
      stockCount: heatmapPayload.stockCount || heatmapPayload.health?.stockCount || 0,
      sectorCount: normalizeArray(heatmapPayload.sectors).length,
      quoteCoverage: buildHeatmapQuoteCoverage(heatmapPayload),
    } : null,
    realtimeRadar: radarPayload || payload?.realtimeRadar || null,
    rows: insights.rows,
    count: insights.count,
    hotStocks: insights.hotStocks,
    groups: insights.groups,
    filters: insights.filters,
    todayPoints: insights.todayPoints,
    riskNotes: insights.riskNotes,
    priorityObservation: insights.priorityObservation,
    sectorFocus: insights.sectorFocus,
    reasoning: insights.reasoning,
    dashboard: insights.dashboard,
    dataFreshness: insights.dataFreshness,
    fieldCompleteness: insights.fieldCompleteness,
    summary: {
      ...(payload?.summary || {}),
      sample: insights.dashboard.sample,
      up: insights.dashboard.up,
      down: insights.dashboard.down,
      bias: insights.dashboard.bias,
      confidence: insights.dashboard.confidence,
      action: insights.dashboard.action,
      rows: insights.count,
      hotStocks: insights.hotStocks.length,
      filterCounts: Object.fromEntries(Object.entries(insights.groups).map(([key, group]) => [key, group.count])),
    },
  };
}


function normalizeDisplayOnlyMarketAiEvidence(payload = {}) {
  const issueFilter = (issue) => !/source_status_at_run_status_display_only|run_quality_publishAllowed_false/i.test(String(issue || ""));
  const runQuality = {
    ...(payload.run_quality_at_publish || {}),
    status: "display_only",
    publishAllowed: false,
    degradedBlocksLatest: true,
    preservePreviousGood: true,
    qualityStatus: "display_only",
    reason: "display_only_report_not_publishable",
    blockedReason: "",
    scanner_block_reason: "",
  };
  const runTimeSourceSnapshot = payload.run_time_source_snapshot ? {
    ...payload.run_time_source_snapshot,
    run_quality_at_publish: {
      ...(payload.run_time_source_snapshot.run_quality_at_publish || {}),
      ...runQuality,
    },
  } : payload.run_time_source_snapshot;
  const camelSnapshot = payload.runTimeSourceSnapshot ? {
    ...payload.runTimeSourceSnapshot,
    run_quality_at_publish: {
      ...(payload.runTimeSourceSnapshot.run_quality_at_publish || {}),
      ...runQuality,
    },
  } : payload.runTimeSourceSnapshot;
  return {
    ...payload,
    displayOnly: true,
    displayAllowed: true,
    sourceEvidenceStatus: "display_only",
    evidenceStatus: "display_only",
    sourceEvidenceIssues: normalizeArray(payload.sourceEvidenceIssues).filter(issueFilter),
    issues: normalizeArray(payload.issues).filter(issueFilter),
    unattendedStatus: "DISPLAY_ONLY",
    unattended: {
      ...(payload.unattended || {}),
      status: "DISPLAY_ONLY",
      canRunUnattended: false,
      evidenceStatus: "display_only",
      reason: "display_only_report_not_publishable",
    },
    publishAllowed: false,
    degradedBlocksLatest: true,
    preservePreviousGood: true,
    mustPreserveLatest: true,
    blockedReason: "",
    scanner_block_reason: "",
    run_quality_at_publish: runQuality,
    run_time_source_snapshot: runTimeSourceSnapshot,
    runTimeSourceSnapshot: camelSnapshot,
  };
}

function secondsBetween(clock, startHour, startMinute, endHour, endMinute) {
  const start = startHour * 60 * 60 + startMinute * 60;
  const end = endHour * 60 * 60 + endMinute * 60 + 59;
  return Number(clock?.seconds || 0) >= start && Number(clock?.seconds || 0) <= end;
}

function safeReadJson(file) {
  try {
    if (!file || !fs.existsSync(file)) return null;
    return readJson(file);
  } catch {
    return null;
  }
}

function listOpeningIndustryBiasFiles(clock = taipeiClock()) {
  const stateDir = path.join(RUNTIME_ROOT, "state");
  if (!fs.existsSync(stateDir)) return [];
  return fs.readdirSync(stateDir)
    .filter((name) => /^opening_report_0830\.industry_bias\..*\.json$/.test(name))
    .map((name) => {
      const file = path.join(stateDir, name);
      const payload = safeReadJson(file);
      return { file, payload };
    })
    .filter((row) => compactDate(row.payload?.date) === clock.ymd && row.payload?.source === "opening_report_0830");
}

function namesByTier(payload, tier) {
  return normalizeArray(payload?.mapped_symbols)
    .filter((row) => String(row?.tier || "").toUpperCase() === tier)
    .map((row) => ({ symbol: String(row?.symbol || ""), name: String(row?.name || row?.symbol || "") }))
    .filter((row) => row.symbol || row.name);
}

function openingBiasScore(payload = {}) {
  const avg = Number(payload?.overseas_leader_detection?.average_percent ?? payload?.overseas_average_percent ?? payload?.overseas_return_1d_pct);
  const avg2d = Number(payload?.overseas_return_2d_pct ?? payload?.overseas_leader_detection?.average_return_2d_pct);
  if (Number.isFinite(avg)) return 100000 + avg * 1000 + (Number.isFinite(avg2d) ? avg2d : -99) * 10 + Number(payload.confidence || 0);
  const bias = String(payload.bias || "").toLowerCase();
  const directionScore = bias.includes("positive") ? 3 : bias.includes("neutral") ? 2 : bias.includes("negative") ? 1 : 0;
  const confidence = Number(payload.confidence || 0);
  return directionScore * 10000 + confidence * 10;
}

function normalizeOpeningSymbolRows(rows) {
  return normalizeArray(rows)
    .map((stock) => typeof stock === "string"
      ? { symbol: "", name: stock }
      : { symbol: String(stock?.symbol || ""), name: String(stock?.name || stock?.symbol || "") })
    .filter((stock) => stock.symbol || stock.name);
}

function readOpeningShortwave(clock = taipeiClock()) {
  const dir = path.join(RUNTIME_ROOT, "data", "line-cards");
  const allowed = new Set(["strategy3", "strategy4", "strategy5"]);
  if (!fs.existsSync(dir)) return { status: "source_gap", reason_code: "shortwave_line_card_dir_missing", rows: [], allowed_sources: [...allowed] };
  const rows = fs.readdirSync(dir)
    .filter((name) => /^strategy[345]-line-card-\d{8}(?:\.dry-run)?\.json$/.test(name))
    .map((name) => {
      const source = name.match(/^(strategy[345])-/)?.[1] || "";
      const file = path.join(dir, name);
      const payload = safeReadJson(file);
      const date = compactDate(payload?.date || payload?.tradeDate || payload?.scanDate || name);
      return { source, file, payload, date, mtime: fs.statSync(file).mtimeMs };
    })
    .filter((row) => allowed.has(row.source) && row.date && row.date < clock.ymd)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 3);
  return {
    status: rows.length ? "previous_closed_run_only" : "source_gap",
    reason_code: rows.length ? "shortwave_previous_closed_run_only" : "shortwave_no_closed_run",
    allowed_sources: [...allowed],
    rows: rows.map((row) => ({ source: row.source, date: row.date, file: row.file, run_id: row.payload?.run_id || row.payload?.runId || "", count: count(row.payload) })),
  };
}

function readOpeningMorningReport(clock = taipeiClock()) {
  const compact = clock.ymd;
  const date = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  const reportDir = path.join(RUNTIME_ROOT, "data", "opening-report-0830");
  const finalReceiptPath = path.join(reportDir, `opening-report-0830-final-receipt-${compact}.json`);
  const overseasLeadersPath = path.join(reportDir, `overseas-leaders-0830-${compact}.json`);
  const lineReceiptPath = path.join(reportDir, `line-push-receipt-${compact}.json`);
  const finalReceipt = safeReadJson(finalReceiptPath);
  const overseasLeaders = safeReadJson(overseasLeadersPath);
  const lineReceipt = safeReadJson(lineReceiptPath);
  const visibleWindow = {
    timezone: "Asia/Taipei",
    start: "08:30:00",
    end: "08:59:59",
    active: secondsBetween(clock, 8, 30, 8, 59),
    label: "08:30-08:59",
  };
  if (!finalReceipt) {
    return {
      contract: "opening-report-0830-terminal-briefing-v1",
      ok: false,
      visible_window: visibleWindow,
      display_label: "今日推薦",
      date,
      reason_code: "opening_report_0830_final_receipt_missing",
      final_receipt_path: finalReceiptPath,
    };
  }
  const finalDateOk = compactDate(finalReceipt.date) === compact;
  const industryRows = listOpeningIndustryBiasFiles(clock)
    .map((row) => ({
      industry: row.payload.industry,
      display_name: row.payload.display_name || row.payload.industry,
      bias: row.payload.bias || "",
      confidence: Number(row.payload.confidence || 0),
      evidence_summary: row.payload.evidence_summary || "",
      overseas_leader_detection: row.payload.overseas_leader_detection || {},
      a_symbols: namesByTier(row.payload, "A"),
      b_symbols: namesByTier(row.payload, "B"),
      allowed_action: row.payload.allowed_action || "",
      forbidden_action: row.payload.forbidden_action || "",
      file: row.file,
      score: openingBiasScore(row.payload),
    }))
    .sort((a, b) => b.score - a.score);
  const marketItems = normalizeArray(finalReceipt?.overseas_market_snapshot?.items).map((row) => ({
    key: row.key || "",
    label: row.label || row.key || "",
    percent: Number(row.percent),
    display: row.display || "",
    direction: row.direction || "",
    source_time: row.source_time || "",
    reason_code: row.reason_code || "",
  }));
  const topPriority = industryRows.slice(0, 3);
  const recommended = topPriority.flatMap((row) => row.a_symbols.map((stock) => ({ ...stock, industry: row.display_name, bias: row.bias })));
  const bridgeStatus = finalReceipt.mother_pool_bridge_attempted
    ? (finalReceipt.mother_pool_bridge_ok ? "applied" : "fail_closed_optional")
    : "priority_scan_only";
  const issues = [];
  if (!finalDateOk) issues.push("final_receipt_date_mismatch");
  if (industryRows.length < 19) issues.push("industry_bias_json_incomplete");
  if (finalReceipt.line_required === true && finalReceipt.line_delivery_ok !== true) issues.push("line_delivery_not_ok");
  return {
    contract: "opening-report-0830-terminal-briefing-v1",
    ok: issues.length === 0,
    visible_window: visibleWindow,
    display_label: "今日推薦",
    date,
    run_id: finalReceipt.run_id || "",
    report_status: finalReceipt.report_status || "",
    watchlist_only: finalReceipt.watchlist_only !== false,
    formal_candidates: Number(finalReceipt.formal_candidates || 0),
    allowed_action: "priority_scan_only",
    forbidden_action: "publish_formal_candidate_without_taiwan_evidence",
    bridge_status: bridgeStatus,
    line: {
      required: finalReceipt.line_required === true,
      ok: finalReceipt.line_delivery_ok === true || lineReceipt?.line_push_ok === true,
      receipt_path: lineReceiptPath,
      target_count: lineReceipt?.target_count || 0,
    },
    market_snapshot: {
      ok: finalReceipt.overseas_sources_ok === true,
      checked_at: finalReceipt?.overseas_market_snapshot?.checked_at || "",
      cutoff: finalReceipt?.overseas_market_snapshot?.cutoff || "",
      items: marketItems,
    },
    institutional: finalReceipt.institutional || { status: "source_gap", reason_code: "institutional_not_written_by_0830_runner" },
    shortwave: finalReceipt.shortwave || readOpeningShortwave(clock),
    event_digest: finalReceipt.event_digest || { status: "source_gap", reason_code: "event_digest_not_written_by_0830_runner" },
    priority_industries: topPriority,
    recommended_symbols: recommended.slice(0, 24),
    industry_bias: {
      status: industryRows.length >= 19 ? "ok" : "incomplete",
      count: industryRows.length,
      required: 19,
    },
    paths: {
      final_receipt: finalReceiptPath,
      overseas_leaders: overseasLeadersPath,
      report: finalReceipt.report_path || path.join(reportDir, `opening-report-0830-${compact}.md`),
    },
    overseas_leaders: overseasLeaders ? {
      ok: overseasLeaders.ok === true,
      total_leaders: overseasLeaders.total_leaders || 0,
      valid_leaders: overseasLeaders.valid_leaders || 0,
      unavailable_leaders: overseasLeaders.unavailable_leaders || 0,
    } : null,
    issues,
    reason_code: issues[0] || "opening_report_0830_terminal_briefing_ok",
  };
}

async function readOpeningMorningReportSnapshot(clock = taipeiClock()) {
  const snapshot = await readSnapshot("opening_report_0830_terminal_briefing", {
    tradeDate: clock.date,
    allowLatestFallback: false,
    timeoutMs: Number(process.env.FUMAN_OPENING_REPORT_0830_SNAPSHOT_TIMEOUT_MS || 2000),
  }).catch(() => null);
  const payload = snapshot?.payload;
  if (!payload || payload.contract !== "opening-report-0830-terminal-briefing-v1") return null;
  if (compactDate(payload.date) !== clock.ymd) return null;
  return {
    ...payload,
    cacheSource: "supabase:market_snapshots",
    snapshot_updated_at: snapshot.updatedAt || "",
  };
}
function withMarketAiRunTimeSourceSnapshot(payload, clock = taipeiClock(), session = {}) {
  const freshness = payload?.dataFreshness || {};
  const dataSources = payload?.dashboard?.dataSources || {};
  const displayOnlyReport = payload?.displayOnly === true || payload?.reportMode === "weighted-index-simple-report";
  const sourceIssues = displayOnlyReport ? [] : (Array.isArray(freshness.sourceIssues) ? freshness.sourceIssues.filter(Boolean) : []);
  const staleSources = Array.isArray(freshness.staleSources) ? freshness.staleSources.filter(Boolean) : [];
  const heatmapRows = cleanNumber(dataSources.heatmapRows || payload?.heatmap?.stockCount || payload?.heatmap?.sectorCount);
  const radarRows = cleanNumber(dataSources.radarRows || count(payload?.realtimeRadar));
  const heatmapQuoteCoverage = freshness.heatmapQuoteCoverage || payload?.heatmap?.quoteCoverage || {};
  const quoteReady = displayOnlyReport
    || freshness.heatmapUsable === true
    || freshness.radarIsToday === true
    || heatmapRows >= 500
    || radarRows > 0;
  const quoteFreshnessRequired = displayOnlyReport ? false : (session?.requiresTodayLiveSource === true
    || Boolean(isMarketAiDetectWindow(clock) && !session?.closed));
  const quoteFreshnessReason = quoteFreshnessRequired
    ? ""
    : (session?.marketOpen === false || session?.marketCalendar?.marketOpen === false ? "market_closed_quote_age_not_required" : "post_close_quote_age_not_required");
  const sourceStatus = displayOnlyReport ? "display_only" : (sourceIssues.length ? "degraded" : "ready");
  const evidencedPayload = attachRunTimeSourceEvidence({
    ...payload,
    issues: retainedNonSourceEvidenceIssues(payload?.issues),
    fallbackUsed: false,
    fallbackScope: [],
    fallbackAllowed: false,
    fallbackDetails: [],
    ...buildRunTimeSourceSnapshotFields({
      strategy: displayOnlyReport ? "market-ai-index-report" : "market-ai",
      runId: `${displayOnlyReport ? "market-ai-index-report" : "market-ai-live"}-${String(clock?.date || "").replace(/\D/g, "") || Date.now()}`,
      payload,
      sourceStatus: {
        status: sourceStatus,
        ok: true,
        reason: sourceIssues[0] || "",
        staleSources,
        marketSession: session?.status || payload?.marketSession?.status || "",
      },
      quoteCoverage: {
        status: quoteFreshnessRequired ? (heatmapQuoteCoverage.status || (quoteReady ? "ready" : "degraded")) : "not_required",
        ok: quoteFreshnessRequired ? (heatmapQuoteCoverage.ok ?? quoteReady) : true,
        reason: quoteFreshnessReason,
        required: quoteFreshnessRequired,
        notRequired: !quoteFreshnessRequired,
        fresh_quote_coverage_120s: heatmapQuoteCoverage.fresh_quote_coverage_120s ?? heatmapQuoteCoverage.freshQuoteCoverage120s ?? null,
        freshQuoteCoverage120s: heatmapQuoteCoverage.freshQuoteCoverage120s ?? heatmapQuoteCoverage.fresh_quote_coverage_120s ?? null,
        fresh_quotes: heatmapQuoteCoverage.fresh_quotes ?? heatmapQuoteCoverage.freshQuotes ?? null,
        freshQuotes: heatmapQuoteCoverage.freshQuotes ?? heatmapQuoteCoverage.fresh_quotes ?? null,
        active_symbols: heatmapQuoteCoverage.active_symbols ?? heatmapQuoteCoverage.activeSymbols ?? null,
        activeSymbols: heatmapQuoteCoverage.activeSymbols ?? heatmapQuoteCoverage.active_symbols ?? null,
        quote_age_seconds: heatmapQuoteCoverage.quote_age_seconds ?? heatmapQuoteCoverage.quoteAgeSeconds ?? null,
        quoteAgeSeconds: heatmapQuoteCoverage.quoteAgeSeconds ?? heatmapQuoteCoverage.quote_age_seconds ?? null,
        latest_updated_at: heatmapQuoteCoverage.latest_updated_at || heatmapQuoteCoverage.latestUpdatedAt || "",
        latestUpdatedAt: heatmapQuoteCoverage.latestUpdatedAt || heatmapQuoteCoverage.latest_updated_at || "",
        heatmapRows,
        radarRows,
        heatmapTradeDate: freshness.heatmapTradeDate || "",
        radarTradeDate: freshness.radarTradeDate || "",
        baseTradeDate: freshness.baseTradeDate || "",
        sourceIssues,
      },
      intraday1mReadiness: { status: "not_applicable", ok: true, reason: displayOnlyReport ? "simple index report does not consume intraday 1m" : "market-ai consumes heatmap/radar surfaces, not raw intraday 1m" },
      maReadiness: { status: "not_applicable", ok: true, reason: "market-ai does not calculate MA readiness" },
      preopenFutoptDailyReadiness: { status: "not_applicable", ok: true, reason: "market-ai does not require preopen/futopt/daily volume directly" },
      publishAllowed: !displayOnlyReport,
      degradedBlocksLatest: displayOnlyReport,
      preservePreviousGood: displayOnlyReport,
      qualityStatus: displayOnlyReport ? "display_only" : (sourceIssues.length ? "degraded_exposed" : "ready"),
      fallbackUsed: false,
      fallbackScope: [],
      fallbackAllowed: false,
      fallbackDetails: [],
      expectedTotal: heatmapRows || radarRows || null,
      scannedCount: heatmapRows || radarRows || null,
      resultCount: count(payload),
      readbackCount: count(payload),
      retentionOk: true,
      writeBudget: displayOnlyReport
        ? { status: "display-only", allowed: false, reason: "simple index report must not publish latest" }
        : { status: "live-api", allowed: true, reason: "market-ai is an on-demand live surface" },
    }),
  });
  const withOpeningMorningReport = {
    ...evidencedPayload,
    openingMorningReport: session?.openingMorningReport || readOpeningMorningReport(clock),
  };
  return displayOnlyReport ? normalizeDisplayOnlyMarketAiEvidence(withOpeningMorningReport) : withOpeningMorningReport;
}

module.exports = async function handler(request, response) {
  const marketCalendar = await buildMarketCalendarContract().catch(() => null);
  installMarketCalendarResponse(response, marketCalendar);
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");

  if (request.method !== "GET" && request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const clock = taipeiClock();
  const detectWindowActive = isMarketAiDetectWindow(clock);
  const cached = readCachedPayload();
  const breadth = readCachedBreadth();
  const marketSummary = readCachedMarketSummary();
  const stocksSlim = readCachedStocksSlim();
  const rawSession = marketSessionState(clock, breadth, marketSummary, stocksSlim, cached);
  const session = applyMarketCalendarToSession(rawSession, marketCalendar);
  const requireTodayLiveSource = marketCalendar?.marketOpen === false ? false : requiresTodayLiveSource(clock, session);
  const mustDetectToday = marketCalendar?.marketOpen === false ? false : requiresTodayDetection(clock, session);
  const openingMorningReportSnapshot = await readOpeningMorningReportSnapshot(clock);
  const sessionForPayload = { ...session, requiresTodayDetection: mustDetectToday, requiresTodayLiveSource: requireTodayLiveSource, openingMorningReport: openingMorningReportSnapshot };

  if (usesSimpleMarketAiReport(request)) {
    const simplePayload = await buildSimpleMarketAiReport(request, clock, {
      ...sessionForPayload,
      requiresTodayDetection: false,
      requiresTodayLiveSource: false,
    }, { breadth, marketSummary, cached });
    response.status(200).json(withMarketAiRunTimeSourceSnapshot(simplePayload, clock, simplePayload.marketSession));
    return;
  }

  const fastCachedPayload = wantsFastCachedPayload(request) && !shouldRefresh(request) && !request.query?.t;

  if (cached && isWeekendClosedSession(session) && !shouldRefresh(request)) {
    const payload = normalizeNonTradingCachePayload(
      cachedResponsePayload(cached, breadth, clock, "non-trading-day-cache"),
      sessionForPayload
    );
    response.status(200).json(withMarketAiRunTimeSourceSnapshot(
      await enrichMarketAiPayload(payload, request, clock, sessionForPayload),
      clock,
      sessionForPayload
    ));
    return;
  }

  if (cached && fastCachedPayload && !requireTodayLiveSource) {
    const closedForDisplay = isMarketAiPostClose(clock) || sessionForPayload.marketOpen === false || sessionForPayload.marketCalendar?.marketOpen === false;
    const basePayload = cachedResponsePayload(cached, breadth, clock, closedForDisplay ? "after-1330-cache" : "fast-shell-cache");
    const payload = closedForDisplay
      ? normalizeNonTradingCachePayload(basePayload, sessionForPayload)
      : { ...basePayload, marketSession: sessionForPayload };
    response.status(200).json(withMarketAiRunTimeSourceSnapshot(
      await enrichMarketAiPayload(payload, request, clock, sessionForPayload, {
        heatmapPayload: payload?.heatmap || null,
        radarPayload: payload?.realtimeRadar || null,
      }),
      clock,
      sessionForPayload
    ));
    return;
  }
  const snapshot = null;
  // old_supabase_market_snapshots_fallback_disabled_by_daytrade_mother_pool_skeleton_v1

  const cachedTradeDate = payloadTradeDate(cached);
  const cachedAllowed = !isMarketAiPostClose(clock) || isTodayDate(cachedTradeDate, clock);
  if (cached && cachedAllowed && !isMarketAiPostClose(clock) && canServeCachedPayload(request, detectWindowActive, mustDetectToday)) {
    const payload = {
      ...cachedResponsePayload(
        cached,
        breadth,
        clock,
        detectWindowActive ? "normal-cache" : "after-1330-cache"
      ),
      marketSession: sessionForPayload,
    };
    response.status(200).json(withMarketAiRunTimeSourceSnapshot(
      await enrichMarketAiPayload(payload, request, clock, sessionForPayload),
      clock,
      sessionForPayload
    ));
    return;
  }

  const req = { ...request, method: "GET", query: request.query || {} };
  const marketClosedDisplay = sessionForPayload.marketOpen === false || sessionForPayload.marketCalendar?.marketOpen === false;
  const requireLiveHeatmap = marketClosedDisplay || requireTodayLiveSource || mustDetectToday || Boolean(detectWindowActive && !session.closed);
  const heatmapQuery = heatmapQueryForMarketAi(request.query, requireLiveHeatmap);
  const [marketResult, strategy2Result, radarResult, heatmapResult] = await Promise.all([
    capture(market, req),
    capture(latestStrategy, { ...req, query: { key: "strategy2" } }),
    capture(realtimeRadarLatest, req),
    capture(heatmap, { ...req, query: heatmapQuery }),
  ]);
  const strategy2 = strategy2Result.payload || {};
  const realtimeRadar = radarResult.payload || {};
  const marketPayload = marketResult.payload || {};
  const heatmapPayload = heatmapResult.payload || {};
  const payload = {
    ok: Boolean(marketPayload.ok || strategy2.ok !== false || realtimeRadar.ok !== false),
    source: "live-api-bundle",
    cacheSource: "api/market-ai-live",
    updatedAt: new Date().toISOString(),
    market: marketPayload,
    breadth: breadth || null,
    strategy2,
    realtimeRadar,
    summary: {
      marketStatus: marketPayload.marketStatus || "",
      trading: marketPayload.trading === true,
      strategy2Count: count(strategy2),
      realtimeRadarCount: count(realtimeRadar),
      strategy2Source: strategy2.cacheSource || strategy2.transport?.source || "",
      realtimeRadarSource: realtimeRadar.cacheSource || realtimeRadar.transport?.source || "",
    },
    aiDetectWindow: {
      timezone: "Asia/Taipei",
      start: "09:00:00",
      end: "13:30:00",
      active: detectWindowActive,
      reason: mustDetectToday ? "live-detect-required" : detectWindowActive ? "live-detect-window" : "cache-missing-fallback",
      taipeiDate: clock.date,
      taipeiTime: clock.time,
    },
    marketSession: sessionForPayload,
  };
  const enrichedPayload = withMarketAiRunTimeSourceSnapshot(
    await enrichMarketAiPayload(payload, request, clock, sessionForPayload, { heatmapPayload, radarPayload: realtimeRadar }),
    clock,
    sessionForPayload
  );

  for (const file of cacheCandidates()) {
    try { writeJsonAtomic(file, enrichedPayload); } catch {}
  }

  response.status(200).json(enrichedPayload);
};

module.exports.__test = {
  buildMarketAiInsights,
  normalizeStockRow,
  scoreRow,
  taipeiClock,
  marketSessionState,
  reconcileMarketSessionWithFreshness,
  requiresTodayLiveSource,
  requiresTodayDetection,
  canServeCachedPayload,
  heatmapQueryForMarketAi,
  isMarketAiPreOpenWindow,
  readOpeningMorningReport,
  readOpeningMorningReportSnapshot,
};







