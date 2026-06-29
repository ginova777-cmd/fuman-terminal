"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = String(
  process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || readSecret("supabase-url.txt")
  || readSecret("terminal-supabase-url.txt")
  || "https://cpmpfhbzutkiecccekfr.supabase.co"
).replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecret("supabase-service-role-key.txt")
  || readSecret("terminal-supabase-service-role-key.txt")
  || readSecret("supabase-anon-key.txt")
  || readSecret("terminal-supabase-key.txt");

const MIN_READY_ROWS = Number(process.env.STRATEGY2_BATTLE_MIN_READY_ROWS || 1000);
const COMPACT_LIMIT = Number(process.env.STRATEGY2_BATTLE_API_LIMIT || 60);
const READY_SELECT = "*";

function readSecret(name) {
  for (const file of [
    path.join(RUNTIME_DIR, "secrets", name),
    path.join(ROOT, "secrets", name),
    path.join(process.cwd(), "secrets", name),
  ]) {
    try {
      return fs.readFileSync(file, "utf8").trim();
    } catch {}
  }
  return "";
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function taipeiParts(date = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function taipeiDate(value = new Date()) {
  const parsed = value instanceof Date ? value : new Date(String(value || ""));
  if (!Number.isFinite(parsed.getTime())) return "";
  const parts = taipeiParts(parsed);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function taipeiMinuteOfDay(date = new Date()) {
  const parts = taipeiParts(date);
  return cleanNumber(parts.hour) * 60 + cleanNumber(parts.minute);
}

function isWeekendTaipei(date = new Date()) {
  const weekday = String(taipeiParts(date).weekday || "").toLowerCase();
  return weekday.startsWith("sat") || weekday.startsWith("sun");
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return taipeiDate(text);
}

function maxTimestamp(rows, keys) {
  let best = "";
  let bestMs = -Infinity;
  for (const row of rows || []) {
    for (const key of keys) {
      const raw = row?.[key];
      if (!raw) continue;
      const ms = Date.parse(String(raw));
      if (Number.isFinite(ms) && ms > bestMs) {
        bestMs = ms;
        best = String(raw);
      }
    }
  }
  return best;
}

function summarizeReadyRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const latestQuoteTime = maxTimestamp(list, ["quote_updated_at", "updated_at"]);
  const latestCandleTime = maxTimestamp(list, ["latest_candle_time"]);
  return {
    rows: list.length,
    readyRows: list.filter((row) => row.ready_ma35_continuous === true || row.ready_ge_35 === true || cleanNumber(row.continuous_candle_count ?? row.candle_count) >= 35).length,
    symbolRows: new Set(list.map((row) => String(row.symbol || row.code || "").trim()).filter(Boolean)).size,
    latestQuoteTime,
    latestQuoteDate: normalizeDate(latestQuoteTime),
    latestCandleTime,
    latestCandleDate: normalizeDate(latestCandleTime),
    latestUpdatedAt: maxTimestamp(list, ["updated_at", "quote_updated_at"]),
  };
}

function sourceTotal(result, summary) {
  const exact = cleanNumber(result?.exactCount);
  return exact > 0 ? exact : cleanNumber(summary?.rows);
}

function strategy2MarketSession(apiPayload = {}) {
  const now = new Date();
  const today = taipeiDate(now);
  const minute = taipeiMinuteOfDay(now);
  const tradingDay = apiPayload?.transport?.tradingDay || apiPayload?.resourceReadiness?.tradingDay || null;
  const tradingDaySaysClosed = tradingDay && tradingDay.isTradingDay === false;
  const isTradingDay = tradingDay ? tradingDay.isTradingDay !== false : !isWeekendTaipei(now);
  let session = "market_closed";
  if (isTradingDay && !tradingDaySaysClosed) {
    if (minute < 9 * 60) session = "premarket";
    else if (minute <= 13 * 60 + 35) session = "market_live";
    else session = "afterhours";
  }
  return {
    today,
    localTime: `${taipeiParts(now).hour}:${taipeiParts(now).minute}:${taipeiParts(now).second}`,
    minuteOfDay: minute,
    session,
    isTradingDay,
    tradingDay,
    quoteFreshRequired: session === "market_live",
  };
}

function sourceQuoteStatus(session, latestQuoteDate, healthStatus) {
  if (session.session === "market_live") {
    if (latestQuoteDate === session.today && healthStatus === "ready") return "live_quote_fresh";
    return "live_quote_not_fresh";
  }
  if (session.session === "afterhours") {
    if (latestQuoteDate === session.today) return "afterhours_stopped_ok";
    return "afterhours_stale";
  }
  if (session.session === "premarket") {
    if (latestQuoteDate === session.today) return "premarket_today_quotes_seen";
    return "premarket_waiting_or_stale";
  }
  return "market_closed";
}

function buildPath(table, params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${table}?${query}` : table;
}

async function rest(pathname, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) fail("missing Supabase credentials");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 25000);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: "application/json",
        ...(options.count ? { Prefer: "count=exact" } : {}),
      },
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
    if (!response.ok) fail(`${pathname} HTTP ${response.status}`, { body: text.slice(0, 500) });
    const range = response.headers.get("content-range") || "";
    const exactCount = range.includes("/") ? Number(range.split("/").pop()) : null;
    return { rows: text ? JSON.parse(text) : [], exactCount, status: response.status };
  } finally {
    clearTimeout(timer);
  }
}

async function safeRest(pathname, options = {}) {
  try {
    return { ok: true, ...(await rest(pathname, options)) };
  } catch (error) {
    return { ok: false, rows: [], exactCount: 0, error: error?.message || String(error), details: error?.details || {} };
  }
}

async function rpc(functionName, body = {}, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) fail("missing Supabase credentials");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 25000);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
    if (!response.ok) fail(`${functionName} HTTP ${response.status}`, { body: text.slice(0, 500), bodySent: body });
    const rows = text ? JSON.parse(text) : [];
    return Array.isArray(rows) ? rows : [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchStrategy2RpcRows(limit = 5000) {
  const pageSize = Math.min(1000, Math.max(1, Number(process.env.STRATEGY2_BATTLE_RPC_PAGE_SIZE || 1000)));
  const maxRows = Math.max(pageSize, limit);
  const rows = [];
  let supportsOffset = true;
  let firstPageSignature = "";
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    let page = [];
    if (supportsOffset) {
      try {
        page = await rpc("get_strategy2_intraday_ready", { p_limit: pageSize, p_offset: offset });
      } catch (error) {
        const message = `${error?.message || ""} ${error?.details?.body || ""}`;
        if (!/p_offset|argument|function/i.test(message)) throw error;
        supportsOffset = false;
      }
    }
    if (!supportsOffset) {
      page = await rpc("get_strategy2_intraday_ready", { p_limit: Math.min(limit, maxRows) });
    }
    if (!Array.isArray(page) || !page.length) break;
    const signature = page.slice(0, 5).map((row) => String(row.symbol || row.code || "")).join(",");
    if (offset === 0) firstPageSignature = signature;
    if (offset > 0 && signature && signature === firstPageSignature) break;
    rows.push(...page);
    if (!supportsOffset || page.length < pageSize) break;
  }
  return rows;
}

async function captureStrategy2Api(query = {}) {
  const handler = require("../api/strategy2-latest");
  const queryText = new URLSearchParams(query).toString();
  let body = null;
  const request = {
    method: "GET",
    query,
    url: `/api/strategy2-latest${queryText ? `?${queryText}` : ""}`,
    headers: {},
  };
  const response = {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = Number(code) || 200; return this; },
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = String(value); },
    json(payload) { body = payload; return payload; },
    send(payload) { body = payload; return payload; },
    end(payload) { body = payload; return payload; },
  };
  await Promise.resolve(handler(request, response));
  return { statusCode: response.statusCode, headers: response.headers, body };
}

function apiCount(payload = {}) {
  const events = Array.isArray(payload.events) ? payload.events.length : 0;
  const records = Array.isArray(payload.records) ? payload.records.length : 0;
  const rows = Array.isArray(payload.rows) ? payload.rows.length : 0;
  return cleanNumber(payload.count) || rows || events + records;
}

function latestRunSummary(row = {}) {
  return {
    runId: row.run_id || "",
    scanDate: row.scan_date || row.date || "",
    status: row.status || "",
    complete: row.complete,
    expectedTotal: row.expected_total,
    scannedCount: row.scanned_count,
    resultCount: row.result_count,
    qualityStatus: row.quality_status || "",
    updatedAt: row.updated_at || row.finished_at || "",
    payloadCount: cleanNumber(row.payload?.count || row.payload?.resultCount || row.payload?.totalCount),
  };
}

function pushIssue(list, condition, id, details = {}) {
  if (!condition) list.push({ id, ...details });
}

async function main() {
  const issues = [];
  const warnings = [];
  const details = {};

  const api = await captureStrategy2Api({
    canvas: "1",
    compact: "1",
    shell: "1",
    live: "1",
    limit: String(COMPACT_LIMIT),
    verify: "1",
  });
  const apiPayload = api.body || {};
  const session = strategy2MarketSession(apiPayload);
  details.session = session;
  details.api = {
    statusCode: api.statusCode,
    ok: apiPayload.ok,
    runId: apiPayload.runId || apiPayload.transport?.runId || "",
    cacheSource: apiPayload.cacheSource || apiPayload.source || "",
    reason: apiPayload.reason || apiPayload.error || "",
    publishBlocked: apiPayload.publishBlocked === true,
    publishBlockedReason: apiPayload.publishBlockedReason || "",
    count: apiCount(apiPayload),
    totalCount: cleanNumber(apiPayload.totalCount || apiPayload.total || apiPayload.scanned),
    scanned: cleanNumber(apiPayload.scanned || apiPayload.totalCount || apiPayload.total),
    entryCount: cleanNumber(apiPayload.entryCount || apiPayload.aCount),
    rows: Array.isArray(apiPayload.rows) ? apiPayload.rows.length : 0,
    events: Array.isArray(apiPayload.events) ? apiPayload.events.length : 0,
    records: Array.isArray(apiPayload.records) ? apiPayload.records.length : 0,
    resourceReadiness: apiPayload.resourceReadiness || null,
    transport: apiPayload.transport || null,
  };
  pushIssue(issues, api.statusCode >= 200 && api.statusCode < 300 && apiPayload.ok !== false, "api_not_ok", { statusCode: api.statusCode, reason: details.api.reason });
  pushIssue(issues, Boolean(details.api.runId), "api_missing_run_id");

  const healthResult = await rest(buildPath("v_scanner_resource_health", {
    select: "strategy,required_source,latest_date,row_count,status,reason,suggested_scanner_behavior,updated_at",
    strategy: "eq.Strategy2",
    limit: 1,
  }));
  const health = healthResult.rows[0] || {};
  const healthStatus = String(health.status || "").toLowerCase();
  details.health = health;
  pushIssue(issues, Boolean(health.strategy), "scanner_resource_health_missing");
  pushIssue(issues, ["ready", "stale", "not_ready", "failed"].includes(healthStatus), "scanner_resource_health_bad_status", { status: health.status || "" });
  pushIssue(issues, healthStatus === "ready" || Boolean(String(health.reason || "").trim()), "scanner_resource_health_reason_missing", { status: health.status || "" });

  const [cacheResult, viewResult, rpcRows, readinessResult, latestRunResult] = await Promise.all([
    safeRest(buildPath("strategy2_intraday_ready_cache", {
      select: READY_SELECT,
      limit: 5000,
    }), { count: true, timeoutMs: 25000 }),
    safeRest(buildPath("v_strategy2_intraday_ready", {
      select: READY_SELECT,
      limit: 5000,
    }), { count: true, timeoutMs: 25000 }),
    fetchStrategy2RpcRows(5000).catch((error) => ({ __rpcError: error?.message || String(error), details: error?.details || {} })),
    safeRest(buildPath("v_strategy2_readiness_status", {
      select: "*",
      limit: 1,
    }), { timeoutMs: 15000 }),
    safeRest(buildPath("v_strategy2_latest_complete_run", {
      select: "*",
      strategy: "eq.strategy2",
      status: "eq.complete",
      complete: "eq.true",
      limit: 1,
    }), { timeoutMs: 15000 }),
  ]);

  const rpcOk = Array.isArray(rpcRows);
  const cacheSummary = summarizeReadyRows(cacheResult.rows);
  const viewSummary = summarizeReadyRows(viewResult.rows);
  const rpcSummary = summarizeReadyRows(rpcOk ? rpcRows : []);
  const cacheTotal = sourceTotal(cacheResult, cacheSummary);
  const viewTotal = sourceTotal(viewResult, viewSummary);
  const rpcTotal = rpcSummary.rows;
  details.sources = {
    cache: {
      ok: cacheResult.ok,
      error: cacheResult.error || "",
      exactCount: cacheResult.exactCount,
      totalRows: cacheTotal,
      fetchedRows: cacheSummary.rows,
      ...cacheSummary,
    },
    view: {
      ok: viewResult.ok,
      error: viewResult.error || "",
      exactCount: viewResult.exactCount,
      totalRows: viewTotal,
      fetchedRows: viewSummary.rows,
      ...viewSummary,
    },
    rpc: {
      ok: rpcOk,
      error: rpcOk ? "" : rpcRows.__rpcError,
      totalRows: rpcTotal,
      ...rpcSummary,
    },
  };

  pushIssue(issues, cacheResult.ok, "cache_unreadable", { error: cacheResult.error || "" });
  pushIssue(issues, viewResult.ok, "view_unreadable", { error: viewResult.error || "" });
  pushIssue(issues, rpcOk, "rpc_unreadable", { error: rpcOk ? "" : rpcRows.__rpcError });
  pushIssue(issues, cacheTotal >= MIN_READY_ROWS, "cache_rows_below_min", { rows: cacheTotal, min: MIN_READY_ROWS });
  pushIssue(issues, viewTotal >= MIN_READY_ROWS, "view_rows_below_min", { rows: viewTotal, min: MIN_READY_ROWS });
  pushIssue(issues, rpcTotal >= MIN_READY_ROWS, "rpc_rows_below_min", { rows: rpcTotal, min: MIN_READY_ROWS });

  const countMismatch = cacheTotal !== viewTotal || cacheTotal !== rpcTotal;
  pushIssue(issues, !countMismatch, "cache_rpc_view_count_mismatch", {
    cacheRows: cacheTotal,
    viewRows: viewTotal,
    rpcRows: rpcTotal,
  });
  if (cleanNumber(health.row_count) > 0 && Math.abs(cleanNumber(health.row_count) - cacheTotal) > 5) {
    issues.push({
      id: "scanner_health_row_count_mismatch",
      healthRows: cleanNumber(health.row_count),
      cacheRows: cacheTotal,
    });
  }

  const latestQuoteDate = cacheSummary.latestQuoteDate || viewSummary.latestQuoteDate || rpcSummary.latestQuoteDate;
  const latestCandleDate = cacheSummary.latestCandleDate || viewSummary.latestCandleDate || rpcSummary.latestCandleDate;
  const quoteStatus = sourceQuoteStatus(session, latestQuoteDate, healthStatus);
  details.freshness = {
    latestQuoteDate,
    latestCandleDate,
    quoteStatus,
    quoteFreshRequired: session.quoteFreshRequired,
    healthStatus,
  };

  if (session.quoteFreshRequired) {
    pushIssue(issues, latestQuoteDate === session.today, "live_quote_date_not_today", { latestQuoteDate, today: session.today });
    pushIssue(issues, latestCandleDate === session.today, "live_candle_date_not_today", { latestCandleDate, today: session.today });
    pushIssue(issues, healthStatus === "ready", "live_health_not_ready", { status: healthStatus, reason: health.reason || "" });
    pushIssue(issues, details.api.publishBlocked !== true, "api_publish_blocked_during_live_session", { reason: details.api.publishBlockedReason });
  } else {
    if (healthStatus === "failed") {
      issues.push({ id: "non_live_health_failed", reason: health.reason || "" });
    }
    if (quoteStatus === "afterhours_stale" && session.isTradingDay) {
      warnings.push({ id: "afterhours_quote_not_today", latestQuoteDate, today: session.today });
    }
  }

  const readiness = readinessResult.rows?.[0] || {};
  details.readiness = readinessResult.ok ? readiness : { error: readinessResult.error || "" };
  if (!readinessResult.ok) {
    issues.push({ id: "readiness_status_unreadable", error: readinessResult.error || "" });
  } else if (session.quoteFreshRequired && readiness.strategy2_ready_100 !== true) {
    issues.push({
      id: "readiness_not_100_during_live_session",
      status: readiness.status || "",
      reason: readiness.reason || "",
      latestRunId: readiness.latest_run_id || "",
    });
  } else if (readiness.strategy2_ready_100 !== true) {
    warnings.push({
      id: "readiness_not_100_non_live",
      status: readiness.status || "",
      reason: readiness.reason || "",
    });
  }

  const latestRun = latestRunResult.rows?.[0] || {};
  const latestRunInfo = latestRunSummary(latestRun);
  const resultsResult = latestRunInfo.runId
    ? await safeRest(buildPath("strategy2_scan_results", {
      select: "run_id,row_kind,code,name,state_id,signal_id,latest_seen_at,quote_age_seconds,latest_candle_time,today_candle_count,updated_at,payload",
      strategy: "eq.strategy2",
      run_id: `eq.${latestRunInfo.runId}`,
      limit: 1000,
    }), { count: true, timeoutMs: 15000 })
    : { ok: false, rows: [], exactCount: 0, error: "missing latest run id" };
  const resultRows = Array.isArray(resultsResult.rows) ? resultsResult.rows : [];
  const eventRows = resultRows.filter((row) => String(row.row_kind || "event") === "event").length;
  const recordRows = resultRows.filter((row) => String(row.row_kind || "") !== "event").length;
  details.latestRun = latestRunInfo;
  details.resultRows = {
    ok: resultsResult.ok,
    error: resultsResult.error || "",
    exactCount: cleanNumber(resultsResult.exactCount),
    fetchedRows: resultRows.length,
    eventRows,
    recordRows,
    sampleKeys: Object.keys(resultsResult.rows?.[0] || {}),
  };
  if (!latestRunResult.ok) issues.push({ id: "latest_run_unreadable", error: latestRunResult.error || "" });
  pushIssue(issues, Boolean(latestRunInfo.runId), "latest_run_missing");
  if (latestRunInfo.runId) {
    pushIssue(issues, latestRunInfo.complete === true, "latest_run_not_complete", { complete: latestRunInfo.complete });
    pushIssue(issues, String(latestRunInfo.status || "").toLowerCase() === "complete", "latest_run_bad_status", { status: latestRunInfo.status || "" });
    if (cleanNumber(latestRunInfo.resultCount) > 0 && eventRows > 0) {
      pushIssue(issues, eventRows === cleanNumber(latestRunInfo.resultCount), "latest_event_count_mismatch", {
        runResultCount: cleanNumber(latestRunInfo.resultCount),
        eventRows,
        recordRows,
        totalRows: cleanNumber(resultsResult.exactCount),
      });
    }
  }

  if (details.api.count <= 0 && cleanNumber(latestRunInfo.resultCount) > 0) {
    issues.push({
      id: "api_count_empty_but_latest_run_has_results",
      apiCount: details.api.count,
      runResultCount: latestRunInfo.resultCount,
    });
  }
  if (details.api.runId && latestRunInfo.runId && details.api.runId !== latestRunInfo.runId) {
    warnings.push({
      id: "api_run_id_differs_from_latest_view",
      apiRunId: details.api.runId,
      latestViewRunId: latestRunInfo.runId,
      reason: apiPayload.correctionReason || apiPayload.reason || "",
    });
  }
  if (details.api.count > COMPACT_LIMIT) {
    issues.push({ id: "api_compact_count_exceeds_limit", apiCount: details.api.count, limit: COMPACT_LIMIT });
  }

  const output = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    strategy: "Strategy2",
    contract: "strategy2-live-cache-rpc-view-api-verify-v1",
    issues,
    warnings,
    details,
    gate: {
      readyToPublishFreshLive: session.quoteFreshRequired
        ? issues.length === 0 && healthStatus === "ready" && latestQuoteDate === session.today
        : false,
      nonLiveBehavior: session.quoteFreshRequired
        ? ""
        : quoteStatus === "afterhours_stopped_ok"
          ? "afterhours_stopped_ok; preserve/latest complete run allowed; do not require sub-120s quote freshness"
          : "non_live_session; preserve latest complete run and surface explicit stale/not_ready reason",
    },
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (issues.length) process.exit(1);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    strategy: "Strategy2",
    contract: "strategy2-live-cache-rpc-view-api-verify-v1",
    error: error?.message || String(error),
    details: error?.details || {},
  }, null, 2)}\n`);
  process.exit(1);
});
