const fs = require("fs");
const path = require("path");

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = String(
  process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || "https://cpmpfhbzutkiecccekfr.supabase.co"
).replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-anon-key.txt"));

const TABLE = process.env.WARRANT_FLOW_SUPABASE_RESULTS_TABLE || "warrant_flow_scan_results";
const LATEST_RUN_VIEW = process.env.WARRANT_FLOW_SUPABASE_LATEST_RUN_VIEW || "v_warrant_flow_latest_complete_run";

function staticFallback(reason = "") {
  try {
    const payload = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "warrant-flow-latest.json"), "utf8"));
    return {
      ...payload,
      cacheSource: "static-fallback",
      transport: {
        source: "static-json",
        via: "api/warrant-flow-latest",
        fallbackReason: reason,
        fetchedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    return { ok: false, error: "warrant_flow_static_fallback_failed", detail: error?.message || String(error) };
  }
}

async function fetchRowsFrom(table, query) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${table} HTTP ${response.status} ${text.slice(0, 180)}`.trim());
  }
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function normalizeRow(row) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  return {
    ...payload,
    code: String(payload.code || row.underlying_code || row.code || "").trim(),
    name: String(payload.name || row.underlying_name || row.name || "").trim(),
    underlyingCode: String(payload.underlyingCode || row.underlying_code || payload.code || "").trim(),
    underlyingName: String(payload.underlyingName || row.underlying_name || payload.name || "").trim(),
    close: cleanNumber(payload.close || payload.displayClose || payload.underlyingClose || row.close),
    percent: cleanNumber(payload.percent ?? payload.displayPercent ?? payload.underlyingPercent ?? row.change_percent),
    value: cleanNumber(payload.value || payload.callValue || row.trade_value),
    finalScore: cleanNumber(payload.finalScore || payload.score || row.score),
    score: cleanNumber(payload.score || payload.finalScore || row.score),
    reason: String(payload.reason || row.reason || "").trim(),
  };
}

function buildPayload(rows, run) {
  const byType = (type) => rows
    .filter((row) => String(row.result_type || "match") === type)
    .sort((a, b) => cleanNumber(a.rank) - cleanNumber(b.rank) || String(a.code).localeCompare(String(b.code)))
    .map(normalizeRow);
  const matches = byType("match");
  const volumeMatches = byType("volume");
  const singleSignals = byType("single");
  const scanDate = String(run?.scan_date || rows[0]?.scan_date || "").replace(/-/g, "");
  return {
    ok: true,
    source: "supabase:warrant_flow_scan_results",
    cacheSource: "supabase-api",
    runId: String(run?.run_id || rows[0]?.run_id || ""),
    updatedAt: String(run?.finished_at || rows[0]?.updated_at || new Date().toISOString()),
    tradeDate: run?.payload?.tradeDate || scanDate,
    sourceDate: run?.payload?.sourceDate || scanDate,
    complete: true,
    qualityStatus: String(run?.quality_status || rows[0]?.quality_status || "complete"),
    schemaVersion: String(run?.schema_version || rows[0]?.schema_version || "warrant-flow-run-id-complete-v1"),
    dataContractSource: String(run?.data_contract_source || rows[0]?.data_contract_source || "warrant-flow-cache"),
    count: matches.length,
    matches,
    volumeCount: volumeMatches.length,
    volumeMatches,
    singleSignalCount: singleSignals.length,
    singleSignals,
    transport: {
      source: "supabase",
      table: TABLE,
      latestRunView: LATEST_RUN_VIEW,
      gate: "run_id",
      runId: String(run?.run_id || rows[0]?.run_id || ""),
      via: "api/warrant-flow-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

async function fetchLatestCompleteRun() {
  const rows = await fetchRowsFrom(
    LATEST_RUN_VIEW,
    [
      "select=*",
      "strategy=eq.warrant_flow",
      "status=eq.complete",
      "complete=eq.true",
      "limit=1",
    ].join("&")
  );
  return rows[0]?.run_id ? rows[0] : null;
}

async function fetchLatestCompleteRows() {
  const run = await fetchLatestCompleteRun();
  if (!run?.run_id) return { rows: [], run: null };
  const rows = await fetchRowsFrom(
    TABLE,
    [
      "select=run_id,scan_date,result_type,code,name,underlying_code,underlying_name,close,change_percent,trade_value,score,rank,reason,payload,complete,quality_status,schema_version,data_contract_source,generated_at,updated_at",
      "strategy=eq.warrant_flow",
      `run_id=eq.${encodeURIComponent(run.run_id)}`,
      "order=result_type.asc,rank.asc",
      "limit=3000",
    ].join("&")
  );
  return { rows, run };
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
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      response.status(200).json(staticFallback("supabase_not_configured"));
      return;
    }
    const latest = await fetchLatestCompleteRows();
    if (!latest.rows.length) {
      response.status(200).json(staticFallback("warrant_flow_scan_results_latest_empty"));
      return;
    }
    response.status(200).json(buildPayload(latest.rows, latest.run));
  } catch (error) {
    response.status(200).json(staticFallback(error?.message || String(error)));
  }
};
