const fs = require("fs");
const path = require("path");
const { readEndpointFromDesktopSnapshot } = require("../lib/desktop-route-snapshot-cache");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");
const { readSnapshot } = require("../lib/supabase-snapshots");

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });

const TABLE = process.env.STRATEGY3_SUPABASE_RESULTS_TABLE || "strategy3_scan_results";
const LATEST_RUN_VIEW = process.env.STRATEGY3_SUPABASE_LATEST_RUN_VIEW || "v_strategy3_latest_complete_run";
const SNAPSHOT_KEY = process.env.STRATEGY3_SUPABASE_SNAPSHOT_KEY || "strategy3_latest";

function apiOnlyError(reason = "") {
  return {
    ok: false,
    error: "strategy3_api_only_unavailable",
    detail: reason,
    cacheSource: "none",
    matches: [],
    transport: {
      source: "supabase",
      latestRunView: LATEST_RUN_VIEW,
      gate: "run_id",
      via: "api/strategy3-latest",
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

function parseRequestOptions(request) {
  try {
    const url = new URL(request.url || "", "http://localhost");
    const canvas = url.searchParams.get("canvas") === "1" || url.searchParams.get("compact") === "1" || url.searchParams.get("shell") === "1";
    const limit = Math.max(1, Math.min(canvas ? 120 : 2000, cleanNumber(url.searchParams.get("limit")) || (canvas ? 60 : 2000)));
    return { canvas, limit };
  } catch {
    return { canvas: false, limit: 2000 };
  }
}

function normalizeSignals(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePayload(row) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const signals = normalizeSignals(payload.matches || payload.signals || row.signals);
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
    score: cleanNumber(payload.score || payload.overnightScore || row.score),
    overnightScore: cleanNumber(payload.overnightScore || payload.score || row.score),
    matches: signals,
    reason: String(payload.tvOvernightEntry?.reason || payload.reason || row.reason || signals.map((signal) => signal.reason).filter(Boolean).join("；")).trim(),
  };
}

function normalizeSnapshotRows(payload) {
  return Array.isArray(payload?.matches) ? payload.matches
    : Array.isArray(payload?.rows) ? payload.rows
      : [];
}

function normalizeSourceHealth(value) {
  const sourceHealth = value && typeof value === "object" ? { ...value } : null;
  if (!sourceHealth) return null;
  const issueCount = Array.isArray(sourceHealth.issues) ? sourceHealth.issues.length : 0;
  const warningCount = cleanNumber(sourceHealth.warningCount);
  const warningLimit = cleanNumber(sourceHealth.warningLimit) || 3;
  const status = String(sourceHealth.status || "");
  if (status === "degraded" && issueCount === 0 && warningCount <= warningLimit) {
    sourceHealth.status = "ok";
    sourceHealth.normalizedFrom = "degraded";
    sourceHealth.normalizedReason = "non-blocking warnings under limit";
  }
  return sourceHealth;
}

function buildPayload(rows, run, options = {}) {
  const first = rows[0] || {};
  const matches = rows
    .slice()
    .sort((a, b) => cleanNumber(a.rank) - cleanNumber(b.rank) || String(a.code).localeCompare(String(b.code)))
    .map(normalizePayload);
  const scanDate = String(first.scan_date || run?.scan_date || "").replace(/-/g, "");
  const sourceHealth = normalizeSourceHealth(run?.payload?.sourceHealth);
  const qualityStatus = sourceHealth?.status || String(first.quality_status || run?.quality_status || "");
  const resultCount = cleanNumber(run?.result_count || run?.payload?.count);
  return {
    ok: true,
    source: "supabase:strategy3_scan_results",
    cacheSource: "supabase-api",
    runId: String(first.run_id || run?.run_id || ""),
    generatedAt: String(first.generated_at || run?.generated_at || run?.finished_at || first.updated_at || new Date().toISOString()),
    updatedAt: String(run?.finished_at || first.updated_at || new Date().toISOString()),
    usedDate: scanDate,
    complete: true,
    canvas: Boolean(options.canvas),
    qualityStatus,
    count: Math.max(matches.length, resultCount),
    returnedCount: matches.length,
    total: Math.max(matches.length, cleanNumber(run?.expected_total || run?.scanned_count)),
    sourceHealth,
    matches,
    transport: {
      source: "supabase",
      table: TABLE,
      latestRunView: LATEST_RUN_VIEW,
      gate: "run_id",
      runId: String(first.run_id || run?.run_id || ""),
      via: "api/strategy3-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

function buildSnapshotPayload(snapshot, options = {}) {
  const sourcePayload = snapshot?.payload && typeof snapshot.payload === "object" ? snapshot.payload : null;
  if (!sourcePayload) return null;
  const rows = normalizeSnapshotRows(sourcePayload);
  const matches = rows
    .slice(0, options.limit || rows.length)
    .map((row, index) => normalizePayload({ ...row, rank: row.rank || index + 1, payload: row }));
  const count = Math.max(cleanNumber(sourcePayload.count), rows.length);
  const total = Math.max(cleanNumber(sourcePayload.total), count);
  return {
    ...sourcePayload,
    ok: sourcePayload.ok !== false,
    source: sourcePayload.source || "strategy3_scan_results",
    cacheSource: "supabase-snapshot",
    runId: String(sourcePayload.runId || snapshot.snapshotId || ""),
    updatedAt: String(sourcePayload.updatedAt || snapshot.updatedAt || new Date().toISOString()),
    generatedAt: String(sourcePayload.generatedAt || sourcePayload.updatedAt || snapshot.updatedAt || new Date().toISOString()),
    usedDate: String(sourcePayload.usedDate || snapshot.tradeDate || "").replace(/\D/g, ""),
    complete: sourcePayload.complete !== false,
    canvas: Boolean(options.canvas),
    qualityStatus: sourcePayload.qualityStatus || sourcePayload.sourceHealth?.status || "",
    count,
    returnedCount: matches.length,
    total,
    matches,
    rows: matches,
    transport: {
      ...(sourcePayload.transport || {}),
      source: "supabase-snapshot",
      snapshotKey: SNAPSHOT_KEY,
      snapshotId: snapshot.snapshotId || "",
      runId: String(sourcePayload.runId || snapshot.snapshotId || ""),
      gate: "latest-snapshot",
      via: "api/strategy3-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

async function readLatestSnapshot(options) {
  const snapshot = await readSnapshot(SNAPSHOT_KEY, {
    allowLatestFallback: true,
    timeoutMs: Number(process.env.STRATEGY3_SNAPSHOT_READ_TIMEOUT_MS || 1600),
  });
  return buildSnapshotPayload(snapshot, options);
}

async function fetchLatestCompleteRun() {
  const rows = await fetchRowsFrom(
    LATEST_RUN_VIEW,
    [
      "select=*",
      "strategy=eq.strategy3",
      "status=eq.complete",
      "complete=eq.true",
      "limit=1",
    ].join("&")
  );
  const row = rows[0];
  return row?.run_id ? row : null;
}

async function fetchLatestCompleteRows(limit = 2000) {
  const run = await fetchLatestCompleteRun();
  if (!run?.run_id) return { rows: [], run: null };
  const rows = await fetchRowsFrom(
    TABLE,
    [
      "select=run_id,scan_date,code,name,price,close,change_percent,volume,trade_volume,trade_value,score,rank,reason,signals,payload,complete,quality_status,generated_at,updated_at",
      "strategy=eq.strategy3",
      `run_id=eq.${encodeURIComponent(run.run_id)}`,
      "order=rank.asc",
      `limit=${Math.max(1, Math.min(2000, cleanNumber(limit) || 2000))}`,
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

  const cached = await readEndpointFromDesktopSnapshot(request, {
    timeoutMs: 650,
    via: "api/strategy3-latest",
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
    const snapshot = await readLatestSnapshot(options);
    if (snapshot) {
      response.status(200).json(snapshot);
      return;
    }
    const latest = await fetchLatestCompleteRows(options.limit);
    if (!latest.rows.length && !latest.run?.run_id) {
      response.status(404).json(apiOnlyError("strategy3_scan_results_latest_empty"));
      return;
    }
    response.status(200).json(buildPayload(latest.rows, latest.run, options));
  } catch (error) {
    response.status(503).json(apiOnlyError(error?.message || String(error)));
  }
};
