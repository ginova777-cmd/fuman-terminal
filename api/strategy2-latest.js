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

const LATEST_RUN_VIEW = process.env.STRATEGY2_SUPABASE_LATEST_RUN_VIEW || "v_strategy2_latest_complete_run";
const LATEST_TABLE = process.env.STRATEGY2_SUPABASE_LATEST_TABLE || "strategy2_latest";

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

async function fetchCompleteRunPayload(base) {
  const rows = await fetchRows(
    base,
    LATEST_RUN_VIEW,
    [
      "select=*",
      "strategy=eq.strategy2",
      "status=eq.complete",
      "complete=eq.true",
      "limit=1",
    ].join("&")
  );
  const run = rows[0];
  if (!run?.run_id || !run?.payload) return null;
  return {
    ...run.payload,
    updatedAt: run.payload.updatedAt || run.updated_at || run.finished_at,
    runId: run.payload.runId || run.run_id,
    complete: true,
    qualityStatus: run.payload.qualityStatus || run.quality_status || "complete",
    cacheSource: "supabase-api",
    transport: {
      source: "supabase",
      latestRunView: LATEST_RUN_VIEW,
      gate: "run_id",
      runId: run.run_id,
      via: "api/strategy2-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

async function fetchLatestRowPayload(base) {
  const rows = await fetchRows(base, LATEST_TABLE, "id=eq.latest&select=payload,updated_at,run_id&limit=1");
  const row = rows[0];
  if (!row?.payload) return null;
  return {
    ...row.payload,
    updatedAt: row.payload.updatedAt || row.updated_at,
    runId: row.payload.runId || row.run_id || "",
    cacheSource: row.run_id ? "supabase-api" : "supabase-latest-fallback",
    transport: {
      source: "supabase",
      table: LATEST_TABLE,
      gate: row.run_id ? "latest-run-id" : "latest-row-no-run-id",
      runId: row.run_id || "",
      via: "api/strategy2-latest",
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
    const base = String(SUPABASE_URL || "").replace(/\/+$/, "");
    if (!base || !SUPABASE_KEY) {
      response.status(200).json(staticFallback("supabase_not_configured"));
      return;
    }
    const completeRun = await fetchCompleteRunPayload(base).catch(() => null);
    if (completeRun) {
      response.status(200).json(completeRun);
      return;
    }
    const latestRow = await fetchLatestRowPayload(base);
    if (!latestRow) {
      response.status(200).json(staticFallback("strategy2_latest_empty"));
      return;
    }
    response.status(200).json(latestRow);
  } catch (error) {
    response.status(200).json(staticFallback(error?.message || String(error)));
  }
};
