const fs = require("fs");
const path = require("path");

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || "https://cpmpfhbzutkiecccekfr.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-anon-key.txt"));

function staticFallback(reason = "") {
  try {
    const payload = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "strategy2-intraday-latest.json"), "utf8"));
    return {
      ...payload,
      cacheSource: "static-fallback",
      transport: {
        source: "static-json",
        via: "api/strategy2-latest",
        fallbackReason: reason,
        fetchedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    return { ok: false, error: "strategy2_static_fallback_failed", detail: error?.message || String(error) };
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
    const base = String(SUPABASE_URL || "").replace(/\/+$/, "");
    if (!base || !SUPABASE_KEY) {
      response.status(200).json(staticFallback("supabase_not_configured"));
      return;
    }
    const url = `${base}/rest/v1/strategy2_latest?id=eq.latest&select=payload,updated_at&limit=1`;
    const upstream = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: "application/json",
      },
    });
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      response.status(200).json(staticFallback(`supabase_fetch_failed HTTP ${upstream.status} ${text.slice(0, 120)}`));
      return;
    }
    const rows = await upstream.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row?.payload) {
      response.status(200).json(staticFallback("strategy2_latest_empty"));
      return;
    }
    response.status(200).json({
      ...row.payload,
      updatedAt: row.payload.updatedAt || row.updated_at,
      cacheSource: "supabase-api",
      transport: {
        source: "supabase",
        via: "api/strategy2-latest",
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    response.status(200).json(staticFallback(error?.message || String(error)));
  }
};
