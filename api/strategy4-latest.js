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

const TABLE = process.env.STRATEGY4_SUPABASE_RESULTS_TABLE || "strategy4_scan_results";
const RUNS_TABLE = process.env.STRATEGY4_SUPABASE_RUNS_TABLE || "strategy4_scan_runs";
const EXPECTED_SCHEMA = "strategy4-cache-v3-unit-contract";
const EXPECTED_UNIT = "lots";
const EXPECTED_SOURCE = "supabase:strategy4_daily_ohlcv_view";

function apiOnlyError(error, detail = "") {
  return {
    ok: false,
    cacheSource: "api-only",
    error,
    detail,
    transport: {
      source: "supabase",
      table: TABLE,
      runTable: RUNS_TABLE,
      gate: "run_id",
      via: "api/strategy4-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

async function fetchRowsFrom(table, query) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const response = await fetch(url, {
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

async function fetchRows(query) {
  return fetchRowsFrom(TABLE, query);
}

async function fetchExactCount(table, query) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const response = await fetch(url, {
    method: "HEAD",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: "count=exact",
    },
    cache: "no-store",
  });
  if (!response.ok) return 0;
  const range = response.headers.get("content-range") || "";
  const match = range.match(/\/(\d+)$/);
  return match ? Number(match[1]) || 0 : 0;
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function parseRequestOptions(request) {
  try {
    const url = new URL(request.url || "", "http://localhost");
    const canvas = url.searchParams.get("canvas") === "1" || url.searchParams.get("compact") === "1";
    const limit = Math.max(1, Math.min(canvas ? 120 : 2000, cleanNumber(url.searchParams.get("limit")) || (canvas ? 70 : 2000)));
    return { canvas, limit };
  } catch {
    return { canvas: false, limit: 2000 };
  }
}

function normalizeSignalList(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePayload(row) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const signals = normalizeSignalList(payload.signals || row.signals);
  return {
    ...payload,
    code: String(payload.code || row.code || "").trim(),
    name: String(payload.name || row.name || row.code || "").trim(),
    close: cleanNumber(payload.close || payload.price || row.price),
    price: cleanNumber(payload.price || payload.close || row.price),
    percent: cleanNumber(payload.percent ?? payload.changePercent ?? row.change_percent),
    volume: cleanNumber(payload.volume || row.volume),
    value: cleanNumber(payload.value || payload.tradeValue || row.trade_value),
    swingScore: cleanNumber(payload.swingScore || payload.score || row.score),
    score: cleanNumber(payload.score || payload.swingScore || row.score),
    swingZone: String(payload.swingZone || payload.zone || row.zone || "").trim(),
    swingZoneLabel: String(payload.swingZoneLabel || payload.zoneLabel || row.zone_label || "").trim(),
    signals,
    reason: String(payload.reason || row.reason || signals.map((signal) => signal.reason).filter(Boolean).join("；")).trim(),
  };
}

function countBy(values) {
  return values.reduce((acc, value) => {
    const key = String(value || "(blank)");
    acc[key] = cleanNumber(acc[key]) + 1;
    return acc;
  }, {});
}

function buildStrategy4SourceHealth(rows, run, matches) {
  const runPayload = run?.payload && typeof run.payload === "object" ? run.payload : {};
  const sourceWarnings = Array.isArray(runPayload.sourceWarnings) ? [...runPayload.sourceWarnings] : [];
  const resultSourceCounts = countBy(rows.map((row) => row.price_source || row.payload?.priceSource || ""));
  const allExpectedSource = Object.keys(resultSourceCounts).length === 1 && resultSourceCounts[EXPECTED_SOURCE] === rows.length;
  if (String(run?.quality_status || rows[0]?.quality_status || "") === "degraded" && !sourceWarnings.length && !runPayload.supabaseCoverage) {
    sourceWarnings.push("Legacy degraded run has no source detail in strategy4_scan_runs.payload; inferred source mix from result rows.");
  }
  return {
    status: String(run?.quality_status || rows[0]?.quality_status || ""),
    sourceWarnings,
    resultSourceCounts,
    allRowsExpectedSource: allExpectedSource,
    yahooSourceCount: cleanNumber(runPayload.yahooSourceCount),
    yahooSourceRatio: cleanNumber(runPayload.yahooSourceRatio),
    misSourceCount: cleanNumber(runPayload.misSourceCount),
    misSourceRatio: cleanNumber(runPayload.misSourceRatio),
    dataSourceCounts: runPayload.dataSourceCounts || {},
    supabaseCoverage: runPayload.supabaseCoverage || null,
    expectedTotal: cleanNumber(run?.expected_total),
    scannedCount: cleanNumber(run?.scanned_count),
    resultCount: cleanNumber(run?.result_count) || matches.length,
    noDataCount: cleanNumber(run?.no_data_count),
    errorCount: cleanNumber(run?.error_count),
  };
}

function buildPayload(rows, total, run = null, options = {}) {
  const first = rows[0] || {};
  const matches = rows
    .slice()
    .sort((a, b) => cleanNumber(a.rank) - cleanNumber(b.rank) || String(a.code).localeCompare(String(b.code)))
    .map(normalizePayload);
  const zones = matches.reduce((acc, item) => {
    const zone = String(item.swingZone || item.zone || "").toUpperCase();
    if (zone === "A" || zone === "B" || zone === "C") acc[zone] += 1;
    return acc;
  }, { A: 0, B: 0, C: 0 });
  const scanDate = String(first.scan_date || "").replace(/-/g, "");
  return {
    ok: true,
    source: "supabase:strategy4_scan_results",
    cacheSource: "supabase-api",
    schemaVersion: String(first.schema_version || EXPECTED_SCHEMA),
    volumeUnit: String(first.volume_unit || EXPECTED_UNIT),
    dataContractSource: String(first.data_contract_source || EXPECTED_SOURCE),
    runId: String(first.run_id || ""),
    generatedAt: String(first.generated_at || first.scan_time || first.updated_at || new Date().toISOString()),
    updatedAt: String(first.scan_time || first.updated_at || new Date().toISOString()),
    scanStamp: scanDate,
    complete: Boolean(first.complete),
    canvas: Boolean(options.canvas),
    qualityStatus: String(first.quality_status || ""),
    count: matches.length,
    total: Math.max(matches.length, cleanNumber(total), 1500),
    zones,
    sourceHealth: buildStrategy4SourceHealth(rows, run, matches),
    matches,
    transport: {
      source: "supabase",
      table: TABLE,
      runTable: RUNS_TABLE,
      runId: String(first.run_id || ""),
      gate: "run_id",
      via: "api/strategy4-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

async function fetchLatestCompleteRun() {
  const rows = await fetchRowsFrom(
    RUNS_TABLE,
    [
      "select=run_id,scan_date,finished_at,status,complete,expected_total,scanned_count,result_count,no_data_count,error_count,schema_version,volume_unit,data_contract_source,quality_status,payload",
      "strategy=eq.strategy4",
      "status=eq.complete",
      "complete=eq.true",
      "order=finished_at.desc",
      "limit=12",
    ].join("&")
  );
  const row = rows.find((candidate) => {
    if (!candidate?.run_id) return false;
    if (candidate.schema_version && candidate.schema_version !== EXPECTED_SCHEMA) return false;
    if (candidate.volume_unit && candidate.volume_unit !== EXPECTED_UNIT) return false;
    if (candidate.data_contract_source && candidate.data_contract_source !== EXPECTED_SOURCE) return false;
    return true;
  });
  if (!row?.run_id) return null;
  return row;
}

async function fetchLatestCompleteRows(limit = 2000) {
  const run = await fetchLatestCompleteRun();
  if (!run?.run_id) return { rows: [], run: null, gate: "missing-complete-run", runId: "" };
  const query = [
    "select=run_id,scan_date,scan_time,code,name,signals,price,change_percent,volume,trade_value,score,zone,zone_label,rank,reason,complete,quality_status,schema_version,volume_unit,data_contract_source,price_source,generated_at,payload,updated_at",
    "strategy=eq.strategy4",
    `run_id=eq.${encodeURIComponent(run.run_id)}`,
    "order=rank.asc",
    `limit=${Math.max(1, Math.min(2000, cleanNumber(limit) || 2000))}`,
  ].join("&");
  const rows = await fetchRows(query);
  return { rows, run, gate: "run_id", runId: run.run_id };
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
    via: "api/strategy4-latest",
  });
  if (cached) {
    response.status(200).json(cached);
    return;
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      response.status(503).json(apiOnlyError("strategy4_supabase_not_configured"));
      return;
    }
    const options = parseRequestOptions(request);
    const latest = await fetchLatestCompleteRows(options.limit);
    const rows = latest.rows || [];
    if (!rows.length) {
      response.status(404).json(apiOnlyError("strategy4_complete_run_empty", latest.gate || "missing rows"));
      return;
    }
    const total = options.canvas
      ? cleanNumber(latest.run?.expected_total || latest.run?.scanned_count)
      : await fetchExactCount("strategy4_stock_universe_view", "select=symbol&is_strategy4_eligible=eq.true&limit=1").catch(() => 0);
    const payload = buildPayload(rows, total, latest.run, options);
    payload.transport.gate = latest.gate || "";
    payload.transport.runId = latest.runId || payload.transport.runId || "";
    payload.runId = latest.runId || payload.runId || "";
    if (payload.schemaVersion !== EXPECTED_SCHEMA || payload.volumeUnit !== EXPECTED_UNIT || payload.dataContractSource !== EXPECTED_SOURCE) {
      response.status(409).json(apiOnlyError("strategy4_supabase_contract_mismatch"));
      return;
    }
    response.status(200).json(payload);
  } catch (error) {
    response.status(502).json(apiOnlyError("strategy4_api_only_failed", error?.message || String(error)));
  }
};
