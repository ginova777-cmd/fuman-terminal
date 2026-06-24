const fs = require("fs");
const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = terminalSupabaseUrl({ root: ROOT, runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ root: ROOT, runtimeDir: RUNTIME_DIR });

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

function parseRequestOptions(request) {
  let url = null;
  try {
    url = new URL(request.url || "", `http://${request.headers?.host || "localhost"}`);
  } catch {
    url = new URL("http://localhost/");
  }
  const params = url.searchParams;
  const compact = ["canvas", "compact", "shell"].some((key) => /^(1|true|yes)$/i.test(params.get(key) || ""));
  const requestedLimit = Number(params.get("limit") || "");
  const fallbackLimit = compact ? 60 : 200;
  const wantsAllToday = /^(1|true|yes)$/i.test(params.get("today") || params.get("allToday") || "");
  const maxLimit = compact ? (wantsAllToday ? 240 : 120) : 500;
  const limit = Math.max(20, Math.min(maxLimit, Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : fallbackLimit));
  return {
    compact,
    canvas: /^(1|true|yes)$/i.test(params.get("canvas") || ""),
    shell: /^(1|true|yes)$/i.test(params.get("shell") || ""),
    live: /^(1|true|yes)$/i.test(params.get("live") || ""),
    today: wantsAllToday,
    limit,
  };
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function compactText(value, limit = 160) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function compactStrategy2Row(row, index = 0) {
  const active = row?.activeMatch && typeof row.activeMatch === "object" ? row.activeMatch : {};
  const match = Array.isArray(row?.matches) && row.matches[0] && typeof row.matches[0] === "object" ? row.matches[0] : {};
  const latest = row?.latestRecord && typeof row.latestRecord === "object" ? row.latestRecord : {};
  const code = String(row?.code || latest.code || row?.stockNo || row?.stock_no || row?.symbol || "").match(/\d{4}/)?.[0] || "";
  const name = compactText(row?.name || latest.name || row?.stockName || row?.stock_name || code || "", 48);
  const state = compactText(row?.stateLabel || row?.state || row?.stateId || row?.status || latest.stateLabel || latest.stateId || active.name || active.id || match.name || match.id || "", 48);
  const reason = compactText(
    row?.reason || row?.stateReason || row?.strategyReasons?.[0] || latest.reason || latest.stateReason || latest.strategyReasons?.[0] || row?.signal || active.reason || match.reason || row?.note || row?.message || "",
    180
  );
  const percent = row?.percent ?? latest.percent ?? row?.changePercent ?? row?.change_percent ?? row?.change ?? "";
  const score = row?.score ?? row?.maxScore ?? latest.score ?? row?.rankScore ?? active.score ?? match.score ?? "";
  return {
    rank: cleanNumber(row?.rank) || index + 1,
    code,
    name,
    title: name || code,
    state,
    stateId: row?.stateId || row?.state_id || "",
    status: row?.status || state,
    signal: compactText(row?.signal || state || reason, 72),
    reason,
    score,
    percent,
    price: row?.price ?? row?.latestSeenPrice ?? row?.latestBPrice ?? row?.close ?? row?.observedPrice ?? row?.entryPrice ?? latest.observedPrice ?? latest.entryPrice ?? "",
    close: row?.close ?? row?.price ?? row?.latestSeenPrice ?? row?.observedPrice ?? latest.observedPrice ?? "",
    volume: row?.volume ?? row?.tradeVolume ?? row?.volumeLots ?? latest.volume ?? "",
    value: row?.value ?? row?.tradeValue ?? latest.value ?? "",
    quoteTime: row?.quoteTime || latest.quoteTime || row?.latestSeenAt || row?.time || row?.updatedAt || "",
    time: row?.time || row?.quoteTime || row?.latestSeenAt || latest.quoteTime || "",
    activeMatch: active?.id || active?.name || active?.reason ? {
      id: active.id || active.name || "",
      name: active.name || active.id || "",
      reason: compactText(active.reason || "", 120),
      score: active.score ?? "",
    } : undefined,
  };
}

function rankStrategy2Rows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === "object")
    .map((row, index) => compactStrategy2Row(row, index))
    .filter((row) => row.code || row.name || row.reason)
    .sort((a, b) => {
      const aEntry = /entry|go|進場/i.test(`${a.stateId} ${a.state} ${a.signal}`);
      const bEntry = /entry|go|進場/i.test(`${b.stateId} ${b.state} ${b.signal}`);
      return Number(bEntry) - Number(aEntry)
        || cleanNumber(b.score) - cleanNumber(a.score)
        || cleanNumber(b.percent) - cleanNumber(a.percent)
        || cleanNumber(a.rank) - cleanNumber(b.rank)
        || String(a.code).localeCompare(String(b.code), "zh-Hant");
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function compactStrategy2Payload(payload, options) {
  if (!options?.compact) return payload;
  const limit = options.limit || 60;
  const events = rankStrategy2Rows(payload?.events).slice(0, limit);
  const eventCodes = new Set(events.map((row) => row.code).filter(Boolean));
  const rankedRecords = rankStrategy2Rows(payload?.records);
  const records = rankedRecords.filter((row) => !eventCodes.has(row.code)).slice(0, limit);
  const seen = new Set();
  const rows = [...events, ...records]
    .filter((row) => {
      const key = row.code ? `${row.code}|${row.state}|${row.reason}` : `${row.rank}|${row.reason}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
  const hasRows = rows.length > 0;
  const noTodayDetections = !hasRows && Boolean(payload?.noTodayDetections);
  const reason = hasRows && payload?.reason === "today-complete-run-empty"
    ? "complete-run-authoritative"
    : payload?.reason || "complete-run-authoritative";
  return {
    ok: payload?.ok !== false,
    compact: true,
    canvas: Boolean(options.canvas),
    shell: Boolean(options.shell),
    compactLimit: limit,
    battleMode: Boolean(options.today || options.live),
    mode: options.today || options.live ? "strategy2-live-battle" : "strategy2-live",
    cacheSource: payload?.cacheSource || "supabase-api",
    gate: payload?.gate || AUTHORITATIVE_GATE,
    reason,
    noTodayDetections,
    updatedAt: payload?.updatedAt || payload?.generatedAt || "",
    generatedAt: payload?.generatedAt || payload?.updatedAt || "",
    runId: payload?.runId || payload?.transport?.runId || "",
    date: payload?.date || "",
    complete: payload?.complete !== false,
    qualityStatus: payload?.qualityStatus || "complete",
    scanWindow: payload?.scanWindow || null,
    marketSession: payload?.marketSession || null,
    count: rows.length,
    matchCount: cleanNumber(payload?.matchCount || payload?.entryCount || payload?.aCount || rows.length),
    entryCount: cleanNumber(payload?.entryCount || payload?.aCount || events.length),
    aCount: cleanNumber(payload?.aCount || payload?.entryCount || events.length),
    bOnlyCount: cleanNumber(payload?.bOnlyCount),
    totalCount: cleanNumber(payload?.totalCount || payload?.scanned || payload?.total || payload?.records?.length),
    scanned: cleanNumber(payload?.scanned || payload?.records?.length),
    total: cleanNumber(payload?.total || payload?.records?.length),
    events,
    records,
    rows,
    transport: {
      ...(payload?.transport || {}),
      compact: true,
      canvas: Boolean(options.canvas),
      live: Boolean(options.live),
      today: Boolean(options.today),
      limit,
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

function buildStrategy2RunPayload(run, { skippedEmptyRunIds = [], sourceTable = LATEST_RUN_VIEW, marketSession = null, options = null, emptyToday = false } = {}) {
  const payload = run.payload || {};
  const fullPayload = {
    ...payload,
    ok: payload.ok !== false,
    updatedAt: payload.updatedAt || run.updated_at || run.finished_at,
    runId: payload.runId || run.run_id,
    date: payload.date || run.scan_date || run.date,
    complete: true,
    qualityStatus: payload.qualityStatus || run.quality_status || "complete",
    cacheSource: "supabase-api",
    gate: AUTHORITATIVE_GATE,
    reason: emptyToday ? "today-complete-run-empty" : marketSession?.closed ? "non-trading-day-cache" : "complete-run-authoritative",
    noTodayDetections: Boolean(emptyToday),
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
  return compactStrategy2Payload(fullPayload, options);
}

async function fetchCompleteRunPayload(base, marketSession = null, options = null) {
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
    return buildStrategy2RunPayload(latestRun, { marketSession, options });
  }
  if (options?.today && latestRun?.run_id && payloadRunDate(latestRun.payload || {}, latestRun) === marketSession?.today) {
    return buildStrategy2RunPayload(latestRun, { marketSession, options, emptyToday: true });
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
  return historyRun ? buildStrategy2RunPayload(historyRun, { skippedEmptyRunIds, sourceTable: RUNS_TABLE, marketSession, options }) : null;
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
    const options = parseRequestOptions(request);
    const base = String(SUPABASE_URL || "").replace(/\/+$/, "");
    if (!base || !SUPABASE_KEY) {
      response.status(503).json(apiOnlyError("strategy2_supabase_not_configured"));
      return;
    }
    const marketSession = marketSessionState();
    const completeRun = await fetchCompleteRunPayload(base, marketSession, options);
    if (completeRun) {
      response.status(200).json(completeRun);
      return;
    }
    response.status(404).json(apiOnlyError("strategy2_complete_run_empty"));
  } catch (error) {
    response.status(503).json(apiOnlyError("strategy2_api_only_failed", error?.message || String(error)));
  }
};


