const fs = require("fs");
const path = require("path");

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || "https://cpmpfhbzutkiecccekfr.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-anon-key.txt"));

const LATEST_RUN_VIEW = process.env.STRATEGY2_SUPABASE_LATEST_RUN_VIEW || "v_strategy2_latest_complete_run";
const RUNS_TABLE = process.env.STRATEGY2_SUPABASE_RUNS_TABLE || "strategy2_scan_runs";
const AUTHORITATIVE_GATE = "complete-run-authoritative";
const MARKET_SUMMARY_FILE = "market-summary.json";
const STOCKS_SLIM_FILE = "stocks-slim.json";


function cacheCandidates(file) {
  return [
    path.join(RUNTIME_DIR, "data", file),
    path.join(ROOT, "data", file),
  ];
}

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function readLatestCachedFile(file) {
  const rows = cacheCandidates(file)
    .filter((candidate) => fs.existsSync(candidate))
    .map((candidate) => {
      const payload = readJsonFile(candidate);
      const mtime = fs.statSync(candidate).mtimeMs;
      return { payload, mtime };
    })
    .filter((row) => row.payload)
    .sort((a, b) => b.mtime - a.mtime);
  return rows[0]?.payload || null;
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
  return {
    date: parts.year + "-" + parts.month + "-" + parts.day,
    ymd: parts.year + parts.month + parts.day,
    weekday: String(parts.weekday || ""),
  };
}

function compactDate(value) {
  const text = String(value || "");
  if (!text) return "";
  if (/^\d{8}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.replace(/\D/g, "");
  return text.replace(/\D/g, "").slice(0, 8);
}

function isoDate(compact) {
  const text = compactDate(compact);
  return text.length === 8 ? text.slice(0, 4) + "-" + text.slice(4, 6) + "-" + text.slice(6, 8) : "";
}

function newestMarketDataDate(marketSummary, stocksSlim) {
  return [
    marketSummary?.resolvedTradeDate,
    marketSummary?.tradeDate,
    marketSummary?.marketDates?.twse,
    marketSummary?.marketDates?.tpex,
    stocksSlim?.resolvedTradeDate,
    stocksSlim?.tradeDate,
    stocksSlim?.marketDates?.twse,
    stocksSlim?.marketDates?.tpex,
  ].map(compactDate).filter(Boolean).sort().at(-1) || "";
}

function isWeekend(clock) {
  const weekday = String(clock?.weekday || "").toLowerCase();
  return weekday.startsWith("sat") || weekday.startsWith("sun");
}

function marketSessionState(clock = taipeiClock()) {
  const marketSummary = readLatestCachedFile(MARKET_SUMMARY_FILE);
  const stocksSlim = readLatestCachedFile(STOCKS_SLIM_FILE);
  const marketDataDate = newestMarketDataDate(marketSummary, stocksSlim);
  const hasTodayMarketData = Boolean(marketDataDate && marketDataDate === clock.ymd);
  const closed = isWeekend(clock) || !hasTodayMarketData;
  return {
    taipeiDate: clock.date,
    today: clock.ymd,
    marketDataDate,
    marketDataIsoDate: isoDate(marketDataDate),
    hasTodayMarketData,
    closed,
    reason: isWeekend(clock) ? "weekend" : hasTodayMarketData ? "today-market-data" : "no-today-market-data",
  };
}

function payloadRunDate(payload, run) {
  return compactDate(payload?.date || run?.scan_date || run?.date);
}

function allowedForMarketSession(run, marketSession) {
  if (!marketSession?.closed || !marketSession.marketDataDate) return true;
  const runDate = payloadRunDate(run?.payload || {}, run);
  return Boolean(runDate && runDate <= marketSession.marketDataDate);
}

function apiOnlyError(error, detail = "") {
  return {
    ok: false,
    cacheSource: "api-only",
    error,
    detail,
    events: [],
    records: [],
    transport: {
      source: "supabase",
      latestRunView: LATEST_RUN_VIEW,
      gate: AUTHORITATIVE_GATE,
      via: "api/strategy2-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

async function fetchRows(base, table, query) {
  const upstream = await fetch(`${base}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    throw new Error(`${table} HTTP ${upstream.status} ${text.slice(0, 120)}`.trim());
  }
  const rows = await upstream.json();
  return Array.isArray(rows) ? rows : [];
}

function hasStrategy2PayloadRows(payload) {
  return Array.isArray(payload?.events) && payload.events.length > 0
    || Array.isArray(payload?.records) && payload.records.length > 0
    || Array.isArray(payload?.rows) && payload.rows.length > 0;
}

function buildStrategy2RunPayload(run, { skippedEmptyRunIds = [], sourceTable = LATEST_RUN_VIEW, marketSession = null } = {}) {
  const payload = run.payload || {};
  return {
    ...payload,
    ok: payload.ok !== false,
    updatedAt: payload.updatedAt || run.updated_at || run.finished_at,
    runId: payload.runId || run.run_id,
    date: payload.date || run.scan_date || run.date,
    complete: true,
    qualityStatus: payload.qualityStatus || run.quality_status || "complete",
    cacheSource: "supabase-api",
    gate: AUTHORITATIVE_GATE,
    reason: marketSession?.closed ? "non-trading-day-cache" : "complete-run-authoritative",
    marketSession,
    latestCompleteRunCorrected: skippedEmptyRunIds.length > 0,
    correctionReason: skippedEmptyRunIds.length ? "empty_complete_run_skipped" : "",
    skippedEmptyRunIds,
    transport: {
      source: "supabase",
      latestRunView: LATEST_RUN_VIEW,
      sourceTable,
      gate: AUTHORITATIVE_GATE,
      runId: run.run_id,
      skippedEmptyRunIds,
      via: "api/strategy2-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

async function fetchCompleteRunPayload(base, marketSession = null) {
  const latestRows = await fetchRows(
    base,
    LATEST_RUN_VIEW,
    [
      "select=*",
      "strategy=eq.strategy2",
      "status=eq.complete",
      "complete=eq.true",
      "limit=1",
    ].filter(Boolean).join("&")
  );
  const skippedEmptyRunIds = [];
  const latestRun = latestRows[0];
  if (latestRun?.run_id && latestRun?.payload && hasStrategy2PayloadRows(latestRun.payload) && allowedForMarketSession(latestRun, marketSession)) {
    return buildStrategy2RunPayload(latestRun, { marketSession });
  }
  if (latestRun?.run_id) skippedEmptyRunIds.push(latestRun.run_id);

  const historyRows = await fetchRows(
    base,
    RUNS_TABLE,
    [
      "select=*",
      "strategy=eq.strategy2",
      "status=eq.complete",
      "complete=eq.true",
      "result_count=gt.0",
      marketSession?.closed && marketSession.marketDataIsoDate ? "scan_date=lte." + marketSession.marketDataIsoDate : "",
      "order=scan_date.desc,finished_at.desc",
      "limit=10",
    ].filter(Boolean).join("&")
  );
  const historyRun = historyRows.find(row => row?.run_id && row?.payload && hasStrategy2PayloadRows(row.payload) && allowedForMarketSession(row, marketSession));
  return historyRun ? buildStrategy2RunPayload(historyRun, { skippedEmptyRunIds, sourceTable: RUNS_TABLE, marketSession }) : null;
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  try {
    const base = String(SUPABASE_URL || "").replace(/\/+$/, "");
    if (!base || !SUPABASE_KEY) {
      response.status(503).json(apiOnlyError("strategy2_supabase_not_configured"));
      return;
    }
    const marketSession = marketSessionState();
    const completeRun = await fetchCompleteRunPayload(base, marketSession);
    if (completeRun) {
      response.status(200).json(completeRun);
      return;
    }
    response.status(404).json(apiOnlyError("strategy2_complete_run_empty"));
  } catch (error) {
    response.status(503).json(apiOnlyError("strategy2_api_only_failed", error?.message || String(error)));
  }
};


