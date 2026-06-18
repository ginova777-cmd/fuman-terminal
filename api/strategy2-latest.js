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
      gate: "run_id",
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
    const completeRun = await fetchCompleteRunPayload(base);
    if (completeRun) {
      response.status(200).json(completeRun);
      return;
    }
    response.status(404).json(apiOnlyError("strategy2_complete_run_empty"));
  } catch (error) {
    response.status(503).json(apiOnlyError("strategy2_api_only_failed", error?.message || String(error)));
  }
};
