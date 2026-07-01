const fs = require("fs");
const path = require("path");
const { isTwseTradingDay } = require("../scripts/twse-trading-day");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });
const TABLE = process.env.FUMAN_REALTIME_RADAR_TABLE || "fuman_realtime_radar_cache";

const QUOTE_TABLE = process.env.FUMAN_REALTIME_QUOTE_TABLE || "fugle_realtime_quote_latest";
const DEFAULT_RADAR_LIMIT = 120;
const FULL_SESSION_RADAR_LIMIT = 1200;
const MAX_RADAR_LIMIT = 1500;
const MIN_TRADING_DAY_CACHE_MAX_AGE_MS = Number(process.env.REALTIME_RADAR_API_MIN_CACHE_MAX_AGE_MS || 5 * 60 * 1000);

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,％%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function clampLimit(value, fallback = DEFAULT_RADAR_LIMIT) {
  const number = Math.round(cleanNumber(value));
  return Math.max(1, Math.min(MAX_RADAR_LIMIT, number || fallback));
}

function requestRadarLimit(request) {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const full = /^(1|true|yes|all)$/i.test(url.searchParams.get("full") || "");
    const fallback = full ? FULL_SESSION_RADAR_LIMIT : DEFAULT_RADAR_LIMIT;
    return clampLimit(url.searchParams.get("limit"), fallback);
  } catch {
    return DEFAULT_RADAR_LIMIT;
  }
}

function taipeiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}${byType.month}${byType.day}`;
}

function taipeiTimeLabel(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.hour || "00"}:${byType.minute || "00"}:${byType.second || "00"}`;
}

function compactDateKey(value) {
  const text = String(value || "");
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return taipeiDateKey(new Date(parsed));
  return text.replace(/\D/g, "").slice(0, 8);
}

function isoDateKey(value) {
  const key = compactDateKey(value);
  return /^\d{8}$/.test(key) ? `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}` : "";
}

function radarPayloadTradeDate(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  return [
    payload?.resolvedTradeDate,
    payload?.tradeDate,
    payload?.usedDate,
    payload?.dataDate,
    payload?.date,
    payload?.marketDataDate,
    ...rows.flatMap((row) => [row?.radarDate, row?.tradeDate, row?.quoteDate, row?.date, row?.timestamp, row?.radarUpdatedAt]),
  ].map(compactDateKey).filter(Boolean).sort().at(-1) || "";
}

function radarPayloadRunId(payload, row = {}) {
  const explicit = String(
    payload?.runId
    || payload?.transport?.runId
    || payload?.transport?.payloadRunId
    || ""
  ).trim();
  if (explicit) return explicit;
  const date = radarPayloadTradeDate(payload) || compactDateKey(row.updated_at) || taipeiDateKey();
  const updatedAt = payloadUpdatedAtMs(payload) || Date.parse(row.updated_at || "") || 0;
  const rowCount = cleanNumber(payload?.totalCount) || cleanNumber(payload?.sourceTotalCount) || (Array.isArray(payload?.rows) ? payload.rows.length : cleanNumber(payload?.count));
  return `realtime-radar-${date || "unknown"}-${updatedAt || "unknown"}-${rowCount || 0}`;
}

function buildMarketSession(tradingDay, payload) {
  const today = taipeiDateKey();
  const marketDataDate = radarPayloadTradeDate(payload);
  return {
    taipeiDate: isoDateKey(today),
    today,
    marketDataDate,
    marketDataIsoDate: isoDateKey(marketDataDate),
    hasTodayMarketData: Boolean(marketDataDate && marketDataDate === today),
    closed: !tradingDay?.isTradingDay,
    reason: tradingDay?.reason || (!tradingDay?.isTradingDay ? "non-trading-day" : "regular_trading_day"),
    source: tradingDay?.source || "twse-trading-day",
  };
}

function taipeiMinuteOfDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return cleanNumber(byType.hour) * 60 + cleanNumber(byType.minute);
}

function isMarketDetectionWindow(date = new Date()) {
  const minutes = taipeiMinuteOfDay(date);
  return minutes >= 9 * 60 && minutes <= 13 * 60 + 30;
}

function payloadUpdatedAtMs(payload) {
  const explicit = cleanNumber(payload?.updatedAtMs);
  if (explicit > 0) return explicit;
  const parsed = Date.parse(payload?.updatedAt || payload?.timestamp || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function payloadFreshnessAgeMs(payload, nowMs = Date.now()) {
  const updatedAtMs = payloadUpdatedAtMs(payload);
  return updatedAtMs ? Math.max(0, nowMs - updatedAtMs) : null;
}

function payloadFreshnessMaxAgeMs(payload) {
  const staleAfterMs = cleanNumber(payload?.staleAfterMs);
  const writerBudgetMs = staleAfterMs > 0 ? staleAfterMs * 15 : 0;
  return Math.max(MIN_TRADING_DAY_CACHE_MAX_AGE_MS, writerBudgetMs);
}

function payloadFreshnessSnapshot(marketSession, payload, nowMs = Date.now()) {
  const ageMs = payloadFreshnessAgeMs(payload, nowMs);
  const maxAgeMs = payloadFreshnessMaxAgeMs(payload);
  const inDetectionWindow = isMarketDetectionWindow(new Date(nowMs));
  const fresh = Boolean(
    marketSession?.hasTodayMarketData
    && (!inDetectionWindow || (ageMs != null && ageMs <= maxAgeMs))
  );
  return {
    fresh,
    ageMs,
    ageSeconds: ageMs == null ? null : Math.round(ageMs / 1000),
    maxAgeMs,
    maxAgeSeconds: Math.round(maxAgeMs / 1000),
    updatedAtMs: payloadUpdatedAtMs(payload),
    checkedAt: new Date(nowMs).toISOString(),
  };
}

function isTradingDayPayloadFresh(marketSession, payload) {
  if (!marketSession?.hasTodayMarketData) return false;
  if (!isMarketDetectionWindow()) return true;
  return payloadFreshnessSnapshot(marketSession, payload).fresh;
}

function radarSourceCoverage(payload, marketSession) {
  const freshness = payloadFreshnessSnapshot(marketSession, payload);
  const ready = Boolean(payload?.ok !== false && cleanNumber(payload?.count || payload?.rows?.length) > 0 && freshness.fresh);
  return {
    ok: ready,
    ready,
    status: ready ? "ready" : marketSession?.hasTodayMarketData ? "stale" : "not_ready",
    reason: ready
      ? "realtime_radar_today_quote_ready"
      : marketSession?.hasTodayMarketData
        ? "realtime_radar_payload_stale_or_empty"
        : `realtime_radar_source_date_not_today:${marketSession?.marketDataDate || "missing"}!=${marketSession?.today || taipeiDateKey()}`,
    tradeDate: marketSession?.marketDataDate || "",
    today: marketSession?.today || taipeiDateKey(),
    count: cleanNumber(payload?.count || payload?.rows?.length),
    updatedAt: payload?.updatedAt || "",
    ageSeconds: freshness.ageSeconds,
    maxAgeSeconds: freshness.maxAgeSeconds,
    checkedAt: new Date().toISOString(),
  };
}

function normalizeRadarRows(payload, limit = DEFAULT_RADAR_LIMIT) {
  if (!Array.isArray(payload?.rows)) return payload;
  const allRows = payload.rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const tags = Array.isArray(row.tags)
      ? row.tags
      : Array.isArray(row.signalTags)
        ? row.signalTags
        : [];
    const signal = row.signal || tags[0] || row.stateId || row.side || "";
    const state = row.state || row.side || row.radarMode || "";
    const reason = row.reason || tags.join(" / ") || signal || state;
    return {
      ...row,
      tags,
      signal,
      state,
      reason,
    };
  });
  const rows = allRows.slice(0, clampLimit(limit));
  return {
    ...payload,
    rows,
    count: rows.length,
    totalCount: allRows.length,
    hasMore: allRows.length > rows.length,
    displayWindow: "09:00-13:30",
  };
}

function withMarketSession(payload, marketSession, reason = "", limit = DEFAULT_RADAR_LIMIT) {
  const normalizedPayload = normalizeRadarRows(payload, limit);
  const freshness = payloadFreshnessSnapshot(marketSession, normalizedPayload);
  const runId = radarPayloadRunId(normalizedPayload);
  const fallbackUsed = normalizedPayload?.fallbackUsed === true
    || /fallback/i.test(String(reason || ""))
    || /fallback/i.test(String(normalizedPayload?.transport?.mode || ""))
    || /fallback/i.test(String(normalizedPayload?.freshness?.decision || ""));
  const fallbackScope = Array.isArray(normalizedPayload?.fallbackScope)
    ? normalizedPayload.fallbackScope
    : fallbackUsed
      ? [normalizedPayload?.transport?.mode || normalizedPayload?.freshness?.decision || reason || "realtime_radar_fallback"]
      : [];
  const fallbackDetails = Array.isArray(normalizedPayload?.fallbackDetails)
    ? normalizedPayload.fallbackDetails
    : fallbackUsed
      ? [{
        scope: fallbackScope.join("+"),
        reason: reason || normalizedPayload?.freshness?.reason || "realtime radar fallback path used",
        table: normalizedPayload?.transport?.table || TABLE,
      }]
      : [];
  const writeBudget = normalizedPayload?.writeBudget || {
    source: "realtime-radar-write-budget",
    status: "pending_next_writer_run",
    runId,
    limit: 0,
    writesAttempted: 0,
    writesCompleted: 0,
    blocked: false,
    reason: "payload missing writer writeBudget; waiting for next scanner run",
    checkedAt: new Date().toISOString(),
  };
  return {
    ...normalizedPayload,
    runId,
    tradeDate: marketSession?.marketDataDate || normalizedPayload?.tradeDate || normalizedPayload?.usedDate || normalizedPayload?.date || "",
    usedDate: marketSession?.marketDataDate || normalizedPayload?.usedDate || normalizedPayload?.date || "",
    sourceDate: marketSession?.marketDataDate || normalizedPayload?.sourceDate || normalizedPayload?.date || "",
    sourceCoverage: normalizedPayload?.sourceCoverage || radarSourceCoverage(normalizedPayload, marketSession),
    freshness: {
      ...(normalizedPayload?.freshness || {}),
      decision: normalizedPayload?.freshness?.decision || (freshness.fresh ? "fresh" : "stale"),
      updatedAt: normalizedPayload?.updatedAt || "",
      ageSeconds: freshness.ageSeconds,
      maxAgeSeconds: freshness.maxAgeSeconds,
      checkedAt: freshness.checkedAt,
      marketDataDate: marketSession?.marketDataDate || "",
      today: marketSession?.today || "",
    },
    fallbackUsed,
    fallbackScope,
    fallbackDetails,
    writeBudget,
    reason: reason || normalizedPayload?.reason,
    marketSession,
    transport: {
      ...(normalizedPayload?.transport || {}),
      runId,
      payloadRunId: runId,
      via: "api/realtime-radar-latest",
      gate: marketSession?.closed ? "non-trading-day-cache" : "trading-day-live",
      fetchedAt: new Date().toISOString(),
    },
  };
}

function radarScore(row) {
  const pct = Math.abs(cleanNumber(row.change_percent));
  const value = cleanNumber(row.trade_value_twd);
  const volume = cleanNumber(row.volume_lots);
  return Math.max(1, Math.min(100, Math.round(30 + pct * 9 + Math.log10(Math.max(value, 1)) * 4 + Math.log10(Math.max(volume, 1)) * 3)));
}

function quoteRowsToRadarPayload(rows = [], limit = DEFAULT_RADAR_LIMIT) {
  const now = Date.now();
  const latestQuoteAt = rows
    .map((row) => Date.parse(row.quote_updated_at || row.last_trade_time || ""))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)[0] || now;
  const date = taipeiDateKey(new Date(latestQuoteAt));
  const normalized = rows
    .map((row) => {
      const code = String(row.symbol || "").trim();
      const close = cleanNumber(row.price);
      const percent = cleanNumber(row.change_percent);
      const volume = cleanNumber(row.volume_lots);
      const value = cleanNumber(row.trade_value_twd);
      if (!/^\d{4}$/.test(code) || !close) return null;
      const side = percent < 0 ? "short" : "long";
      const quoteAt = Date.parse(row.quote_updated_at || row.last_trade_time || "") || now;
      const quoteIso = new Date(quoteAt).toISOString();
      const quoteTime = taipeiTimeLabel(new Date(quoteAt));
      return {
        code,
        name: row.name || code,
        close,
        percent,
        pct: percent,
        open: cleanNumber(row.open_price),
        high: cleanNumber(row.high_price),
        low: cleanNumber(row.low_price),
        prevClose: cleanNumber(row.previous_close),
        volume,
        tradeVolume: volume,
        value,
        side,
        score: radarScore(row),
        flow: value * (side === "short" ? -1 : 1),
        signalTags: [side === "short" ? "短線轉弱" : "短線強勢", "Live報價"],
        tags: [side === "short" ? "短線轉弱" : "短線強勢", "Live報價"],
        signal: side === "short" ? "短線轉弱" : "短線強勢",
        state: side,
        reason: `${side === "short" ? "短線轉弱" : "短線強勢"} / Live報價`,
        time: quoteTime,
        quoteTime,
        updatedAt: quoteIso,
        latestSeenAt: quoteIso,
        radarUpdatedAt: quoteAt,
        radarDate: date,
        radarMode: "intraday",
        quoteSource: QUOTE_TABLE,
      };
    })
    .filter(Boolean)
    .sort((a, b) => cleanNumber(b.value) - cleanNumber(a.value))
    .slice(0, clampLimit(limit));
  return {
    ok: normalized.length > 0,
    runId: `quote-view-fallback-${date}-${latestQuoteAt}`,
    source: `supabase:${QUOTE_TABLE}`,
    cacheSource: "supabase-quote-view",
    date,
    tradeDate: date,
    usedDate: date,
    sourceDate: date,
    updatedAt: new Date(latestQuoteAt).toISOString(),
    updatedAtMs: latestQuoteAt,
    staleAfterMs: 90000,
    count: normalized.length,
    freshness: {
      decision: normalized.length ? "quote-view-fallback" : "no_quote_rows",
      reason: normalized.length ? "radar cache unavailable/stale; using formal realtime quote view" : "formal realtime quote view returned no rows",
      checkedAt: new Date(now).toISOString(),
      quoteCount: normalized.length,
    },
    rows: normalized,
    fallbackUsed: true,
    fallbackScope: ["fugle_realtime_quote_latest"],
    fallbackDetails: [{
      scope: "fugle_realtime_quote_latest",
      reason: normalized.length ? "radar cache unavailable/stale; using formal realtime quote view" : "formal realtime quote view returned no rows",
      quoteCount: normalized.length,
    }],
    transport: {
      source: "supabase",
      table: QUOTE_TABLE,
      via: "api/realtime-radar-latest",
      mode: "quote-view-fallback",
      fetchedAt: new Date(now).toISOString(),
    },
  };
}

async function fetchQuoteViewFallback(limit = DEFAULT_RADAR_LIMIT) {
  const quoteRows = await fetchSupabaseJson(`${QUOTE_TABLE}?select=symbol,name,market,price,open_price,high_price,low_price,previous_close,change_percent,volume_lots,trade_value_twd,last_trade_time,quote_updated_at&order=trade_value_twd.desc.nullslast&limit=${clampLimit(limit)}`);
  return quoteRowsToRadarPayload(Array.isArray(quoteRows) ? quoteRows : [], limit);
}

async function fetchSupabaseJson(pathAndQuery) {
  const upstream = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    cache: "no-store",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
  });
  const text = await upstream.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!upstream.ok) {
    const error = new Error(`HTTP ${upstream.status} ${text.slice(0, 160)}`.trim());
    error.status = upstream.status;
    error.body = text;
    throw error;
  }
  return json;
}

async function fetchRadarCachePayload() {
  const attempts = [
    {
      mode: "radar-cache-latest-id",
      query: `${TABLE}?id=eq.latest&select=payload,updated_at&limit=1`,
    },
    {
      mode: "radar-cache-latest-updated",
      query: `${TABLE}?select=payload,updated_at&order=updated_at.desc&limit=1`,
    },
  ];
  const errors = [];
  for (const attempt of attempts) {
    try {
      const rows = await fetchSupabaseJson(attempt.query);
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row?.payload) return { row, mode: attempt.mode, error: "" };
    } catch (error) {
      errors.push(`${attempt.mode}: ${error?.message || String(error)}`);
    }
  }
  return { row: null, mode: "", error: errors.join(" | ") };
}

function unavailablePayload(reason = "") {
  return {
    ok: false,
    error: "realtime_radar_supabase_unavailable",
    reason,
    cacheSource: "none",
    source: "api-only",
    tradeDate: taipeiDateKey(),
    usedDate: taipeiDateKey(),
    sourceDate: taipeiDateKey(),
    sourceCoverage: {
      ok: false,
      ready: false,
      status: "blocked",
      reason,
      tradeDate: taipeiDateKey(),
      today: taipeiDateKey(),
      checkedAt: new Date().toISOString(),
    },
    fallbackUsed: false,
    fallbackScope: [],
    fallbackDetails: [],
    count: 0,
    rows: [],
    transport: {
      source: "none",
      via: "api/realtime-radar-latest",
      gate: "api-only-no-static-fallback",
      fetchedAt: new Date().toISOString(),
    },
  };
}

function staleTradingDayPayload(payload, marketSession, reason = "trading_day_radar_cache_stale") {
  const runId = radarPayloadRunId(payload);
  return {
    ok: false,
    runId,
    error: "realtime_radar_stale",
    reason,
    cacheSource: payload?.cacheSource || "supabase-radar-cache",
    source: payload?.source || "api-only",
    tradeDate: payload?.tradeDate || payload?.usedDate || payload?.date || "",
    date: payload?.date || "",
    usedDate: payload?.usedDate || payload?.date || "",
    sourceDate: payload?.sourceDate || payload?.date || "",
    sourceCoverage: {
      ok: false,
      ready: false,
      status: "stale",
      reason,
      tradeDate: payload?.tradeDate || payload?.usedDate || payload?.date || "",
      today: marketSession?.today || taipeiDateKey(),
      updatedAt: payload?.updatedAt || "",
      checkedAt: new Date().toISOString(),
    },
    fallbackUsed: false,
    fallbackScope: [],
    fallbackDetails: [],
    updatedAt: payload?.updatedAt || "",
    updatedAtMs: payload?.updatedAtMs || 0,
    count: 0,
    totalCount: Array.isArray(payload?.rows) ? payload.rows.length : 0,
    rows: [],
    staleCache: {
      marketDataDate: marketSession?.marketDataDate || "",
      today: marketSession?.today || "",
      updatedAt: payload?.updatedAt || "",
      status: payload?.status || "",
      rowCount: Array.isArray(payload?.rows) ? payload.rows.length : 0,
    },
    freshness: {
      decision: "stale",
      reason,
      checkedAt: new Date().toISOString(),
      marketDataDate: marketSession?.marketDataDate || "",
      today: marketSession?.today || "",
    },
    transport: {
      source: "supabase",
      table: TABLE,
      runId,
      payloadRunId: runId,
      via: "api/realtime-radar-latest",
      gate: "trading-day-stale-cache-blocked",
      fetchedAt: new Date().toISOString(),
    },
  };
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
    const requestedLimit = requestRadarLimit(request);
    const tradingDay = await isTwseTradingDay(new Date(), {
      stateDir: process.env.FUMAN_STATE_DIR || path.join("/tmp", "fuman-state"),
    });

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      const payload = unavailablePayload("supabase_not_configured");
      const session = buildMarketSession(tradingDay, payload);
      response.status(503).json(withMarketSession(payload, session, "supabase_not_configured", requestedLimit));
      return;
    }

    const radarCache = await fetchRadarCachePayload();
    const row = radarCache.row;
    let primaryError = radarCache.error || "";

    if (!tradingDay.isTradingDay) {
      if (!row?.payload) {
        const payload = unavailablePayload(primaryError || "non_trading_day_supabase_cache_empty");
        const session = buildMarketSession(tradingDay, payload);
        response.status(503).json(withMarketSession(payload, session, "non_trading_day_supabase_cache_empty", requestedLimit));
        return;
      }
      const payload = {
        ...row.payload,
        updatedAt: row.payload.updatedAt || row.updated_at,
        cacheSource: "supabase-radar-cache",
        transport: {
          source: "supabase",
          table: TABLE,
          mode: radarCache.mode,
        },
      };
      const session = buildMarketSession(tradingDay, payload);
      response.status(200).json(withMarketSession(payload, session, "non-trading-day-cache", requestedLimit));
      return;
    }

    if (!row?.payload) {
      try {
        const quotePayload = await fetchQuoteViewFallback(requestedLimit);
        if (quotePayload.rows.length) {
          const session = buildMarketSession(tradingDay, quotePayload);
          response.status(200).json(withMarketSession(quotePayload, session, "", requestedLimit));
          return;
        }
      } catch (error) {
        primaryError = [primaryError, error?.message || String(error)].filter(Boolean).join(" | ");
      }
      const payload = unavailablePayload(primaryError || "realtime_radar_latest_empty");
      const session = buildMarketSession(tradingDay, payload);
      response.status(503).json(withMarketSession(payload, session, "realtime_radar_latest_empty", requestedLimit));
      return;
    }

    const payload = {
      ...row.payload,
      updatedAt: row.payload.updatedAt || row.updated_at,
      cacheSource: "supabase-radar-cache",
      transport: {
        source: "supabase",
        table: TABLE,
        via: "api/realtime-radar-latest",
        mode: radarCache.mode,
        fetchedAt: new Date().toISOString(),
      },
    };
    const session = buildMarketSession(tradingDay, payload);
    if (!isTradingDayPayloadFresh(session, payload)) {
      const stalePayload = {
        ...payload,
        ok: false,
        status: payload.status === "ok" ? "degraded" : payload.status || "degraded",
        reason: primaryError || "trading_day_radar_cache_stale",
        freshness: {
          ...(payload.freshness || {}),
          decision: "degraded",
          reason: primaryError || "trading_day_radar_cache_stale",
          checkedAt: new Date().toISOString(),
          marketDataDate: session?.marketDataDate || "",
          today: session?.today || "",
        },
      };
      response.status(200).json(withMarketSession(stalePayload, session, stalePayload.reason, requestedLimit));
      return;
    }
    response.status(200).json(withMarketSession(payload, session, "", requestedLimit));
  } catch (error) {
    const payload = unavailablePayload(error?.message || String(error));
    const session = buildMarketSession({ isTradingDay: false, reason: "trading-day-check-failed", source: "api-only" }, payload);
    response.status(503).json(withMarketSession(payload, session, "realtime_radar_api_error", DEFAULT_RADAR_LIMIT));
  }
};
