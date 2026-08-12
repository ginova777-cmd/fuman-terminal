"use strict";

const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const TABLE = process.env.FUMAN_DAILY_KLINE_TABLE || "strategy4_daily_ohlcv_view";
const DEFAULT_LIMIT = 180;
const MAX_LIMIT = 260;

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCode(value) {
  return String(value || "").trim().match(/^\d{4}$/)?.[0] || "";
}

function normalizeLimit(value) {
  const parsed = Math.floor(numeric(value));
  return Math.min(MAX_LIMIT, Math.max(60, parsed || DEFAULT_LIMIT));
}

function normalizeBar(row) {
  const tradeDate = String(row?.trade_date || "").slice(0, 10);
  const open = numeric(row?.open);
  const high = numeric(row?.high);
  const low = numeric(row?.low);
  const close = numeric(row?.close);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate) || !open || !high || !low || !close || high < Math.max(open, close) || low > Math.min(open, close)) return null;
  return {
    date: tradeDate,
    open,
    high,
    low,
    close,
    volumeLots: numeric(row?.volume_lots),
    volumeShares: numeric(row?.volume_shares),
    source: String(row?.source || ""),
  };
}

module.exports = async (request, response) => {
  if (request.method && request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }
  const code = normalizeCode(request.query?.code);
  if (!code) {
    response.status(400).json({ ok: false, error: "invalid_stock_code" });
    return;
  }
  const limit = normalizeLimit(request.query?.limit);
  const base = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
  const key = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });
  if (!base || !key) {
    response.status(503).json({ ok: false, error: "daily_kline_source_unavailable" });
    return;
  }

  try {
    const url = new URL(`/rest/v1/${encodeURIComponent(TABLE)}`, base);
    url.searchParams.set("select", "symbol,name,market,trade_date,open,high,low,close,volume_lots,volume_shares,source,updated_at");
    url.searchParams.set("symbol", `eq.${code}`);
    url.searchParams.set("order", "trade_date.desc");
    url.searchParams.set("limit", String(limit));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let upstream;
    try {
      upstream = await fetch(url, {
        signal: controller.signal,
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await upstream.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch {}
    if (!upstream.ok || !Array.isArray(body)) {
      response.status(502).json({ ok: false, error: "daily_kline_source_read_failed", detail: String(text || upstream.status).slice(0, 160) });
      return;
    }
    const bars = body.map(normalizeBar).filter(Boolean).sort((left, right) => left.date.localeCompare(right.date));
    if (bars.length < 20) {
      response.status(404).json({ ok: false, error: "daily_kline_insufficient_ohlc", code, count: bars.length });
      return;
    }
    const latest = bars[bars.length - 1];
    response.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=300");
    response.status(200).json({
      ok: true,
      contract: "terminal-daily-kline-v1",
      code,
      source: `supabase:${TABLE}`,
      latestDate: latest.date,
      count: bars.length,
      bars,
    });
  } catch (error) {
    response.status(502).json({ ok: false, error: "daily_kline_fetch_failed", detail: String(error?.message || error).slice(0, 160) });
  }
};
