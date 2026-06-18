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

const TABLE = process.env.STRATEGY5_SUPABASE_RESULTS_TABLE || "strategy5_scan_results";
const LATEST_RUN_VIEW = process.env.STRATEGY5_SUPABASE_LATEST_RUN_VIEW || "v_strategy5_latest_complete_run";

function apiOnlyError(reason = "") {
  return {
    ok: false,
    error: "strategy5_api_only_unavailable",
    detail: reason,
    cacheSource: "none",
    matches: [],
    transport: {
      source: "supabase",
      latestRunView: LATEST_RUN_VIEW,
      gate: "run_id",
      via: "api/strategy5-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
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

function normalizePayload(row) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const matches = Array.isArray(payload.matches || row.signals) ? (payload.matches || row.signals) : [];
  return {
    ...payload,
    code: String(payload.code || row.code || "").trim(),
    name: String(payload.name || row.name || row.code || "").trim(),
    close: cleanNumber(payload.close || payload.price || row.close || row.price),
    price: cleanNumber(payload.price || payload.close || row.price || row.close),
    percent: cleanNumber(payload.percent ?? payload.changePercent ?? row.change_percent),
    tradeVolume: cleanNumber(payload.tradeVolume || payload.volume || row.trade_volume || row.volume),
    volume: cleanNumber(payload.volume || payload.tradeVolume || row.volume || row.trade_volume),
    value: cleanNumber(payload.value || payload.tradeValue || row.trade_value),
    tradeValue: cleanNumber(payload.tradeValue || payload.value || row.trade_value),
    score: cleanNumber(payload.score || row.score),
    matches,
    activeMatch: payload.activeMatch || matches[0] || null,
    reason: String(payload.reason || row.reason || matches.map((signal) => signal.reason).filter(Boolean).join("；")).trim(),
  };
}

function buildPayload(rows, run) {
  const first = rows[0] || {};
  const matches = rows
    .slice()
    .sort((a, b) => cleanNumber(a.rank) - cleanNumber(b.rank) || String(a.code).localeCompare(String(b.code)))
    .map(normalizePayload);
  const scanDate = String(first.scan_date || run?.scan_date || "").replace(/-/g, "");
  return {
    ok: true,
    source: "supabase:strategy5_scan_results",
    cacheSource: "supabase-api",
    runId: String(first.run_id || run?.run_id || ""),
    updatedAt: String(run?.finished_at || first.updated_at || new Date().toISOString()),
    generatedDate: scanDate,
    usedDate: run?.payload?.usedDate || scanDate,
    sourceDate: run?.payload?.sourceDate || run?.payload?.usedDate || scanDate,
    schedule: run?.payload?.schedule || "06:00/21:00",
    fullScan: true,
    complete: true,
    qualityStatus: String(first.quality_status || run?.quality_status || "complete"),
    schemaVersion: String(first.schema_version || run?.schema_version || "strategy5-run-id-complete-v1"),
    dataContractSource: String(first.data_contract_source || run?.data_contract_source || "strategy5-cache"),
    total: Math.max(matches.length, cleanNumber(run?.expected_total)),
    scannedThisRun: cleanNumber(run?.scanned_count) || matches.length,
    count: matches.length,
    sourceHealth: run?.payload?.sourceHealth || {},
    matches,
    transport: {
      source: "supabase",
      table: TABLE,
      latestRunView: LATEST_RUN_VIEW,
      gate: "run_id",
      runId: String(first.run_id || run?.run_id || ""),
      via: "api/strategy5-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

async function fetchLatestCompleteRun() {
  const rows = await fetchRowsFrom(
    LATEST_RUN_VIEW,
    [
      "select=*",
      "strategy=eq.strategy5",
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
      "select=run_id,scan_date,code,name,price,close,change_percent,volume,trade_volume,trade_value,score,rank,reason,signals,payload,complete,quality_status,schema_version,data_contract_source,generated_at,updated_at",
      "strategy=eq.strategy5",
      `run_id=eq.${encodeURIComponent(run.run_id)}`,
      "order=rank.asc",
      "limit=2000",
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
      response.status(503).json(apiOnlyError("supabase_not_configured"));
      return;
    }
    const latest = await fetchLatestCompleteRows();
    if (!latest.rows.length) {
      response.status(404).json(apiOnlyError("strategy5_scan_results_latest_empty"));
      return;
    }
    response.status(200).json(buildPayload(latest.rows, latest.run));
  } catch (error) {
    response.status(503).json(apiOnlyError(error?.message || String(error)));
  }
};
