const { readSnapshot } = require("../lib/supabase-snapshots");
const { readEndpointFromDesktopSnapshot } = require("../lib/desktop-route-snapshot-cache");
const { serviceRoleKey, terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || process.env.FUMAN_RUNTIME_ROOT || "C:/fuman-runtime";
const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = process.env.FUMAN_TERMINAL_SUPABASE_SERVICE_ROLE_KEY
  || serviceRoleKey({ runtimeDir: RUNTIME_DIR })
  || terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });
const CB_DETECT_RUNS_TABLE = process.env.CB_DETECT_SUPABASE_RUNS_TABLE || "cb_detect_scan_runs";
const CB_DETECT_RESULTS_TABLE = process.env.CB_DETECT_SUPABASE_RESULTS_TABLE || "cb_detect_scan_results";

function setDesktopSnapshotCache(response) {
  response.setHeader("Cache-Control", "public, max-age=45, stale-while-revalidate=180");
  response.setHeader("CDN-Cache-Control", "public, max-age=45, stale-while-revalidate=240");
  response.setHeader("Vercel-CDN-Cache-Control", "public, max-age=45, stale-while-revalidate=240");
}

function apiOnlyError(reason = "") {
  return {
    ok: false,
    error: "cb_detect_api_only_unavailable",
    detail: reason,
    cacheSource: "none",
    rows: [],
    transport: {
      source: "supabase-snapshot",
      snapshotKey: "cb_detect_latest",
      via: "api/cb-detect-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

function emptyPayload(reason = "cb_detect_snapshot_missing", options = {}) {
  return {
    ok: true,
    complete: false,
    qualityStatus: "waiting_snapshot",
    cacheSource: "none",
    source: "cb-detect-empty-state",
    count: 0,
    returnedCount: 0,
    canvas: Boolean(options.canvas),
    compact: Boolean(options.compact),
    shell: Boolean(options.shell),
    rows: [],
    matches: [],
    updatedAt: new Date().toISOString(),
    reason,
    transport: {
      source: "none",
      snapshotKey: "cb_detect_latest",
      gate: "waiting_snapshot",
      via: "api/cb-detect-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function readRequestOptions(request) {
  try {
    const url = new URL(request.url, `https://${request.headers.host || "localhost"}`);
    const query = request.query || {};
    const getParam = (key) => url.searchParams.get(key) ?? query[key];
    const canvas = getParam("canvas") === "1";
    const compact = getParam("compact") === "1";
    const shell = getParam("shell") === "1";
    const compactIntent = canvas || compact || shell || getParam("fastBundle") === "1" || getParam("snapshotBuild") === "1";
    const defaultLimit = compactIntent ? 60 : 3000;
    const maxLimit = compactIntent ? 70 : 3000;
    const limit = Math.max(1, Math.min(maxLimit, cleanNumber(getParam("limit")) || defaultLimit));
    return { canvas, compact, shell, compactIntent, limit };
  } catch {
    return { canvas: false, compact: false, shell: false, compactIntent: false, limit: 3000 };
  }
}

function supabaseHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Accept: "application/json",
  };
}

async function fetchSupabaseRows(table, query, timeoutMs = 4500) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: supabaseHeaders(),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${table} HTTP ${response.status}: ${text.slice(0, 180)}`);
    const rows = JSON.parse(text || "[]");
    return Array.isArray(rows) ? rows : [];
  } finally {
    clearTimeout(timer);
  }
}

function rowsFromCompleteRun(resultRows = []) {
  return resultRows
    .map((row, index) => {
      const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
      return {
        ...payload,
        symbol: payload.symbol || row.symbol || "",
        cbCode: payload.cbCode || row.symbol || "",
        name: payload.name || row.name || payload.code || row.symbol || "",
        cbName: payload.cbName || row.name || "",
        rank: cleanNumber(payload.rank) || index + 1,
      };
    })
    .sort((a, b) => (cleanNumber(a.rank) || 99999) - (cleanNumber(b.rank) || 99999) || cleanNumber(b.score) - cleanNumber(a.score));
}

async function readLatestCompleteRun(options) {
  const runRows = await fetchSupabaseRows(
    CB_DETECT_RUNS_TABLE,
    [
      "select=run_id,scan_date,finished_at,status,complete,result_count,quality_status,source,schema_version,data_contract_source,generated_at,updated_at,payload",
      "strategy=eq.cb_detect",
      "status=eq.complete",
      "complete=eq.true",
      "order=finished_at.desc",
      "limit=1",
    ].join("&")
  );
  const run = Array.isArray(runRows) ? runRows[0] : null;
  if (!run?.run_id) return null;
  const resultRows = await fetchSupabaseRows(
    CB_DETECT_RESULTS_TABLE,
    [
      "select=run_id,scan_date,symbol,name,payload,updated_at",
      `run_id=eq.${encodeURIComponent(run.run_id)}`,
      "limit=5000",
    ].join("&"),
    6500
  );
  const rows = rowsFromCompleteRun(resultRows || []);
  const count = cleanNumber(run.result_count) || rows.length;
  if (count > 0 && rows.length <= 0) throw new Error(`cb complete run ${run.run_id} has no result rows`);
  const outputRows = options.compactIntent ? rows.slice(0, options.limit || 60) : rows;
  return {
    ok: true,
    complete: true,
    qualityStatus: run.quality_status || "complete",
    cacheSource: "supabase-api",
    source: run.source || "CBAS",
    count,
    returnedCount: outputRows.length,
    canvas: Boolean(options.canvas),
    compact: Boolean(options.compact),
    shell: Boolean(options.shell),
    rows: outputRows,
    matches: outputRows,
    runId: run.run_id,
    updatedAt: run.updated_at || run.finished_at || run.generated_at || "",
    generatedAt: run.generated_at || "",
    dataContractSource: run.data_contract_source || "cb_detect_scan_runs/results",
    transport: {
      source: "supabase",
      via: "api/cb-detect-latest",
      gate: "run_id",
      runTable: CB_DETECT_RUNS_TABLE,
      resultTable: CB_DETECT_RESULTS_TABLE,
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

  const cached = await readEndpointFromDesktopSnapshot(request, {
    timeoutMs: 650,
    via: "api/cb-detect-latest",
  });
  if (cached) {
    setDesktopSnapshotCache(response);
    response.status(200).json(cached);
    return;
  }

  try {
    const options = readRequestOptions(request);
    const completeRunPayload = await readLatestCompleteRun(options);
    if (completeRunPayload) {
      setDesktopSnapshotCache(response);
      response.status(200).json(completeRunPayload);
      return;
    }
    const snapshot = await readSnapshot("cb_detect_latest", { allowLatestFallback: true, timeoutMs: 5000 });
    if (!snapshot?.payload) {
      response.status(200).json(emptyPayload("cb_detect_snapshot_missing", options));
      return;
    }
    const rows = Array.isArray(snapshot.payload.rows)
      ? snapshot.payload.rows
      : Array.isArray(snapshot.payload.matches)
        ? snapshot.payload.matches
        : [];
    const outputRows = options.compactIntent ? rows.slice(0, options.limit || 60) : rows;
    setDesktopSnapshotCache(response);
    response.status(200).json({
      ...snapshot.payload,
      ok: snapshot.payload.ok !== false,
      complete: snapshot.payload.complete !== false,
      qualityStatus: snapshot.payload.qualityStatus || "complete",
      count: Number(snapshot.payload.count || rows.length || 0),
      returnedCount: outputRows.length,
      canvas: Boolean(options.canvas),
      compact: Boolean(options.compact),
      shell: Boolean(options.shell),
      rows: outputRows,
      matches: outputRows,
      cacheSource: "supabase-snapshot",
      runId: snapshot.payload.runId || snapshot.snapshotId || "",
      updatedAt: snapshot.payload.updatedAt || snapshot.updatedAt || "",
      transport: {
        ...(snapshot.payload.transport || {}),
        source: "supabase-snapshot",
        snapshotKey: "cb_detect_latest",
        snapshotId: snapshot.snapshotId || "",
        gate: "latest-snapshot",
        via: "api/cb-detect-latest",
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    response.status(503).json(apiOnlyError(error?.message || String(error)));
  }
};
