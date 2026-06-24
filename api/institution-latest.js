const fs = require("fs");
const path = require("path");
const { readEndpointFromDesktopSnapshot } = require("../lib/desktop-route-snapshot-cache");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });

const TABLE = process.env.INSTITUTION_SUPABASE_RESULTS_TABLE || "institution_scan_results";
const LATEST_RUN_VIEW = process.env.INSTITUTION_SUPABASE_LATEST_RUN_VIEW || "v_institution_latest_complete_run";

function apiOnlyError(reason = "") {
  return {
    ok: false,
    error: "institution_api_only_unavailable",
    detail: reason,
    cacheSource: "none",
    data: {},
    rows: [],
    transport: {
      source: "supabase",
      latestRunView: LATEST_RUN_VIEW,
      gate: "complete-run-readback",
      via: "api/institution-latest",
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

function readRequestOptions(request) {
  try {
    const url = new URL(request.url, `https://${request.headers.host || "localhost"}`);
    const canvas = url.searchParams.get("canvas") === "1";
    const compact = url.searchParams.get("compact") === "1" || url.searchParams.get("shell") === "1";
    const smallPayload = canvas || compact;
    const limit = Math.max(1, Math.min(smallPayload ? 120 : 3000, cleanNumber(url.searchParams.get("limit")) || (smallPayload ? 80 : 3000)));
    return { canvas, compact, smallPayload, limit };
  } catch {
    return { canvas: false, compact: false, smallPayload: false, limit: 3000 };
  }
}

function normalizeRow(row) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  return {
    ...payload,
    code: String(payload.code || row.code || "").trim(),
    name: String(payload.name || row.name || row.code || "").trim(),
    close: cleanNumber(payload.close || row.close),
    percent: cleanNumber(payload.percent ?? row.change_percent),
    tradeVolume: cleanNumber(payload.tradeVolume || row.trade_volume),
    value: cleanNumber(payload.value || row.trade_value),
    foreign: cleanNumber(payload.foreign ?? row.foreign_net),
    trust: cleanNumber(payload.trust ?? row.trust_net),
    dealer: cleanNumber(payload.dealer ?? row.dealer_net),
    total: cleanNumber(payload.total ?? row.total_net),
  };
}

function buildPayload(rows, run, options = {}) {
  const sorted = rows
    .slice()
    .sort((a, b) => cleanNumber(a.rank) - cleanNumber(b.rank) || String(a.code).localeCompare(String(b.code)))
    .map(normalizeRow);
  const outputRows = options.smallPayload ? sorted.slice(0, options.limit || 80) : sorted;
  const data = Object.fromEntries(outputRows.map((row) => [row.code, row]).filter(([code]) => code));
  const scanDate = String(run?.scan_date || rows[0]?.scan_date || "").replace(/-/g, "");
  const expectedTotal = cleanNumber(run?.expected_total);
  const scannedCount = cleanNumber(run?.scanned_count);
  const resultCount = cleanNumber(run?.result_count) || sorted.length;
  return {
    ok: true,
    source: "supabase:institution_scan_results",
    cacheSource: "supabase-api",
    runId: String(run?.run_id || rows[0]?.run_id || ""),
    updatedAt: String(run?.finished_at || rows[0]?.updated_at || new Date().toISOString()),
    usedDate: run?.payload?.usedDate || scanDate,
    quoteUpdatedAt: run?.payload?.quoteUpdatedAt || "",
    complete: true,
    qualityStatus: String(run?.quality_status || rows[0]?.quality_status || "complete"),
    schemaVersion: String(run?.schema_version || rows[0]?.schema_version || "institution-run-id-complete-v1"),
    dataContractSource: String(run?.data_contract_source || rows[0]?.data_contract_source || "institution-cache"),
    count: resultCount,
    returnedCount: outputRows.length,
    canvas: Boolean(options.canvas),
    compact: Boolean(options.compact),
    data,
    rows: outputRows,
    sourceHealth: run?.payload?.sourceHealth || {},
    readback: {
      expectedTotal,
      scannedCount,
      resultCount,
      rowCount: sorted.length,
    },
    transport: {
      source: "supabase",
      table: TABLE,
      latestRunView: LATEST_RUN_VIEW,
      gate: "complete-run-readback",
      runId: String(run?.run_id || rows[0]?.run_id || ""),
      via: "api/institution-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

async function fetchLatestCompleteRun() {
  const rows = await fetchRowsFrom(
    LATEST_RUN_VIEW,
    [
      "select=*",
      "strategy=eq.institution",
      "status=eq.complete",
      "complete=eq.true",
      "limit=1",
    ].join("&")
  );
  return rows[0]?.run_id ? rows[0] : null;
}

function validateCompleteRun(run) {
  if (!run?.run_id) throw new Error("institution_complete_run_missing");
  if (String(run.status || "") !== "complete" || run.complete !== true) throw new Error("institution_complete_run_not_complete");
  const expectedTotal = cleanNumber(run.expected_total);
  const scannedCount = cleanNumber(run.scanned_count);
  const resultCount = cleanNumber(run.result_count);
  if (expectedTotal <= 0) throw new Error("institution_expected_total_missing");
  if (scannedCount <= 0) throw new Error("institution_scanned_count_missing");
  if (expectedTotal !== scannedCount) throw new Error(`institution_scan_incomplete:${scannedCount}/${expectedTotal}`);
  if (resultCount <= 0) throw new Error("institution_result_count_missing");
}

function validateReadback(rows, run) {
  const resultCount = cleanNumber(run?.result_count);
  if (!rows.length) throw new Error("institution_complete_run_empty");
  if (resultCount > 0 && rows.length !== resultCount) {
    throw new Error(`institution_readback_count_mismatch:${rows.length}/${resultCount}`);
  }
  const incomplete = rows.find((row) => row.complete === false || String(row.quality_status || "complete") !== "complete");
  if (incomplete) throw new Error(`institution_readback_incomplete_row:${incomplete.code || ""}`);
}

async function fetchLatestCompleteRows() {
  const run = await fetchLatestCompleteRun();
  if (!run?.run_id) return { rows: [], run: null };
  validateCompleteRun(run);
  const rows = await fetchRowsFrom(
    TABLE,
    [
      "select=run_id,scan_date,code,name,close,change_percent,trade_volume,trade_value,foreign_net,trust_net,dealer_net,total_net,rank,reason,payload,complete,quality_status,schema_version,data_contract_source,generated_at,updated_at",
      "strategy=eq.institution",
      `run_id=eq.${encodeURIComponent(run.run_id)}`,
      "order=rank.asc",
      "limit=3000",
    ].join("&")
  );
  validateReadback(rows, run);
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

  const cached = await readEndpointFromDesktopSnapshot(request, {
    timeoutMs: 650,
    via: "api/institution-latest",
  });
  if (cached) {
    response.status(200).json(cached);
    return;
  }

  try {
    const options = readRequestOptions(request);
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      response.status(503).json(apiOnlyError("supabase_not_configured"));
      return;
    }
    const latest = await fetchLatestCompleteRows();
    if (!latest.rows.length) {
      response.status(404).json(apiOnlyError("institution_scan_results_latest_empty"));
      return;
    }
    response.status(200).json(buildPayload(latest.rows, latest.run, options));
  } catch (error) {
    response.status(503).json(apiOnlyError(error?.message || String(error)));
  }
};
