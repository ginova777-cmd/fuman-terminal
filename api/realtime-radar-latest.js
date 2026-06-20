const fs = require("fs");
const path = require("path");
const { isTwseTradingDay } = require("../scripts/twse-trading-day");

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = String(
  process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-url.txt"))
  || "https://cpmpfhbzutkiecccekfr.supabase.co"
).replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-anon-key.txt"))
  || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwbXBmaGJ6dXRraWVjY2Nla2ZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNDQ0NDYsImV4cCI6MjA5NjYyMDQ0Nn0.8vQ0vICktypLNyDu4MJuXiNZMY0w0op2dtijji-qlFU";
const TABLE = process.env.FUMAN_REALTIME_RADAR_TABLE || "fuman_realtime_radar_cache";

const QUOTE_TABLE = process.env.FUMAN_REALTIME_QUOTE_TABLE || "fugle_realtime_quote_latest";

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,％%]/g, ""));
  return Number.isFinite(number) ? number : 0;
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

function withMarketSession(payload, marketSession, reason = "") {
  return {
    ...payload,
    reason: reason || payload?.reason,
    marketSession,
    transport: {
      ...(payload?.transport || {}),
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

function quoteRowsToRadarPayload(rows = []) {
  const now = Date.now();
  const date = taipeiDateKey();
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
        radarUpdatedAt: quoteAt,
        radarDate: date,
        radarMode: "intraday",
        quoteSource: QUOTE_TABLE,
      };
    })
    .filter(Boolean)
    .sort((a, b) => cleanNumber(b.value) - cleanNumber(a.value))
    .slice(0, 120);
  return {
    ok: normalized.length > 0,
    source: `supabase:${QUOTE_TABLE}`,
    cacheSource: "supabase-quote-view",
    date,
    updatedAt: new Date(now).toISOString(),
    updatedAtMs: now,
    count: normalized.length,
    rows: normalized,
    transport: {
      source: "supabase",
      table: QUOTE_TABLE,
      via: "api/realtime-radar-latest",
      mode: "quote-view-fallback",
      fetchedAt: new Date(now).toISOString(),
    },
  };
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

function staticFallback(reason = "") {
  try {
    const payload = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "realtime-radar-latest.json"), "utf8"));
    return {
      ...payload,
      cacheSource: "static-fallback",
      transport: {
        source: "static-json",
        via: "api/realtime-radar-latest",
        fallbackReason: reason,
        fetchedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    return { ok: false, error: "realtime_radar_static_fallback_failed", detail: error?.message || String(error) };
  }
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
    const tradingDay = await isTwseTradingDay(new Date(), {
      stateDir: process.env.FUMAN_STATE_DIR || path.join("/tmp", "fuman-state"),
    });

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      const payload = staticFallback("supabase_not_configured");
      const session = buildMarketSession(tradingDay, payload);
      response.status(200).json(withMarketSession(payload, session, session.closed ? "non-trading-day-cache" : "supabase_not_configured"));
      return;
    }

    const radarCache = await fetchRadarCachePayload();
    const row = radarCache.row;
    let primaryError = radarCache.error || "";

    if (!tradingDay.isTradingDay) {
      const payload = row?.payload ? {
        ...row.payload,
        updatedAt: row.payload.updatedAt || row.updated_at,
        cacheSource: "supabase-radar-cache",
        transport: {
          source: "supabase",
          table: TABLE,
          mode: radarCache.mode,
        },
      } : staticFallback(primaryError || "non_trading_day_static_fallback");
      const session = buildMarketSession(tradingDay, payload);
      response.status(200).json(withMarketSession(payload, session, "non-trading-day-cache"));
      return;
    }

    if (!row?.payload) {
      try {
        const quoteRows = await fetchSupabaseJson(`${QUOTE_TABLE}?select=symbol,name,market,price,open_price,high_price,low_price,previous_close,change_percent,volume_lots,trade_value_twd,last_trade_time,quote_updated_at&order=trade_value_twd.desc.nullslast&limit=120`);
        const quotePayload = quoteRowsToRadarPayload(Array.isArray(quoteRows) ? quoteRows : []);
        if (quotePayload.rows.length) {
          const session = buildMarketSession(tradingDay, quotePayload);
          response.status(200).json(withMarketSession(quotePayload, session));
          return;
        }
      } catch (error) {
        primaryError = [primaryError, error?.message || String(error)].filter(Boolean).join(" | ");
      }
      const payload = staticFallback(primaryError || "realtime_radar_latest_empty");
      const session = buildMarketSession(tradingDay, payload);
      response.status(200).json(withMarketSession(payload, session));
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
    response.status(200).json(withMarketSession(payload, session));
  } catch (error) {
    const payload = staticFallback(error?.message || String(error));
    const session = buildMarketSession({ isTradingDay: false, reason: "trading-day-check-failed", source: "fallback" }, payload);
    response.status(200).json(withMarketSession(payload, session, "non-trading-day-cache"));
  }
};
