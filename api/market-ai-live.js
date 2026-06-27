const fs = require("fs");
const path = require("path");

const latestStrategy = require("./latest-strategy");
const realtimeRadarLatest = require("./realtime-radar-latest");
const market = require("./market");
const { readSnapshot } = require("../lib/supabase-snapshots");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_ROOT = process.env.FUMAN_RUNTIME_DIR || process.env.FUMAN_RUNTIME_ROOT || "C:\\fuman-runtime";
const CACHE_FILE = "market-ai-live.json";
const BREADTH_FILE = "market-ai-breadth-latest.json";
const MARKET_SUMMARY_FILE = "market-summary.json";
const STOCKS_SLIM_FILE = "stocks-slim.json";
const AI_WINDOW_START_SECONDS = 9 * 60 * 60;
const AI_WINDOW_END_SECONDS = 13 * 60 * 60 + 30 * 60;
const SNAPSHOT_TIMEOUT_MS = Number(process.env.FUMAN_MARKET_AI_SNAPSHOT_TIMEOUT_MS || 1500);

function cacheCandidates(file = CACHE_FILE) {
  return [
    path.join(RUNTIME_ROOT, "data", file),
    path.join(ROOT, "data", file),
  ];
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
  const closed = isWeekend(clock) || !hasTodayMarketData;
  return {
    taipeiDate: clock.date,
    today: clock.ymd,
    marketDataDate,
    hasTodayMarketData,
    closed,
    reason: isWeekend(clock) ? "weekend" : hasTodayMarketData ? "today-market-data" : "no-today-market-data",
  };
}

function cachedResponsePayload(cached, breadth, clock, reason = "cache") {
  return {
    ...cached,
    breadth: hasBreadthPayload(cached.breadth) ? cached.breadth : breadth || null,
    cacheSource: cached.cacheSource || "data/market-ai-live.json",
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

  if (cached && session.closed && !shouldRefresh(request)) {
    response.status(200).json(normalizeNonTradingCachePayload(
      cachedResponsePayload(cached, breadth, clock, "non-trading-day-cache"),
      session
    ));
    return;
  }

  const snapshot = await readSnapshot("market_ai_live", {
    tradeDate: clock.date,
    allowLatestFallback: true,
    timeoutMs: SNAPSHOT_TIMEOUT_MS,
  });

  if (snapshot?.payload) {
    response.status(200).json({
      ...snapshotResponsePayload(snapshot, breadth, clock),
      marketSession: session,
    });
    return;
  }

  if (cached && (!shouldRefresh(request) || !detectWindowActive)) {
    response.status(200).json({
      ...cachedResponsePayload(
        cached,
        breadth,
        clock,
        detectWindowActive ? "normal-cache" : "after-1330-cache"
      ),
      marketSession: session,
    });
    return;
  }

  const req = { ...request, method: "GET", query: request.query || {} };
  const [marketResult, strategy2Result, radarResult] = await Promise.all([
    capture(market, req),
    capture(latestStrategy, { ...req, query: { key: "strategy2" } }),
    capture(realtimeRadarLatest, req),
  ]);
  const strategy2 = strategy2Result.payload || {};
  const realtimeRadar = radarResult.payload || {};
  const marketPayload = marketResult.payload || {};
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
      reason: detectWindowActive ? "live-detect-window" : "cache-missing-fallback",
      taipeiDate: clock.date,
      taipeiTime: clock.time,
    },
    marketSession: session,
  };

  for (const file of cacheCandidates()) {
    try { writeJsonAtomic(file, payload); } catch {}
  }

  response.status(200).json(payload);
};



