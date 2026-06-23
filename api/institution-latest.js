const fs = require("fs");
const path = require("path");
const { readSnapshot } = require("../lib/supabase-snapshots");

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

const TABLE = process.env.INSTITUTION_SUPABASE_RESULTS_TABLE || "institution_scan_results";
const RUNS_TABLE = process.env.INSTITUTION_SUPABASE_RUNS_TABLE || "institution_scan_runs";
const LATEST_RUN_VIEW = process.env.INSTITUTION_SUPABASE_LATEST_RUN_VIEW || "v_institution_latest_complete_run";
const PAGE_SIZE = Math.max(100, Math.min(1000, Number(process.env.INSTITUTION_SUPABASE_PAGE_SIZE || 1000)));
const MIN_COMPLETE_ROWS = Math.max(1, Number(process.env.INSTITUTION_MIN_COMPLETE_ROWS || 1200));
const RECENT_RUN_LIMIT = Math.max(8, Math.min(50, Number(process.env.INSTITUTION_RECENT_RUN_LIMIT || 20)));
const MEMORY_TTL_MS = Math.max(5000, Number(process.env.INSTITUTION_API_MEMORY_TTL_MS || 60000));
const SNAPSHOT_KEY = process.env.INSTITUTION_SNAPSHOT_KEY || "chip_trade_latest";
const FALLBACK_RUN_IDS = String(
  process.env.INSTITUTION_FALLBACK_RUN_IDS || "institution-20260622-20260622144049"
).split(",").map((value) => value.trim()).filter(Boolean);

let memoryPayload = null;
let memoryPayloadAt = 0;

function nowIso() {
  return new Date().toISOString();
}

function apiOnlyError(reason = "") {
  return {
    ok: false,
    error: "institution_api_only_unavailable",
    detail: reason,
    cacheSource: "none",
    data: {},
    rows: [],
    count: 0,
    minCompleteRows: MIN_COMPLETE_ROWS,
    transport: {
      source: "supabase",
      latestRunView: LATEST_RUN_VIEW,
      gate: "complete-run-min-rows",
      via: "api/institution-latest",
      fetchedAt: nowIso(),
    },
  };
}

async function fetchRowsFrom(table, query, extraHeaders = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
      ...extraHeaders,
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

async function fetchRowsPaged(table, queryParts) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await fetchRowsFrom(table, queryParts.join("&"), {
      Range: `${offset}-${offset + PAGE_SIZE - 1}`,
    });
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function normalizeRow(row) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const foreign = cleanNumber(payload.foreign ?? payload.foreignNet ?? row.foreign_net);
  const trust = cleanNumber(payload.trust ?? payload.trustNet ?? row.trust_net);
  const fiveDayAvgVolume = cleanNumber(payload.fiveDayAvgVolume ?? row.five_day_avg_volume);
  const foreignTrustBuyVolumePct = cleanNumber(
    payload.foreignTrustBuyVolumePct
    ?? payload.institutionBuyVolumePct
    ?? (fiveDayAvgVolume > 0 ? ((foreign + trust) / fiveDayAvgVolume) * 100 : 0)
  );
  return {
    ...payload,
    code: String(payload.code || row.code || "").trim(),
    name: String(payload.name || row.name || row.code || "").trim(),
    close: cleanNumber(payload.close || row.close),
    percent: cleanNumber(payload.percent ?? row.change_percent),
    tradeVolume: cleanNumber(payload.tradeVolume || row.trade_volume),
    value: cleanNumber(payload.value || row.trade_value),
    fiveDayAvgVolume,
    foreign,
    trust,
    dealer: cleanNumber(payload.dealer ?? row.dealer_net),
    total: cleanNumber(payload.total ?? row.total_net),
    foreignStreak: cleanNumber(payload.foreignStreak ?? row.foreign_streak),
    trustStreak: cleanNumber(payload.trustStreak ?? row.trust_streak),
    jointStreak: cleanNumber(payload.jointStreak ?? row.joint_streak),
    foreignTrustBuyVolumePct,
    institutionBuyVolumePct: foreignTrustBuyVolumePct,
    rank: cleanNumber(payload.rank ?? row.rank),
  };
}

function sortRows(rows) {
  return rows
    .slice()
    .sort((a, b) => cleanNumber(a.rank) - cleanNumber(b.rank) || String(a.code).localeCompare(String(b.code)))
    .map(normalizeRow);
}

function scanDateFrom(run, rows) {
  return String(run?.payload?.usedDate || run?.scan_date || rows[0]?.scan_date || "").replace(/-/g, "");
}

function isRunCountValid(run) {
  const resultCount = cleanNumber(run?.result_count ?? run?.count ?? run?.payload?.count);
  return !resultCount || resultCount >= MIN_COMPLETE_ROWS;
}

function buildPayload(rows, run, meta = {}) {
  const sorted = sortRows(rows);
  const data = Object.fromEntries(sorted.map((row) => [row.code, row]).filter(([code]) => code));
  const usedDate = scanDateFrom(run, rows);
  return {
    ok: true,
    source: "supabase:institution_scan_results",
    cacheSource: "supabase-api",
    runId: String(run?.run_id || rows[0]?.run_id || ""),
    updatedAt: String(run?.finished_at || rows[0]?.updated_at || nowIso()),
    usedDate,
    quoteUpdatedAt: run?.payload?.quoteUpdatedAt || "",
    complete: true,
    minCompleteRows: MIN_COMPLETE_ROWS,
    skippedRuns: meta.skippedRuns || [],
    qualityStatus: String(run?.quality_status || rows[0]?.quality_status || "complete"),
    schemaVersion: String(run?.schema_version || rows[0]?.schema_version || "institution-run-id-complete-v1"),
    dataContractSource: String(run?.data_contract_source || rows[0]?.data_contract_source || "institution-cache"),
    count: sorted.length,
    data,
    rows: sorted,
    sourceHealth: run?.payload?.sourceHealth || {},
    transport: {
      source: "supabase",
      table: TABLE,
      latestRunView: LATEST_RUN_VIEW,
      gate: "complete-run-min-rows",
      runId: String(run?.run_id || rows[0]?.run_id || ""),
      via: "api/institution-latest",
      fetchedAt: nowIso(),
      pageSize: PAGE_SIZE,
    },
  };
}

function buildTopShape(payload, limit) {
  const rows = payload.rows.slice(0, limit);
  return {
    ok: true,
    shape: "top",
    source: payload.source,
    cacheSource: payload.cacheSource,
    runId: payload.runId,
    updatedAt: payload.updatedAt,
    usedDate: payload.usedDate,
    complete: payload.complete,
    minCompleteRows: payload.minCompleteRows,
    count: payload.count,
    rows,
    dataCount: payload.count,
    transport: payload.transport,
  };
}

function buildForeignTrustVolumePctShape(payload, limit) {
  const rows = payload.rows
    .filter((row) => cleanNumber(row.foreign) + cleanNumber(row.trust) > 0)
    .sort((a, b) => cleanNumber(b.foreignTrustBuyVolumePct) - cleanNumber(a.foreignTrustBuyVolumePct))
    .slice(0, limit);
  return {
    ok: true,
    shape: "foreignTrustVolumePct",
    source: payload.source,
    cacheSource: payload.cacheSource,
    runId: payload.runId,
    updatedAt: payload.updatedAt,
    usedDate: payload.usedDate,
    complete: payload.complete,
    minCompleteRows: payload.minCompleteRows,
    count: rows.length,
    rows,
    dataCount: payload.count,
    transport: payload.transport,
  };
}

async function fetchRecentCompleteRuns() {
  const rows = await fetchRowsFrom(
    RUNS_TABLE,
    [
      "select=*",
      "strategy=eq.institution",
      "status=eq.complete",
      "complete=eq.true",
      `result_count=gte.${MIN_COMPLETE_ROWS}`,
      "order=scan_date.desc,finished_at.desc",
      `limit=${Math.min(RECENT_RUN_LIMIT, 8)}`,
    ].join("&")
  );
  return rows.filter((row) => row?.run_id);
}

async function fetchRecentRunsFromResults() {
  const seen = new Map();
  for (let offset = 0; offset < PAGE_SIZE * 8 && seen.size < RECENT_RUN_LIMIT; offset += PAGE_SIZE) {
    const page = await fetchRowsFrom(TABLE, [
      "select=run_id,scan_date,quality_status,schema_version,data_contract_source,generated_at,updated_at,payload,complete",
      "strategy=eq.institution",
      "complete=eq.true",
      "order=updated_at.desc",
    ].join("&"), {
      Range: `${offset}-${offset + PAGE_SIZE - 1}`,
      Prefer: "count=exact",
    });
    for (const row of page) {
      const runId = String(row?.run_id || "");
      if (!runId || seen.has(runId)) continue;
      seen.set(runId, {
        ...row,
        run_id: runId,
        finished_at: row.updated_at || row.generated_at || "",
        result_count: 0,
        _candidateSource: "institution_scan_results",
      });
      if (seen.size >= RECENT_RUN_LIMIT) break;
    }
    if (page.length < PAGE_SIZE) break;
  }
  return [...seen.values()];
}

async function fetchRowsForRun(run) {
  return fetchRowsPaged(TABLE, [
    "select=run_id,scan_date,code,name,close,change_percent,trade_volume,trade_value,foreign_net,trust_net,dealer_net,total_net,rank,reason,payload,complete,quality_status,schema_version,data_contract_source,generated_at,updated_at",
    "strategy=eq.institution",
    `run_id=eq.${encodeURIComponent(run.run_id)}`,
  ]);
}

async function fetchLatestCompleteRows() {
  const skippedRuns = [];
  const runs = [];
  const seen = new Set();
  try {
    for (const run of await fetchRecentCompleteRuns()) {
      if (!run?.run_id || seen.has(run.run_id)) continue;
      runs.push(run);
      seen.add(run.run_id);
    }
  } catch (error) {
    skippedRuns.push({ runId: "", reason: "runs_table_unavailable", detail: String(error?.message || error).slice(0, 180) });
  }
  if (!runs.length) {
    for (const runId of FALLBACK_RUN_IDS) {
      if (seen.has(runId)) continue;
      runs.push({
        run_id: runId,
        result_count: MIN_COMPLETE_ROWS,
        quality_status: "complete",
        _candidateSource: "configured_fallback_run_id",
      });
      seen.add(runId);
    }
  }
  if (!runs.length) {
    for (const run of await fetchRecentRunsFromResults()) {
      if (!run?.run_id || seen.has(run.run_id)) continue;
      runs.push(run);
      seen.add(run.run_id);
    }
  }
  for (const run of runs) {
    const runId = String(run.run_id || "");
    if (!isRunCountValid(run)) {
      skippedRuns.push({ runId, reason: "below_min_result_count", resultCount: cleanNumber(run.result_count) });
      continue;
    }
    const rows = await fetchRowsForRun(run);
    if (rows.length < MIN_COMPLETE_ROWS) {
      skippedRuns.push({ runId, reason: "below_min_rows", rows: rows.length });
      continue;
    }
    return { rows, run, skippedRuns };
  }
  return { rows: [], run: null, skippedRuns };
}

function cachedPayload() {
  if (memoryPayload && Date.now() - memoryPayloadAt < MEMORY_TTL_MS) return memoryPayload;
  return null;
}

function setCachedPayload(payload) {
  memoryPayload = payload;
  memoryPayloadAt = Date.now();
}

async function fetchSnapshotPayload() {
  const snapshot = await readSnapshot(SNAPSHOT_KEY, {
    allowLatestFallback: true,
    allowMarketSnapshotsFallback: true,
    forceMarketSnapshots: true,
    timeoutMs: 10000,
  });
  const payload = snapshot?.payload && typeof snapshot.payload === "object" ? snapshot.payload : null;
  if (!payload?.ok) return null;
  const count = cleanNumber(payload.count || payload.rows?.length || Object.keys(payload.data || {}).length);
  if (count < MIN_COMPLETE_ROWS) return null;
  return {
    ...payload,
    count,
    cacheSource: "supabase-snapshot",
    transport: {
      ...(payload.transport || {}),
      source: "supabase-snapshot",
      snapshotKey: SNAPSHOT_KEY,
      snapshotId: snapshot.snapshotId || "",
      gate: "snapshot-min-rows",
      fetchedAt: nowIso(),
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
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      response.status(503).json(apiOnlyError("supabase_not_configured"));
      return;
    }

    let payload = cachedPayload();
    if (!payload || request.query?.force === "1") {
      payload = await fetchSnapshotPayload();
      if (!payload) {
        const latest = await fetchLatestCompleteRows();
        if (!latest.rows.length) {
          response.status(404).json({ ...apiOnlyError("institution_scan_results_latest_valid_run_empty"), skippedRuns: latest.skippedRuns });
          return;
        }
        payload = buildPayload(latest.rows, latest.run, { skippedRuns: latest.skippedRuns });
      }
      setCachedPayload(payload);
    }

    const shape = String(request.query?.shape || "").trim();
    const limit = Math.max(1, Math.min(500, Number(request.query?.limit || 120)));
    if (shape === "top" || request.query?.compact === "1") {
      response.status(200).json(buildTopShape(payload, limit));
      return;
    }
    if (shape === "foreignTrustVolumePct") {
      response.status(200).json(buildForeignTrustVolumePctShape(payload, limit));
      return;
    }
    response.status(200).json(payload);
  } catch (error) {
    response.status(503).json(apiOnlyError(error?.message || String(error)));
  }
};
