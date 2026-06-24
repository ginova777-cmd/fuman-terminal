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

const TABLE = process.env.STRATEGY5_SUPABASE_RESULTS_TABLE || "strategy5_scan_results";
const LATEST_RUN_VIEW = process.env.STRATEGY5_SUPABASE_LATEST_RUN_VIEW || "v_strategy5_latest_complete_run";
const COMPLETE_RUN_GATE = "complete-run-authoritative+result-readback";

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
      gate: COMPLETE_RUN_GATE,
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

async function fetchRowsWithCount(table, query) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
      Prefer: "count=exact",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${table} HTTP ${response.status} ${text.slice(0, 180)}`.trim());
  }
  const rows = await response.json();
  const contentRange = response.headers.get("content-range") || "";
  const exactCount = Number(contentRange.split("/").pop());
  return {
    rows: Array.isArray(rows) ? rows : [],
    exactCount: Number.isFinite(exactCount) ? exactCount : null,
  };
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function parseRequestOptions(request) {
  try {
    const url = new URL(request.url || "", "http://localhost");
    const canvas = url.searchParams.get("canvas") === "1"
      || url.searchParams.get("compact") === "1"
      || url.searchParams.get("shell") === "1";
    const limit = Math.max(1, Math.min(canvas ? 120 : 2000, cleanNumber(url.searchParams.get("limit")) || (canvas ? 70 : 2000)));
    return { canvas, limit };
  } catch {
    return { canvas: false, limit: 2000 };
  }
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

function buildPayload(rows, run, options = {}) {
  const first = rows[0] || {};
  const expectedTotal = cleanNumber(run?.expected_total);
  const scannedCount = cleanNumber(run?.scanned_count);
  const resultCount = cleanNumber(run?.result_count) || rows.length;
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
    canvas: Boolean(options.canvas),
    qualityStatus: String(first.quality_status || run?.quality_status || "complete"),
    schemaVersion: String(first.schema_version || run?.schema_version || "strategy5-run-id-complete-v1"),
    dataContractSource: String(first.data_contract_source || run?.data_contract_source || "strategy5-cache"),
    expectedTotal,
    scannedCount,
    resultCount,
    total: Math.max(matches.length, expectedTotal),
    scannedThisRun: scannedCount || matches.length,
    count: resultCount,
    returnedCount: matches.length,
    sourceHealth: run?.payload?.sourceHealth || {},
    matches,
    transport: {
      source: "supabase",
      table: TABLE,
      latestRunView: LATEST_RUN_VIEW,
      gate: COMPLETE_RUN_GATE,
      runId: String(first.run_id || run?.run_id || ""),
      resultReadbackCount: cleanNumber(run?.readback_count),
      via: "api/strategy5-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

function validateCompleteRun(run, readbackCount, options = {}) {
  const requireReadback = options.requireReadback !== false;
  if (!run?.run_id) return "strategy5_complete_run_missing";
  if (String(run.status || "") !== "complete" || run.complete !== true) return "strategy5_complete_run_not_complete";
  const expectedTotal = cleanNumber(run.expected_total);
  const scannedCount = cleanNumber(run.scanned_count);
  const resultCount = cleanNumber(run.result_count);
  if (expectedTotal <= 0) return "strategy5_expected_total_empty";
  if (scannedCount <= 0) return "strategy5_scanned_count_empty";
  if (expectedTotal !== scannedCount) return "strategy5_incomplete_scan_count";
  if (resultCount <= 0) return "strategy5_result_count_empty";
  if (!requireReadback) return "";
  if (!Number.isFinite(readbackCount)) return "strategy5_result_readback_unavailable";
  if (Number.isFinite(readbackCount) && readbackCount !== resultCount) return "strategy5_result_readback_mismatch";
  return "";
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

async function fetchLatestCompleteRows(limit = 2000) {
  const run = await fetchLatestCompleteRun();
  const runIssue = validateCompleteRun(run, null, { requireReadback: false });
  if (runIssue) return { rows: [], run, gate: runIssue };
  const result = await fetchRowsWithCount(
    TABLE,
    [
      "select=run_id,scan_date,code,name,price,close,change_percent,volume,trade_volume,trade_value,score,rank,reason,signals,payload,complete,quality_status,schema_version,data_contract_source,generated_at,updated_at",
      "strategy=eq.strategy5",
      `run_id=eq.${encodeURIComponent(run.run_id)}`,
      "complete=eq.true",
      "order=rank.asc",
      `limit=${Math.max(1, Math.min(2000, cleanNumber(limit) || 2000))}`,
    ].join("&")
  );
  const readbackCount = result.exactCount;
  const readbackIssue = validateCompleteRun(run, readbackCount);
  if (readbackIssue) return { rows: [], run: { ...run, readback_count: readbackCount }, gate: readbackIssue };
  return { rows: result.rows, run: { ...run, readback_count: readbackCount }, gate: COMPLETE_RUN_GATE };
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
    via: "api/strategy5-latest",
  });
  if (cached) {
    response.status(200).json(cached);
    return;
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      response.status(503).json(apiOnlyError("supabase_not_configured"));
      return;
    }
    const options = parseRequestOptions(request);
    const latest = await fetchLatestCompleteRows(options.limit);
    if (!latest.rows.length) {
      response.status(404).json(apiOnlyError(latest.gate || "strategy5_scan_results_latest_empty"));
      return;
    }
    response.status(200).json(buildPayload(latest.rows, latest.run, options));
  } catch (error) {
    response.status(503).json(apiOnlyError(error?.message || String(error)));
  }
};
