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

function isMarketAiTodayRequiredWindow(clock = taipeiClock()) {
  return clock.seconds >= AI_TODAY_REQUIRED_START_SECONDS;
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
  const closed = isWeekend(clock);
  return {
    taipeiDate: clock.date,
    today: clock.ymd,
    marketDataDate,
    hasTodayMarketData,
    closed,
    stale: !hasTodayMarketData,
    reason: isWeekend(clock) ? "weekend" : hasTodayMarketData ? "today-market-data" : "awaiting-today-market-data",
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
  if (base.closed) return base;
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

function snapshotResponsePayload(snapshot, breadth, clock) {
  const payload = snapshot.payload || {};
  return cachedResponsePayload(
    {
      ...payload,
      cacheSource: "supabase:market_snapshots",
      snapshot: {
        key: snapshot.key,
        tradeDate: snapshot.tradeDate,
        snapshotId: snapshot.snapshotId,
        locked: snapshot.locked,
        source: snapshot.source,
        updatedAt: snapshot.updatedAt,
        finalizedAt: snapshot.finalizedAt,
      },
    },
    breadth,
    clock,
    snapshot.reason || (snapshot.locked ? "after-1330-cache" : "supabase-snapshot")
  );
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

function heatmapSourceIssue(payload, heatmapIsToday) {
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
  const heatmapIssue = heatmapSourceIssue(heatmapPayload, heatmapIsToday);
  const heatmapUsable = heatmapIsToday && !heatmapIssue;
  const heatmapQuoteCoverage = buildHeatmapQuoteCoverage(heatmapPayload || {});
  const sourceIssues = [
    heatmapIssue,
    radarTradeDate && !radarIsToday ? `即時雷達非今日資料：${radarTradeDate}` : "",
    baseTradeDate && !baseIsToday ? `AI cache 非今日資料：${baseTradeDate}` : "",
  ].filter(Boolean);
  const staleSources = [
    heatmapTradeDate && !heatmapIsToday ? `熱力圖 ${heatmapTradeDate}` : "",
    radarTradeDate && !radarIsToday ? `即時雷達 ${radarTradeDate}` : "",
    baseTradeDate && !baseIsToday ? `AI cache ${baseTradeDate}` : "",
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

  const normalizedRadar = radarRows.map((row) => normalizeStockRow(row, "即時雷達", [firstText(row, ["side", "direction"], "多")])).filter(Boolean);
  const normalizedBase = baseRows.map((row) => normalizeStockRow(row, "AI 判讀", ["AI 判讀"])).filter(Boolean);
  const normalizedHeatmap = sectorStocks
    .sort((a, b) => cleanNumber(b.value ?? b.tradeValue ?? b.amountYi) - cleanNumber(a.value ?? a.tradeValue ?? a.amountYi))
    .slice(0, 120)
    .map((row) => normalizeStockRow(row, "熱力圖", [cleanNumber(row.pct) >= 0 ? "動能強" : "風險高"]))
    .filter(Boolean);

  const allRows = mergeStockRows(normalizedBase, normalizedRadar, normalizedHeatmap).slice(0, 60);
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
  const strongNames = strongSectors.map((sector) => sector.name || sector.industry).filter(Boolean).slice(0, 3);
  const weakNames = weakSectors.map((sector) => sector.name || sector.industry).filter(Boolean).slice(0, 3);
  const topStock = allGroupRows[0] || null;
  const hasDirectionalBreadth = up + down > 0;
  const confidence = !hasDirectionalBreadth ? "觀察" : Math.abs(up - down) >= Math.max(sample * 0.08, 60) ? "高" : Math.abs(up - down) >= Math.max(sample * 0.03, 25) ? "中" : "觀察";
  const bias = hasDirectionalBreadth ? (up >= down ? "多方壓制" : "空方壓制") : "等待方向";
  const action = hasDirectionalBreadth ? (up >= down ? "降低追價" : "等待方向") : "等待方向";
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
      : "等待即時雷達與熱力圖資料。",
    stock: null,
    staleBlocked: priorityStaleBlocked,
  };

  const groups = {
    all: groupPayload("全部", "AI merge: heatmap + realtime radar + market-ai", allGroupRows, "綜合分數排序"),
    momentum: groupPayload("動能強", "heatmap pct + realtime radar", momentumRows, "優先看漲幅與成交額延續"),
    institution: groupPayload("法人買超", "radar/chip tags", institutionRows, "只列有法人、外資、投信或籌碼文字的標的"),
    intraday: groupPayload("當沖熱", "realtime radar", intradayRows, "只列即時雷達多方訊號"),
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
    hasDirectionalBreadth
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
    { key: "radar", title: `${normalizedRadar.length.toLocaleString("zh-TW")} 檔即時雷達`, text: "只採 API-only 最新資料，不讀舊 DOM snapshot。" },
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

async function enrichMarketAiPayload(payload, request, clock, session, deps = {}) {
  const mustDetectToday = session?.requiresTodayDetection === true;
  const requireLiveHeatmap = session?.requiresTodayLiveSource === true
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
    requireLiveHeatmap ? HEATMAP_LIVE_TIMEOUT_MS : 1900,
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

function withMarketAiRunTimeSourceSnapshot(payload, clock = taipeiClock(), session = {}) {
  const freshness = payload?.dataFreshness || {};
  const dataSources = payload?.dashboard?.dataSources || {};
  const sourceIssues = Array.isArray(freshness.sourceIssues) ? freshness.sourceIssues.filter(Boolean) : [];
  const staleSources = Array.isArray(freshness.staleSources) ? freshness.staleSources.filter(Boolean) : [];
  const heatmapRows = cleanNumber(dataSources.heatmapRows || payload?.heatmap?.stockCount || payload?.heatmap?.sectorCount);
  const radarRows = cleanNumber(dataSources.radarRows || count(payload?.realtimeRadar));
  const heatmapQuoteCoverage = freshness.heatmapQuoteCoverage || payload?.heatmap?.quoteCoverage || {};
  const quoteReady = freshness.heatmapUsable === true
    || freshness.radarIsToday === true
    || heatmapRows >= 500
    || radarRows > 0;
  const sourceStatus = sourceIssues.length ? "degraded" : "ready";
  return attachRunTimeSourceEvidence({
    ...payload,
    fallbackUsed: false,
    fallbackScope: [],
    fallbackAllowed: false,
    fallbackDetails: [],
    ...buildRunTimeSourceSnapshotFields({
      strategy: "market-ai",
      runId: `market-ai-live-${String(clock?.date || "").replace(/\D/g, "") || Date.now()}`,
      payload,
      sourceStatus: {
        status: sourceStatus,
        ok: true,
        reason: sourceIssues[0] || "",
        staleSources,
        marketSession: session?.status || payload?.marketSession?.status || "",
      },
      quoteCoverage: {
        status: heatmapQuoteCoverage.status || (quoteReady ? "ready" : "degraded"),
        ok: heatmapQuoteCoverage.ok ?? quoteReady,
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
      intraday1mReadiness: { status: "not_applicable", ok: true, reason: "market-ai consumes heatmap/radar surfaces, not raw intraday 1m" },
      maReadiness: { status: "not_applicable", ok: true, reason: "market-ai does not calculate MA readiness" },
      preopenFutoptDailyReadiness: { status: "not_applicable", ok: true, reason: "market-ai does not require preopen/futopt/daily volume directly" },
      publishAllowed: true,
      degradedBlocksLatest: false,
      preservePreviousGood: false,
      qualityStatus: sourceIssues.length ? "degraded_exposed" : "ready",
      fallbackUsed: false,
      fallbackScope: [],
      fallbackAllowed: false,
      fallbackDetails: [],
      expectedTotal: heatmapRows || radarRows || null,
      scannedCount: heatmapRows || radarRows || null,
      resultCount: count(payload),
      readbackCount: count(payload),
      retentionOk: true,
      writeBudget: { status: "live-api", allowed: true, reason: "market-ai is an on-demand live surface" },
    }),
  });
}

module.exports = async function handler(request, response) {
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
  const session = marketSessionState(clock, breadth, marketSummary, stocksSlim, cached);
  const requireTodayLiveSource = requiresTodayLiveSource(clock, session);
  const mustDetectToday = requiresTodayDetection(clock, session);
  const sessionForPayload = { ...session, requiresTodayDetection: mustDetectToday, requiresTodayLiveSource: requireTodayLiveSource };

  if (cached && session.closed && !shouldRefresh(request)) {
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

  const snapshot = await readSnapshot("market_ai_live", {
    tradeDate: clock.date,
    allowLatestFallback: !requireTodayLiveSource,
    timeoutMs: SNAPSHOT_TIMEOUT_MS,
  });

  if (snapshot?.payload && !mustDetectToday) {
    const payload = {
      ...snapshotResponsePayload(snapshot, breadth, clock),
      marketSession: sessionForPayload,
    };
    response.status(200).json(withMarketAiRunTimeSourceSnapshot(
      await enrichMarketAiPayload(payload, request, clock, sessionForPayload),
      clock,
      sessionForPayload
    ));
    return;
  }

  if (cached && canServeCachedPayload(request, detectWindowActive, mustDetectToday)) {
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
  const requireLiveHeatmap = requireTodayLiveSource || mustDetectToday || Boolean(detectWindowActive && !session.closed);
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
};



