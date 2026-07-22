const fs = require("fs");
const { buildMarketCalendarContract, attachMarketCalendar } = require("../lib/market-calendar-contract");
const path = require("path");
const { readSnapshot } = require("../lib/supabase-snapshots");
const { serverSupabaseKey, serverSupabaseUrl } = require("../lib/server-supabase-key");
const { withEntitlementRequired } = require("../lib/server-entitlement-guard");

const SNAPSHOT_KEY = process.env.FUMAN_SCORECARD_SNAPSHOT_KEY || "scorecard_latest";
const SNAPSHOT_FILE = path.join(process.cwd(), "data", "scorecard-latest.json");
const SCORECARD_CONTRACT = "scorecard-resource-chain-v1";
const SCORECARD_SNAPSHOT_TIMEOUT_MS = Math.max(300, Number(process.env.FUMAN_SCORECARD_SNAPSHOT_TIMEOUT_MS || 1200) || 1200);
const SCORECARD_LIVE_SNAPSHOT_TIMEOUT_MS = Math.max(
  SCORECARD_SNAPSHOT_TIMEOUT_MS,
  Number(process.env.FUMAN_SCORECARD_LIVE_SNAPSHOT_TIMEOUT_MS || 7000) || 7000
);
const SCORECARD_MEMORY_TTL_MS = Math.max(1000, Number(process.env.FUMAN_SCORECARD_MEMORY_TTL_MS || 15000) || 15000);
let staticSnapshotCache = null;
const payloadMemoryCache = new Map();
const FORMAL_STRATEGY_ENDPOINTS = {
  "策略2成績單": "/api/strategy2-latest?live=1",
  "策略3隔日沖成績單": "/api/strategy3-latest?live=1",
  "策略4成績單": "/api/strategy4-latest?live=1",
  "策略5成績單": "/api/strategy5-latest?live=1",
  "買賣超成績單": "/api/institution-latest?live=1",
  "權證成績單": "/api/warrant-flow-latest?live=1",
  "CB成績單": "/api/cb-detect-latest?live=1",
};
const AUDIT_SURFACES = [
  ["strategy2", "Strategy2 daytrade", "/api/strategy2-latest?live=1"],
  ["strategy3", "Strategy3", "/api/strategy3-latest?live=1"],
  ["strategy4", "Strategy4", "/api/strategy4-latest?live=1"],
  ["strategy5", "Strategy5", "/api/strategy5-latest?live=1"],
  ["institution", "Institution / 買賣超", "/api/institution-latest?live=1"],
  ["cb", "CB", "/api/cb-detect-latest?live=1"],
  ["warrant", "Warrant / 權證", "/api/warrant-flow-latest?live=1"],
  ["market-ai", "Market AI", "/api/market-ai-live"],
  ["mobile-terminal", "Mobile terminal / 手機終端", "/mobile.html"],
  ["desktop-terminal", "Desktop terminal / 電腦終端", "/"],
  ["shared-source", "Shared source / Supabase source gate", "supabase:scorecard_latest"],
  ["schedule-registry", "Schedule registry", "Windows Task:Fuman Scorecard Daily Automation 1400"],
  ["deploy-hygiene", "Deploy hygiene", "/api/release-manifest"],
];
function isRetiredScorecardSurfaceName(value) {
  return /即時雷達|熱力圖|realtime-radar|heatmap|strategy1|open-buy|openBuy|open_buy|明日開盤|開盤入/i.test(cleanText(value));
}

function sanitizeScorecardSourceQuery(sourceQuery = {}) {
  if (!sourceQuery || typeof sourceQuery !== "object") return sourceQuery;
  const latestDateCandidates = Array.isArray(sourceQuery.latestDateCandidates)
    ? sourceQuery.latestDateCandidates.map((candidate) => {
      const byStrategy = Object.fromEntries(Object.entries(candidate.byStrategy || {})
        .filter(([strategy]) => !isRetiredScorecardSurfaceName(strategy)));
      const missingStrategies = Array.isArray(candidate.missingStrategies)
        ? candidate.missingStrategies.filter((strategy) => !isRetiredScorecardSurfaceName(strategy))
        : candidate.missingStrategies;
      return {
        ...candidate,
        byStrategy,
        missingStrategies,
        strategies: Object.keys(byStrategy).length || candidate.strategies || 0,
        complete: Array.isArray(missingStrategies) ? missingStrategies.length === 0 : candidate.complete === true,
      };
    })
    : sourceQuery.latestDateCandidates;
  return { ...sourceQuery, latestDateCandidates };
}
const SCORECARD_REQUIRED_FIELDS = [
  "record_date",
  "strategy",
  "ticker",
  "name",
  "entry_time",
  "entry_price",
  "high_price",
  "pnl",
  "reason",
];

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function latestStrategy2HistoryPayload() {
  const dirs = [
    path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "data", "strategy2-intraday-history"),
    path.join(process.cwd(), "data", "strategy2-intraday-history"),
  ];
  const files = dirs.flatMap((dir) => {
    try {
      return fs.readdirSync(dir)
        .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
        .map((name) => path.join(dir, name));
    } catch {
      return [];
    }
  });
  return files
    .map((file) => {
      try {
        const payload = JSON.parse(fs.readFileSync(file, "utf8"));
        const stat = fs.statSync(file);
        return { file, payload, mtime: stat.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((item) => item?.payload && Array.isArray(item.payload.records) && item.payload.records.length)
    .sort((a, b) => String(b.payload.date || "").localeCompare(String(a.payload.date || "")) || b.mtime - a.mtime)[0]?.payload || null;
}

function readStrategy2ScorecardFallbackResult(reason = "strategy2_scorecard_display_only_previous_good") {
  const payload = latestStrategy2HistoryPayload();
  if (!payload) return null;
  const rows = Array.isArray(payload.records) ? payload.records : [];
  const runId = cleanText(payload.runId || payload.latestRunId || payload.transport?.runId);
  const date = cleanText(payload.date || rows[0]?.date);
  const updatedAt = cleanText(payload.updatedAt || rows[0]?.timestamp || new Date().toISOString());
  return {
    statusCode: 200,
    payload: {
      ...payload,
      ok: false,
      status: "blocked",
      qualityStatus: "degraded",
      runId,
      latestRunId: runId,
      rows,
      count: rows.length,
      resultCount: rows.length,
      readbackCount: rows.length,
      date,
      tradeDate: date,
      usedDate: date,
      sourceDate: date,
      updatedAt,
      source_snapshot_captured_at: updatedAt,
      evidenceStatus: "source_quality_fail",
      unattendedStatus: "NO",
      publishAllowed: false,
      latestOverwriteAllowed: false,
      preservePreviousGood: true,
      fallbackUsed: true,
      fallbackAllowed: false,
      fallbackScope: ["repo-bundled-strategy2-history", "display-only-previous-good", "scorecard-source-timeout"],
      degradedBlocksLatest: true,
      latestWriteAttempted: false,
      latestPointerUpdated: false,
      blockedReason: reason,
      scanner_block_reason: reason,
      reason,
      run_quality_at_publish: {
        publishAllowed: false,
        latestOverwriteAllowed: false,
        preservePreviousGood: true,
        fallbackUsed: true,
        fallbackAllowed: false,
        degradedBlocksLatest: true,
        evidenceStatus: "source_quality_fail",
        unattendedStatus: "NO",
        blockedReason: reason,
        scanner_block_reason: reason,
      },
      transport: { ...(payload.transport || {}), runId, source: "repo-bundled-strategy2-history", reason },
    },
  };
}

function reportStatusFromBool(ok) {
  return ok ? "complete" : "insufficient";
}

async function fetchSupabaseRows(table, query, timeoutMs = 8000) {
  const url = serverSupabaseUrl();
  const key = serverSupabaseKey();
  if (!url || !key) throw new Error("missing_supabase_credentials");
  const response = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${table}_read_failed:${response.status}:${text.slice(0, 180)}`);
  return text ? JSON.parse(text) : [];
}

async function latestRunFallbackPayload({ table, strategy = "", order = "finished_at.desc", error = "source_report_timeout" } = {}) {
  if (!table) return { ok: false, error };
  const params = ["select=*", "limit=1"];
  if (strategy) params.push(`strategy=eq.${encodeURIComponent(strategy)}`);
  if (order) params.push(`order=${encodeURIComponent(order)}`);
  try {
    const rows = await fetchSupabaseRows(table, params.join("&"), 5000);
    const row = rows[0] || {};
    const quality = row.run_quality_at_publish && typeof row.run_quality_at_publish === "object" ? row.run_quality_at_publish : {};
    const runId = cleanText(row.run_id || row.runId || quality.runId);
    return {
      ok: false,
      error,
      runId,
      count: cleanNumber(row.result_count ?? row.matched_count ?? row.matches ?? row.total ?? quality.resultCount),
      resultCount: cleanNumber(row.result_count ?? quality.resultCount),
      readbackCount: cleanNumber(row.readback_count ?? quality.readbackCount),
      expectedTotal: cleanNumber(row.expected_total ?? row.total ?? quality.expectedTotal),
      scannedCount: cleanNumber(row.scanned_count ?? row.total ?? quality.scannedCount),
      usedDate: cleanText(row.used_date || row.scan_date || row.trade_date || row.date),
      tradeDate: cleanText(row.trade_date || row.scan_date || row.used_date || row.date),
      source_snapshot_captured_at: cleanText(row.finished_at || row.updated_at || quality.sourceSnapshotCapturedAt),
      evidenceStatus: "insufficient",
      unattendedStatus: "NO",
      publishAllowed: false,
      latestOverwriteAllowed: false,
      preservePreviousGood: true,
      fallbackUsed: true,
      blockedReason: error,
    };
  } catch (fallbackError) {
    return { ok: false, error, reason: fallbackError?.message || String(fallbackError) };
  }
}
const RELEASE_SOURCE_REPORT_DATE = "20260713";
const RELEASE_SOURCE_REPORTS = [
  { key: "strategy2", strategy: "strategy2", endpoint: "/api/strategy2-latest", runId: "strategy2-20260713-210234", count: 35, emittedRows: 35, date: "20260713", reason: "scorecard_release_latest_pointer" },
  { key: "strategy3", strategy: "strategy3", endpoint: "/api/strategy3-latest", runId: "strategy3-20260713-20260713130531", count: 77, emittedRows: 77, date: "20260713", reason: "scorecard_release_latest_pointer" },
  { key: "strategy4", strategy: "strategy4", endpoint: "/api/strategy4-latest", runId: "strategy4-20260713-20260713095129", count: 332, emittedRows: 70, date: "20260713", reason: "scorecard_release_latest_pointer" },
  { key: "strategy5", strategy: "strategy5", endpoint: "/api/strategy5-latest", runId: "strategy5-20260714-20260714140711", count: 54, emittedRows: 54, date: "20260714", reason: "scorecard_release_latest_pointer" },
  { key: "institution", strategy: "institution", endpoint: "/api/institution-latest", runId: "institution-20260713-20260713131707", count: 264, emittedRows: 264, date: "20260713", reason: "scorecard_release_latest_pointer" },
  { key: "cb", strategy: "cb", endpoint: "/api/cb-detect-latest", runId: "cb-detect-20260713-214529", count: 9, emittedRows: 9, date: "20260713", reason: "scorecard_release_latest_pointer" },
  { key: "warrant", strategy: "warrant", endpoint: "/api/warrant-flow-latest", runId: "warrant-flow-20260714-20260714134242", count: 327, emittedRows: 120, date: "20260714", reason: "scorecard_release_latest_pointer" },
];

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replace(/\D/g, "");
}

function releaseSourceReports() {
  const today = taipeiDateKey();
  return RELEASE_SOURCE_REPORTS.map((report) => {
    const reportDate = cleanText(report.date || RELEASE_SOURCE_REPORT_DATE);
    const releaseStale = reportDate < today;
    const staleReason = releaseStale
      ? "scorecard_release_source_reports_stale_display_only_previous_good:" + reportDate + "<" + today
      : "";
    return {
      ...report,
      statusCode: 200,
      ok: releaseStale ? false : true,
      resultCount: cleanNumber(report.count),
      readbackCount: cleanNumber(report.count),
      expectedTotal: cleanNumber(report.count),
      scannedCount: cleanNumber(report.count),
      sourceDate: compactDateToIso(report.date) || cleanText(report.date),
      source_date: compactDateToIso(report.date) || cleanText(report.date),
      tradeDate: compactDateToIso(report.date) || cleanText(report.date),
      usedDate: compactDateToIso(report.date) || cleanText(report.date),
      evidenceStatus: releaseStale ? "insufficient" : "complete",
      unattendedStatus: releaseStale ? "NO" : "YES",
      publishAllowed: releaseStale ? false : true,
      latestOverwriteAllowed: false,
      preservePreviousGood: releaseStale ? true : false,
      fallbackUsed: releaseStale ? true : false,
      fallbackAllowed: releaseStale ? false : true,
      fallbackScope: releaseStale ? ["release-source-report", "display-only-previous-good"] : [],
      degradedBlocksLatest: releaseStale ? true : false,
      latestWriteAttempted: false,
      latestPointerUpdated: false,
      blockedReason: releaseStale ? staleReason : "",
      scanner_block_reason: releaseStale ? staleReason : "",
      reason: releaseStale ? staleReason : report.reason,
    };
  });
}
const LIGHTWEIGHT_SOURCE_REPORTS = [
  { key: "strategy2", strategy: "strategy2", endpoint: "/api/strategy2-latest", table: "v_strategy2_latest_complete_run", strategyFilter: "strategy2", order: "" },
  { key: "strategy3", strategy: "strategy3", endpoint: "/api/strategy3-latest", table: "v_strategy3_latest_complete_run", strategyFilter: "strategy3", order: "" },
  { key: "strategy4", strategy: "strategy4", endpoint: "/api/strategy4-latest", table: "strategy4_scan_runs", strategyFilter: "strategy4", order: "finished_at.desc" },
  { key: "strategy5", strategy: "strategy5", endpoint: "/api/strategy5-latest", table: "v_strategy5_latest_complete_run", strategyFilter: "strategy5", order: "" },
  { key: "institution", strategy: "institution", endpoint: "/api/institution-latest", table: "v_institution_latest_complete_run", strategyFilter: "institution", order: "" },
  { key: "cb", strategy: "cb", endpoint: "/api/cb-detect-latest", table: "cb_detect_scan_runs", strategyFilter: "cb_detect", order: "finished_at.desc" },
  { key: "warrant", strategy: "warrant", endpoint: "/api/warrant-flow-latest", table: "v_warrant_flow_latest_complete_run", strategyFilter: "warrant_flow", order: "" },
];

async function buildLightweightSourceReport(config) {
  const payload = await latestRunFallbackPayload({
    table: config.table,
    strategy: config.strategyFilter,
    order: config.order,
    error: `${config.key}_latest_pointer_missing`,
  });
  const runId = cleanText(payload.runId);
  const ok = !isBlank(runId);
  const reason = ok ? "" : cleanText(payload.reason || payload.error || `${config.key}_latest_pointer_missing`);
  return {
    key: config.key,
    strategy: config.strategy,
    endpoint: config.endpoint,
    statusCode: ok ? 200 : 504,
    ok,
    runId,
    count: cleanNumber(payload.count || payload.resultCount),
    emittedRows: cleanNumber(payload.count || payload.resultCount),
    date: cleanText(payload.usedDate || payload.tradeDate),
    reason,
    resultCount: cleanNumber(payload.resultCount || payload.count),
    readbackCount: cleanNumber(payload.readbackCount || payload.count),
    expectedTotal: cleanNumber(payload.expectedTotal),
    scannedCount: cleanNumber(payload.scannedCount),
    sourceSnapshotCapturedAt: cleanText(payload.source_snapshot_captured_at),
    evidenceStatus: ok ? "complete" : "insufficient",
    unattendedStatus: ok ? "YES" : "NO",
    publishAllowed: ok,
    latestOverwriteAllowed: false,
    preservePreviousGood: !ok,
    fallbackUsed: false,
    blockedReason: reason,
  };
}
function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return !Number.isFinite(value);
  if (typeof value === "boolean") return false;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  const text = String(value).trim();
  return !text || text === "--" || /^n\/a$/i.test(text) || /^null$/i.test(text) || /^undefined$/i.test(text);
}

function isoDate(value) {
  const text = cleanText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function compactDate(value) {
  return cleanText(value).replace(/\D/g, "").slice(0, 8);
}

function compactDateToIso(value) {
  const date = compactDate(value);
  return date.length === 8 ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : "";
}

function compactTimestamp(value) {
  return cleanText(value).replace(/\D/g, "").slice(0, 14);
}

function createCaptureResponse(resolve) {
  let settled = false;
  const done = (statusCode, payload) => {
    if (settled) return;
    settled = true;
    resolve({ statusCode, payload });
  };
  return {
    statusCode: 200,
    setHeader() {},
    status(code) {
      this.statusCode = Number(code) || 200;
      return this;
    },
    json(payload) {
      done(this.statusCode || 200, payload);
      return this;
    },
    send(payload) {
      done(this.statusCode || 200, payload);
      return this;
    },
    end(payload = "") {
      done(this.statusCode || 204, payload);
      return this;
    },
  };
}

function buildFastCompleteRunPayload(row = {}, { source = "supabase:latest_complete_run", defaultEvidenceStatus = "complete", defaultUnattendedStatus = "YES" } = {}) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const quality = payload.run_quality_at_publish && typeof payload.run_quality_at_publish === "object" ? payload.run_quality_at_publish : {};
  const runId = cleanText(row.run_id || row.runId || payload.runId || payload.transport?.runId);
  const resultCount = cleanNumber(row.result_count ?? row.match_count ?? row.matches ?? payload.resultCount ?? payload.count ?? quality.resultCount);
  const readbackCount = cleanNumber(row.readback_count ?? payload.readbackCount ?? quality.readbackCount ?? row.result_count ?? payload.resultCount ?? payload.count);
  const expectedTotal = cleanNumber(row.expected_total ?? row.total_count ?? row.total ?? payload.expectedTotal ?? payload.total ?? quality.expectedTotal);
  const scannedCount = cleanNumber(row.scanned_count ?? row.scanned ?? payload.scannedCount ?? quality.scannedCount ?? row.expected_total ?? row.total_count);
  const complete = row.complete === true || cleanText(row.status).toLowerCase() === "complete" || payload.complete === true;
  const publishAllowed = payload.publishAllowed ?? quality.publishAllowed ?? complete;
  const evidenceStatus = cleanText(payload.evidenceStatus || payload.unattended?.evidenceStatus || quality.evidenceStatus || (complete ? defaultEvidenceStatus : "insufficient"));
  const unattendedStatus = cleanText(payload.unattendedStatus || payload.unattended?.status || quality.unattendedStatus || (publishAllowed ? defaultUnattendedStatus : "NO"));
  return {
    ok: Boolean(runId) && (payload.ok !== false),
    source,
    cacheSource: "scorecard-source-report-fast",
    runId,
    usedDate: cleanText(payload.usedDate || payload.sourceDate || payload.tradeDate || row.scan_date || row.trade_date || row.used_date || row.date),
    sourceDate: cleanText(payload.sourceDate || payload.usedDate || payload.tradeDate || row.scan_date || row.trade_date || row.used_date || row.date),
    tradeDate: cleanText(payload.tradeDate || payload.sourceDate || payload.usedDate || row.trade_date || row.scan_date || row.used_date || row.date),
    count: resultCount,
    resultCount,
    readbackCount,
    expectedTotal,
    scannedCount,
    source_snapshot_captured_at: cleanText(payload.source_snapshot_captured_at || payload.sourceSnapshotCapturedAt || row.finished_at || row.updated_at || row.generated_at || row.started_at),
    evidenceStatus,
    unattendedStatus,
    publishAllowed: publishAllowed === true,
    latestOverwriteAllowed: payload.latestOverwriteAllowed === true || quality.latestOverwriteAllowed === true,
    preservePreviousGood: payload.preservePreviousGood ?? quality.preservePreviousGood ?? true,
    fallbackUsed: Boolean(payload.fallbackUsed || quality.fallbackUsed),
    blockedReason: cleanText(payload.blockedReason || payload.scanner_block_reason || quality.blockedReason || ""),
    run_quality_at_publish: {
      ...quality,
      resultCount,
      readbackCount,
      expectedTotal,
      scannedCount,
      publishAllowed: publishAllowed === true,
    },
  };
}

async function callFastCompleteRunSourceReport(config = {}, fallbackCall) {
  const {
    table,
    strategy = "",
    strategyColumn = "strategy",
    order = "finished_at.desc",
    select = "*",
    timeoutMs = 5000,
    source = table ? `supabase:${table}` : "supabase:latest_complete_run",
  } = config;
  if (!table) return typeof fallbackCall === "function" ? fallbackCall() : { statusCode: 500, payload: { ok: false, error: "fast_source_report_table_missing" } };
  try {
    const params = [`select=${encodeURIComponent(select)}`, "limit=1"];
    if (strategy) params.push(`${strategyColumn}=eq.${encodeURIComponent(strategy)}`);
    if (order) params.push(`order=${encodeURIComponent(order)}`);
    const rows = await fetchSupabaseRows(table, params.join("&"), timeoutMs);
    const row = rows[0] || null;
    const payload = row ? buildFastCompleteRunPayload(row, { source }) : null;
    if (payload?.runId) return { statusCode: 200, payload };
  } catch (error) {
    // Fall through to the API handler; the handler may expose richer blocked evidence.
  }
  return typeof fallbackCall === "function" ? fallbackCall() : { statusCode: 404, payload: { ok: false, error: "fast_source_report_missing" } };
}

function callStrategy3Latest(timeoutMs = 12000) {
  return new Promise((resolve) => {
    let timer = null;
    try {
      const handler = require("./strategy3-latest");
      const query = {
        canvas: "1",
        compact: "1",
        shell: "1",
        live: "1",
        limit: "60",
      };
      timer = setTimeout(async () => resolve({
        statusCode: 504,
        payload: await latestRunFallbackPayload({ table: "v_strategy3_latest_complete_run", strategy: "strategy3", order: "", error: "strategy3_source_report_timeout" }),
      }), timeoutMs);
      const finish = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      Promise.resolve(handler({
        method: "GET",
        url: "/api/strategy3-latest?canvas=1&compact=1&shell=1&live=1&limit=60",
        headers: { host: "localhost", "x-scorecard-source": "1" },
        query,
        fumanInternalVerify: true,
      }, createCaptureResponse(finish))).catch((error) => {
        finish({
          statusCode: 500,
          payload: { ok: false, error: "strategy3_source_report_failed", reason: error?.message || String(error) },
        });
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      resolve({
        statusCode: 500,
        payload: { ok: false, error: "strategy3_source_report_failed", reason: error?.message || String(error) },
      });
    }
  });
}

function callStrategy2Latest(timeoutMs = Number(process.env.STRATEGY2_SCORECARD_SOURCE_TIMEOUT_MS || 9000)) {
  return new Promise((resolve) => {
    let timer = null;
    try {
      const handler = require("./strategy2-latest");
      const query = {
        canvas: "1",
        compact: "1",
        shell: "1",
        live: "1",
        today: "1",
        verify: "1",
        top: "1",
      };
      timer = setTimeout(() => resolve(readStrategy2ScorecardFallbackResult("strategy2_source_report_timeout_display_only_previous_good") || {
        statusCode: 504,
        payload: { ok: false, error: "strategy2_source_report_timeout" },
      }), timeoutMs);
      const finish = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      Promise.resolve(handler({
        method: "GET",
        url: "/api/strategy2-latest?canvas=1&compact=1&shell=1&live=1&today=1&verify=1&top=1",
        headers: { host: "localhost", "x-scorecard-source": "1" },
        query,
        fumanInternalVerify: true,
      }, createCaptureResponse(finish))).catch((error) => {
        finish({
          statusCode: 500,
          payload: { ok: false, error: "strategy2_source_report_failed", reason: error?.message || String(error) },
        });
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      resolve({
        statusCode: 500,
        payload: { ok: false, error: "strategy2_source_report_failed", reason: error?.message || String(error) },
      });
    }
  });
}

function callStrategy4Latest(timeoutMs = 12000) {
  return new Promise((resolve) => {
    let timer = null;
    try {
      const handler = require("./strategy4-latest");
      const query = {
        canvas: "1",
        compact: "1",
        shell: "1",
        live: "1",
        limit: "70",
      };
      timer = setTimeout(async () => resolve({
        statusCode: 504,
        payload: await latestRunFallbackPayload({ table: "strategy4_scan_runs", strategy: "strategy4", order: "finished_at.desc", error: "strategy4_source_report_timeout" }),
      }), timeoutMs);
      const finish = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      Promise.resolve(handler({
        method: "GET",
        url: "/api/strategy4-latest?canvas=1&compact=1&shell=1&live=1&limit=70",
        headers: { host: "localhost", "x-scorecard-source": "1" },
        query,
        fumanInternalVerify: true,
      }, createCaptureResponse(finish))).catch((error) => {
        finish({
          statusCode: 500,
          payload: { ok: false, error: "strategy4_source_report_failed", reason: error?.message || String(error) },
        });
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      resolve({
        statusCode: 500,
        payload: { ok: false, error: "strategy4_source_report_failed", reason: error?.message || String(error) },
      });
    }
  });
}

function callCbDetectLatest(timeoutMs = 12000) {
  return new Promise((resolve) => {
    let timer = null;
    try {
      const handler = require("./cb-detect-latest");
      const query = {
        canvas: "1",
        compact: "1",
        shell: "1",
        live: "1",
        limit: "60",
      };
      timer = setTimeout(() => resolve({
        statusCode: 504,
        payload: { ok: false, error: "cb_source_report_timeout" },
      }), timeoutMs);
      const finish = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      Promise.resolve(handler({
        method: "GET",
        url: "/api/cb-detect-latest?canvas=1&compact=1&shell=1&live=1&limit=60",
        headers: { host: "localhost", "x-scorecard-source": "1" },
        query,
        fumanInternalVerify: true,
      }, createCaptureResponse(finish))).catch((error) => {
        finish({
          statusCode: 500,
          payload: { ok: false, error: "cb_source_report_failed", reason: error?.message || String(error) },
        });
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      resolve({
        statusCode: 500,
        payload: { ok: false, error: "cb_source_report_failed", reason: error?.message || String(error) },
      });
    }
  });
}

function callWarrantLatest(timeoutMs = 12000) {
  return new Promise((resolve) => {
    let timer = null;
    try {
      const handler = require("./warrant-flow-latest");
      const query = {
        canvas: "1",
        compact: "1",
        shell: "1",
        live: "1",
        limit: "500",
      };
      timer = setTimeout(() => resolve({
        statusCode: 504,
        payload: { ok: false, error: "warrant_source_report_timeout" },
      }), timeoutMs);
      const finish = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      Promise.resolve(handler({
        method: "GET",
        url: "/api/warrant-flow-latest?canvas=1&compact=1&shell=1&live=1&limit=500",
        headers: { host: "localhost", "x-scorecard-source": "1" },
        query,
        fumanInternalVerify: true,
      }, createCaptureResponse(finish))).catch((error) => {
        finish({
          statusCode: 500,
          payload: { ok: false, error: "warrant_source_report_failed", reason: error?.message || String(error) },
        });
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      resolve({
        statusCode: 500,
        payload: { ok: false, error: "warrant_source_report_failed", reason: error?.message || String(error) },
      });
    }
  });
}
function callStrategy5Latest(timeoutMs = 12000) {
  return new Promise((resolve) => {
    let timer = null;
    try {
      const handler = require("./strategy5-latest");
      const query = {
        canvas: "1",
        compact: "1",
        shell: "1",
        live: "1",
        limit: "70",
      };
      timer = setTimeout(() => resolve({
        statusCode: 504,
        payload: { ok: false, error: "strategy5_source_report_timeout" },
      }), timeoutMs);
      const finish = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      Promise.resolve(handler({
        method: "GET",
        url: "/api/strategy5-latest?canvas=1&compact=1&shell=1&live=1&limit=70",
        headers: { host: "localhost", "x-scorecard-source": "1" },
        query,
        fumanInternalVerify: true,
      }, createCaptureResponse(finish))).catch((error) => {
        finish({
          statusCode: 500,
          payload: { ok: false, error: "strategy5_source_report_failed", reason: error?.message || String(error) },
        });
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      resolve({
        statusCode: 500,
        payload: { ok: false, error: "strategy5_source_report_failed", reason: error?.message || String(error) },
      });
    }
  });
}

function readStrategy5RuntimeReceiptFallback(reason = "") {
  const runtimeDir = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
  const receiptPath = path.join(runtimeDir, "data", "scan-receipts", "strategy5.json");
  try {
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    const runId = cleanText(receipt.runId);
    const runDate = (runId.match(/^strategy5-(\d{8})-/) || [])[1] || "";
    const count = cleanNumber(receipt.matches ?? receipt.resultCount ?? receipt.count);
    if (receipt.status !== "complete" || !runId || count <= 0) return null;
    return {
      statusCode: 200,
      payload: {
        ok: true,
        source: "runtime:strategy5_scan_receipt_preserve_previous_good",
        cacheSource: "scorecard-source-report-runtime-receipt",
        runId,
        usedDate: runDate,
        sourceDate: runDate,
        count,
        resultCount: count,
        readbackCount: count,
        expectedTotal: cleanNumber(receipt.total),
        scannedCount: cleanNumber(receipt.scanned),
        source_snapshot_captured_at: cleanText(receipt.finishedAt || receipt.startedAt),
        evidenceStatus: cleanText(receipt.qualityStatus || "complete"),
        unattendedStatus: receipt.fallback ? "NO" : "YES",
        publishAllowed: receipt.complete === true && receipt.fallback !== true,
        latestOverwriteAllowed: false,
        preservePreviousGood: true,
        fallbackUsed: Boolean(receipt.fallback),
        blockedReason: cleanText(receipt.blockingReason || reason),
        run_quality_at_publish: {
          resultCount: count,
          readbackCount: count,
          expectedTotal: cleanNumber(receipt.total),
          scannedCount: cleanNumber(receipt.scanned),
          publishAllowed: receipt.complete === true && receipt.fallback !== true,
        },
      },
    };
  } catch {
    return null;
  }
}
async function callStrategy5SourceReportFast() {
  try {
    const rows = await fetchSupabaseRows(
      "v_strategy5_latest_complete_run",
      [
        "select=run_id,strategy,scan_date,started_at,finished_at,status,expected_total,scanned_count,result_count,complete,quality_status,source,schema_version,data_contract_source,generated_at,updated_at,payload",
        "strategy=eq.strategy5",
        "status=eq.complete",
        "complete=eq.true",
        "limit=1",
      ].join("&"),
      8000
    );
    const run = rows[0] || null;
    if (!run?.run_id) {
      return {
        statusCode: 404,
        payload: { ok: false, error: "strategy5_latest_pointer_missing" },
      };
    }
    const payload = run.payload && typeof run.payload === "object" ? run.payload : {};
    const resultCount = cleanNumber(run.result_count ?? payload.resultCount ?? payload.count);
    const readbackCount = cleanNumber(payload.readbackCount ?? run.readback_count ?? run.result_count);
    const expectedTotal = cleanNumber(run.expected_total ?? payload.expectedTotal ?? payload.total);
    const scannedCount = cleanNumber(run.scanned_count ?? payload.scannedCount ?? payload.total);
    return {
      statusCode: 200,
      payload: {
        ok: true,
        source: "supabase:v_strategy5_latest_complete_run",
        cacheSource: "scorecard-source-report-fast",
        runId: cleanText(run.run_id),
        usedDate: cleanText(payload.usedDate || payload.sourceDate || run.scan_date),
        sourceDate: cleanText(payload.sourceDate || payload.usedDate || run.scan_date),
        count: resultCount,
        resultCount,
        readbackCount,
        expectedTotal,
        scannedCount,
        source_snapshot_captured_at: cleanText(payload.source_snapshot_captured_at || payload.sourceSnapshotCapturedAt || run.updated_at || run.generated_at),
        evidenceStatus: cleanText(payload.evidenceStatus || "complete"),
        unattendedStatus: cleanText(payload.unattendedStatus || "YES"),
        publishAllowed: payload.run_quality_at_publish?.publishAllowed ?? true,
        latestOverwriteAllowed: false,
        preservePreviousGood: payload.preservePreviousGood ?? true,
        fallbackUsed: Boolean(payload.fallbackUsed),
        blockedReason: cleanText(payload.blockedReason || ""),
        run_quality_at_publish: {
          ...(payload.run_quality_at_publish && typeof payload.run_quality_at_publish === "object" ? payload.run_quality_at_publish : {}),
          resultCount,
          readbackCount,
          expectedTotal,
          scannedCount,
          publishAllowed: payload.run_quality_at_publish?.publishAllowed ?? true,
        },
      },
    };
  } catch (error) {
    const reason = error?.message || String(error);
    const fallback = readStrategy5RuntimeReceiptFallback(reason);
    if (fallback) return fallback;
    return {
      statusCode: 500,
      payload: { ok: false, error: "strategy5_source_report_fast_failed", reason },
    };
  }
}
function callInstitutionLatest(timeoutMs = 12000) {
  return new Promise((resolve) => {
    let timer = null;
    try {
      const handler = require("./institution-latest");
      const query = {
        canvas: "1",
        compact: "1",
        shell: "1",
        live: "1",
        limit: "1200",
      };
      timer = setTimeout(() => resolve({
        statusCode: 504,
        payload: { ok: false, error: "institution_source_report_timeout" },
      }), timeoutMs);
      const finish = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      Promise.resolve(handler({
        method: "GET",
        url: "/api/institution-latest?canvas=1&compact=1&shell=1&live=1&limit=1200",
        headers: { host: "localhost", "x-scorecard-source": "1" },
        query,
        fumanInternalVerify: true,
      }, createCaptureResponse(finish))).catch((error) => {
        finish({
          statusCode: 500,
          payload: { ok: false, error: "institution_source_report_failed", reason: error?.message || String(error) },
        });
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      resolve({
        statusCode: 500,
        payload: { ok: false, error: "institution_source_report_failed", reason: error?.message || String(error) },
      });
    }
  });
}

function callSevenStrategyDailyHistory(timeoutMs = 12000) {
  return new Promise((resolve) => {
    let timer = null;
    try {
      const handler = require("./seven-strategy-daily-history");
      timer = setTimeout(() => resolve({
        statusCode: 504,
        payload: { ok: false, error: "seven_strategy_daily_history_timeout" },
      }), timeoutMs);
      const finish = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      Promise.resolve(handler({
        method: "GET",
        url: "/api/seven-strategy-daily-history?limit=100",
        headers: { host: "localhost", "x-scorecard-source": "1" },
        query: { limit: "100" },
      }, createCaptureResponse(finish))).catch((error) => {
        finish({
          statusCode: 500,
          payload: { ok: false, error: "seven_strategy_daily_history_failed", reason: error?.message || String(error) },
        });
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      resolve({
        statusCode: 500,
        payload: { ok: false, error: "seven_strategy_daily_history_failed", reason: error?.message || String(error) },
      });
    }
  });
}

function callDaytradeEntryHistory(timeoutMs = 12000) {
  return new Promise((resolve) => {
    let timer = null;
    try {
      const handler = require("./daytrade-entry-history");
      timer = setTimeout(() => resolve({
        statusCode: 504,
        payload: { ok: false, error: "daytrade_entry_history_timeout" },
      }), timeoutMs);
      const finish = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      Promise.resolve(handler({
        method: "GET",
        url: "/api/daytrade-entry-history?limit=300",
        headers: { host: "localhost", "x-scorecard-source": "1" },
        query: { limit: "300" },
      }, createCaptureResponse(finish))).catch((error) => {
        finish({
          statusCode: 500,
          payload: { ok: false, error: "daytrade_entry_history_failed", reason: error?.message || String(error) },
        });
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      resolve({
        statusCode: 500,
        payload: { ok: false, error: "daytrade_entry_history_failed", reason: error?.message || String(error) },
      });
    }
  });
}

function buildStrategy4SourceReport(result) {
  const payload = result?.payload && typeof result.payload === "object" ? result.payload : {};
  const quality = payload.run_quality_at_publish && typeof payload.run_quality_at_publish === "object"
    ? payload.run_quality_at_publish
    : {};
  const runId = cleanText(payload.runId || payload.transport?.runId);
  const runDate = (runId.match(/^strategy4-(\d{8})-/) || [])[1] || "";
  const date = cleanText(payload.usedDate || payload.tradeDate || payload.sourceDate || payload.date || runDate);
  const iso = compactDateToIso(runDate || date) || date;
  const publishAllowed = payload.publishAllowed === true || quality.publishAllowed === true;
  return {
    key: "strategy4",
    strategy: "strategy4",
    endpoint: "/api/strategy4-latest",
    statusCode: Number(result?.statusCode || 0) || 0,
    ok: payload.ok !== false && Number(result?.statusCode || 0) < 400,
    runId,
    count: cleanNumber(payload.count ?? payload.resultCount ?? payload.total),
    emittedRows: Array.isArray(payload.rows) ? payload.rows.length : Array.isArray(payload.matches) ? payload.matches.length : 0,
    resultCount: cleanNumber(payload.resultCount ?? quality.resultCount),
    readbackCount: cleanNumber(payload.readbackCount ?? quality.readbackCount),
    expectedTotal: cleanNumber(payload.expectedTotal ?? quality.expectedTotal),
    scannedCount: cleanNumber(payload.scannedCount ?? quality.scannedCount),
    date: runDate || compactDate(date) || date,
    sourceDate: iso,
    source_date: iso,
    tradeDate: iso,
    usedDate: iso,
    sourceSnapshotCapturedAt: cleanText(payload.source_snapshot_captured_at),
    evidenceStatus: cleanText(payload.evidenceStatus || payload.unattended?.evidenceStatus || quality.evidenceStatus),
    unattendedStatus: cleanText(payload.unattendedStatus || payload.unattended?.status || quality.unattendedStatus),
    publishAllowed,
    latestOverwriteAllowed: payload.latestOverwriteAllowed === true || quality.latestOverwriteAllowed === true,
    preservePreviousGood: publishAllowed ? false : (payload.preservePreviousGood === true || quality.preservePreviousGood === true),
    fallbackUsed: payload.fallbackUsed === true || quality.fallbackUsed === true,
    fallbackAllowed: payload.fallbackAllowed === true || quality.fallbackAllowed === true,
    fallbackScope: Array.isArray(payload.fallbackScope) ? payload.fallbackScope : [],
    degradedBlocksLatest: publishAllowed ? false : (payload.degradedBlocksLatest === true || quality.degradedBlocksLatest === true),
    latestWriteAttempted: payload.latestWriteAttempted === true || quality.latestWriteAttempted === true,
    latestPointerUpdated: payload.latestPointerUpdated === true || quality.latestPointerUpdated === true,
    blockedReason: cleanText(payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
    scanner_block_reason: cleanText(payload.scanner_block_reason || payload.blockedReason || quality.blockedReason),
    reason: cleanText(payload.reason || payload.detail || payload.error || payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
  };
}function buildStrategy5SourceReport(result) {
  const payload = result?.payload && typeof result.payload === "object" ? result.payload : {};
  const quality = payload.run_quality_at_publish && typeof payload.run_quality_at_publish === "object"
    ? payload.run_quality_at_publish
    : {};
  return {
    key: "strategy5",
    strategy: "策略5成績單",
    endpoint: "/api/strategy5-latest",
    statusCode: Number(result?.statusCode || 0) || 0,
    ok: payload.ok !== false && Number(result?.statusCode || 0) < 400,
    runId: cleanText(payload.runId || payload.transport?.runId),
    count: cleanNumber(payload.count ?? payload.resultCount ?? payload.total),
    emittedRows: Array.isArray(payload.rows) ? payload.rows.length : Array.isArray(payload.matches) ? payload.matches.length : 0,
    resultCount: cleanNumber(payload.resultCount ?? quality.resultCount),
    readbackCount: cleanNumber(payload.readbackCount ?? quality.readbackCount),
    expectedTotal: cleanNumber(payload.expectedTotal ?? quality.expectedTotal),
    scannedCount: cleanNumber(payload.scannedCount ?? quality.scannedCount),
    date: cleanText(payload.usedDate || payload.tradeDate || payload.sourceDate || payload.date),
    sourceSnapshotCapturedAt: cleanText(payload.source_snapshot_captured_at),
    evidenceStatus: cleanText(payload.evidenceStatus || payload.unattended?.evidenceStatus || quality.evidenceStatus),
    unattendedStatus: cleanText(payload.unattendedStatus || payload.unattended?.status || quality.unattendedStatus),
    publishAllowed: payload.publishAllowed === true || quality.publishAllowed === true,
    latestOverwriteAllowed: payload.latestOverwriteAllowed === true || quality.latestOverwriteAllowed === true,
    preservePreviousGood: payload.preservePreviousGood === true || quality.preservePreviousGood === true,
    fallbackUsed: payload.fallbackUsed === true || quality.fallbackUsed === true,
    blockedReason: cleanText(payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
    reason: cleanText(payload.reason || payload.detail || payload.error || payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
  };
}

function buildStrategy2SourceReport(result) {
  const payload = result?.payload && typeof result.payload === "object" ? result.payload : {};
  const quality = payload.run_quality_at_publish && typeof payload.run_quality_at_publish === "object"
    ? payload.run_quality_at_publish
    : {};
  return {
    key: "strategy2",
    strategy: "策略2當沖成績單",
    endpoint: "/api/strategy2-latest",
    statusCode: Number(result?.statusCode || 0) || 0,
    ok: payload.ok !== false && Number(result?.statusCode || 0) < 400,
    runId: cleanText(payload.runId || payload.transport?.runId),
    count: cleanNumber(payload.count ?? payload.resultCount ?? payload.total),
    emittedRows: Array.isArray(payload.rows) ? payload.rows.length : Array.isArray(payload.matches) ? payload.matches.length : 0,
    date: cleanText(payload.usedDate || payload.tradeDate || payload.sourceDate || payload.date),
    evidenceStatus: cleanText(payload.evidenceStatus || payload.unattended?.evidenceStatus || quality.evidenceStatus),
    unattendedStatus: cleanText(payload.unattendedStatus || payload.unattended?.status || quality.unattendedStatus),
    publishAllowed: payload.publishAllowed === true || quality.publishAllowed === true,
    latestOverwriteAllowed: payload.latestOverwriteAllowed === true || quality.latestOverwriteAllowed === true,
    preservePreviousGood: payload.preservePreviousGood === true || quality.preservePreviousGood === true,
    fallbackUsed: payload.fallbackUsed === true || quality.fallbackUsed === true,
    blockedReason: cleanText(payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
    reason: cleanText(payload.reason || payload.detail || payload.error || payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
  };
}

function buildStrategy3SourceReport(result) {
  const payload = result?.payload && typeof result.payload === "object" ? result.payload : {};
  const quality = payload.run_quality_at_publish && typeof payload.run_quality_at_publish === "object"
    ? payload.run_quality_at_publish
    : {};
  return {
    key: "strategy3",
    strategy: "策略3隔日沖成績單",
    endpoint: "/api/strategy3-latest",
    statusCode: Number(result?.statusCode || 0) || 0,
    ok: payload.ok !== false && Number(result?.statusCode || 0) < 400,
    runId: cleanText(payload.runId || payload.transport?.runId),
    count: cleanNumber(payload.count ?? payload.resultCount ?? payload.total),
    emittedRows: Array.isArray(payload.rows) ? payload.rows.length : Array.isArray(payload.matches) ? payload.matches.length : 0,
    date: cleanText(payload.usedDate || payload.tradeDate || payload.sourceDate || payload.date),
    evidenceStatus: cleanText(payload.evidenceStatus || quality.evidenceStatus),
    unattendedStatus: cleanText(payload.unattendedStatus || quality.unattendedStatus),
    publishAllowed: payload.publishAllowed === true || quality.publishAllowed === true,
    latestOverwriteAllowed: payload.latestOverwriteAllowed === true || quality.latestOverwriteAllowed === true,
    preservePreviousGood: payload.preservePreviousGood === true || quality.preservePreviousGood === true,
    blockedReason: cleanText(payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
    reason: cleanText(payload.reason || payload.detail || payload.error || payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
  };
}

function buildCbSourceReport(result) {
  const payload = result?.payload && typeof result.payload === "object" ? result.payload : {};
  const quality = payload.run_quality_at_publish && typeof payload.run_quality_at_publish === "object"
    ? payload.run_quality_at_publish
    : {};
  return {
    key: "cb",
    strategy: "CB成績單",
    endpoint: "/api/cb-detect-latest",
    statusCode: Number(result?.statusCode || 0) || 0,
    ok: payload.ok !== false && Number(result?.statusCode || 0) < 400,
    runId: cleanText(payload.runId || payload.transport?.runId),
    count: cleanNumber(payload.count ?? payload.resultCount ?? payload.total),
    emittedRows: Array.isArray(payload.rows) ? payload.rows.length : Array.isArray(payload.matches) ? payload.matches.length : 0,
    date: cleanText(payload.usedDate || payload.tradeDate || payload.sourceDate || payload.date),
    evidenceStatus: cleanText(payload.evidenceStatus || quality.evidenceStatus),
    unattendedStatus: cleanText(payload.unattendedStatus || quality.unattendedStatus),
    publishAllowed: payload.publishAllowed === true || quality.publishAllowed === true,
    latestOverwriteAllowed: payload.latestOverwriteAllowed === true || quality.latestOverwriteAllowed === true,
    preservePreviousGood: payload.preservePreviousGood === true || quality.preservePreviousGood === true,
    fallbackUsed: payload.fallbackUsed === true || quality.fallbackUsed === true,
    blockedReason: cleanText(payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
    reason: cleanText(payload.reason || payload.detail || payload.error || payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
  };
}

function buildWarrantSourceReport(result) {
  const payload = result?.payload && typeof result.payload === "object" ? result.payload : {};
  const quality = payload.run_quality_at_publish && typeof payload.run_quality_at_publish === "object"
    ? payload.run_quality_at_publish
    : {};
  return {
    key: "warrant",
    strategy: "權證成績單",
    endpoint: "/api/warrant-flow-latest",
    statusCode: Number(result?.statusCode || 0) || 0,
    ok: payload.ok !== false && Number(result?.statusCode || 0) < 400,
    runId: cleanText(payload.runId || payload.transport?.runId),
    count: cleanNumber(payload.count ?? payload.resultCount ?? quality.resultCount ?? payload.total),
    emittedRows: Array.isArray(payload.rows) ? payload.rows.length : Array.isArray(payload.matches) ? payload.matches.length : 0,
    resultCount: cleanNumber(payload.resultCount ?? quality.resultCount),
    readbackCount: cleanNumber(payload.readbackCount ?? quality.readbackCount),
    date: cleanText(payload.usedDate || payload.tradeDate || payload.sourceDate || payload.date),
    evidenceStatus: cleanText(payload.evidenceStatus || quality.evidenceStatus),
    unattendedStatus: cleanText(payload.unattendedStatus || quality.unattendedStatus),
    publishAllowed: payload.publishAllowed === true || quality.publishAllowed === true,
    latestOverwriteAllowed: payload.latestOverwriteAllowed === true || quality.latestOverwriteAllowed === true,
    preservePreviousGood: payload.preservePreviousGood === true || quality.preservePreviousGood === true,
    fallbackUsed: payload.fallbackUsed === true || quality.fallbackUsed === true,
    blockedReason: cleanText(payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
    reason: cleanText(payload.reason || payload.detail || payload.error || payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
  };
}
function buildSevenStrategyDailyHistorySourceReport(result) {
  const payload = result?.payload && typeof result.payload === "object" ? result.payload : {};
  return {
    key: "seven_strategy_daily_history",
    strategy: "七策略每日紀錄",
    endpoint: "/api/seven-strategy-daily-history",
    statusCode: Number(result?.statusCode || 0) || 0,
    ok: payload.ok !== false && Number(result?.statusCode || 0) < 400,
    runId: cleanText(payload.runId || `seven-strategy-daily-history-${payload.tradeDate || "unknown"}`),
    count: cleanNumber(payload.count ?? payload.totalKept ?? 0),
    emittedRows: Array.isArray(payload.rows) ? payload.rows.length : 0,
    date: cleanText(payload.tradeDate),
    sourceName: cleanText(payload.sourceName || "seven_strategy_daily_history"),
    source: cleanText(payload.source || "supabase:public.seven_strategy_daily_history"),
    table: cleanText(payload.table || "public.seven_strategy_daily_history"),
    timeWindow: payload.timeWindow || { from: "09:00:00", to: "13:30:00", timezone: "Asia/Taipei" },
    formalCount: cleanNumber(payload.formalCount),
    detectedCount: cleanNumber(payload.detectedCount),
    strategyDistribution: payload.strategyDistribution || {},
    evidenceStatus: payload.ok === false ? "insufficient" : "complete",
    unattendedStatus: payload.ok === false ? "NO" : "YES",
    publishAllowed: payload.ok !== false,
    latestOverwriteAllowed: payload.ok !== false,
    preservePreviousGood: payload.ok === false,
    fallbackUsed: false,
    blockedReason: payload.ok === false ? cleanText(payload.reason || payload.error || "seven_strategy_daily_history_unavailable") : "",
    reason: cleanText(payload.reason || payload.error || ""),
  };
}

function buildDaytradeEntryHistorySourceReport(result) {
  const payload = result?.payload && typeof result.payload === "object" ? result.payload : {};
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const firstRunId = cleanText(rows.find((row) => cleanText(row?.run_id))?.run_id);
  const runDate = cleanText(payload.tradeDate || payload.requestedDate || "unknown");
  return {
    key: "daytrade_entry_history",
    strategy: "當沖 PS1 今日進場紀錄",
    endpoint: "/api/daytrade-entry-history",
    statusCode: Number(result?.statusCode || 0) || 0,
    ok: payload.ok !== false && Number(result?.statusCode || 0) < 400,
    runId: firstRunId || cleanText(payload.runId || `daytrade-entry-history-${runDate}`),
    count: cleanNumber(payload.count ?? rows.length),
    emittedRows: rows.length,
    resultCount: cleanNumber(payload.count ?? rows.length),
    readbackCount: cleanNumber(payload.count ?? rows.length),
    date: cleanText(payload.tradeDate),
    requestedDate: cleanText(payload.requestedDate),
    displayTradeDate: cleanText(payload.displayTradeDate),
    sourceName: "daytrade_entry_history",
    source: cleanText(payload.source || "supabase:public.fugle_daytrade_entry_history"),
    table: cleanText(payload.table || "public.fugle_daytrade_entry_history"),
    timeWindow: payload.timeWindow || { from: "09:00:00", to: "13:30:00", timezone: "Asia/Taipei" },
    formalCount: cleanNumber(payload.count ?? rows.length),
    detectedCount: 0,
    marketOpen: payload.marketOpen,
    marketStatus: cleanText(payload.marketStatus),
    closedReason: cleanText(payload.closedReason),
    marketClosedPreviousGood: payload.marketClosedPreviousGood === true,
    evidenceStatus: payload.ok === false ? "insufficient" : "complete",
    unattendedStatus: payload.ok === false ? "NO" : "YES",
    publishAllowed: payload.ok !== false,
    latestOverwriteAllowed: payload.ok !== false,
    preservePreviousGood: payload.marketClosedPreviousGood === true || payload.ok === false,
    fallbackUsed: false,
    blockedReason: payload.ok === false ? cleanText(payload.reason || payload.error || "daytrade_entry_history_unavailable") : "",
    reason: cleanText(payload.reason || payload.error || ""),
  };
}

async function buildDaytradeSourceReport() {
  try {
    const rows = await fetchSupabaseRows(
      "source_status",
      [
        "select=source_name,status,message,updated_at,payload",
        "source_name=eq.fugle_daytrade_source",
        "limit=1",
      ].join("&"),
      8000,
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
    const offSession = payload.off_session === true || cleanText(payload.phase) === "after_daytrade_window";
    const gate = cleanText(payload.daytrade_gate_grade || payload.priority_gate_grade || "D").toUpperCase();
    const formalAllowed = payload.formal_entry_allowed === true;
    const motherPoolSymbols = cleanNumber(payload.mother_pool_symbols);
    const priorityPoolSymbols = cleanNumber(payload.priority_pool_symbols);
    const groupRows = cleanNumber(payload.stock_group_contract_rows);
    const futureRows = cleanNumber(payload.stock_future_initial_0846_rows);
    const ruleHits = payload.mother_pool_rule_hit_counts && typeof payload.mother_pool_rule_hit_counts === "object"
      ? payload.mother_pool_rule_hit_counts
      : {};
    const sourceOk = Boolean(row)
      && motherPoolSymbols >= 180
      && priorityPoolSymbols >= 40
      && groupRows >= 1600
      && futureRows > 0;
    const displayOk = sourceOk && (offSession || formalAllowed || gate === "A");
    const reason = cleanText(row?.message)
      || (sourceOk ? "daytrade mother pool source ready for display" : "daytrade mother pool source incomplete");
    return {
      key: "daytrade_source",
      strategy: "當沖母池水源",
      endpoint: "source_status:fugle_daytrade_source",
      statusCode: row ? 200 : 404,
      ok: displayOk,
      runId: `daytrade-source-${compactDate(row?.updated_at || new Date().toISOString())}-${compactTimestamp(row?.updated_at || new Date().toISOString()).slice(8) || "latest"}`,
      count: motherPoolSymbols,
      emittedRows: motherPoolSymbols,
      resultCount: motherPoolSymbols,
      readbackCount: motherPoolSymbols,
      date: cleanText(row?.trade_date || payload.trade_date || payload.date || ""),
      sourceName: "fugle_daytrade_source",
      source: "supabase:source_status",
      table: "source_status",
      gateGrade: gate,
      phase: cleanText(payload.phase),
      offSession,
      formalEntryAllowed: formalAllowed,
      formalScope: cleanText(payload.formal_scope || "priority_top40"),
      motherPoolSymbols,
      priorityPoolSymbols,
      stockGroupContractSource: cleanText(payload.stock_group_contract_source),
      stockGroupContractRows: groupRows,
      stockFutureInitial0846Rows: futureRows,
      stockFutureInitial0846ReadyRows: cleanNumber(payload.stock_future_initial_0846_ready_rows),
      ruleHits: {
        strong_group_limit_up_leader: cleanNumber(ruleHits.strong_group_limit_up_leader),
        stock_future_initial_0846_observe: cleanNumber(ruleHits.stock_future_initial_0846_observe),
        margin_down_3_5d_price_strong: cleanNumber(ruleHits.margin_down_3_5d_price_strong),
        margin_short_both_up_3_5d_price_strong: cleanNumber(ruleHits.margin_short_both_up_3_5d_price_strong),
        daytrade_crowded_3_5d_watch: cleanNumber(ruleHits.daytrade_crowded_3_5d_watch),
      },
      evidenceStatus: reportStatusFromBool(displayOk),
      unattendedStatus: displayOk ? "YES" : "NO",
      publishAllowed: displayOk,
      latestOverwriteAllowed: displayOk,
      preservePreviousGood: !displayOk,
      fallbackUsed: false,
      blockedReason: displayOk ? "" : reason,
      reason,
    };
  } catch (error) {
    return {
      key: "daytrade_source",
      strategy: "當沖母池水源",
      endpoint: "source_status:fugle_daytrade_source",
      statusCode: 500,
      ok: false,
      runId: `daytrade-source-error-${compactTimestamp(new Date().toISOString())}`,
      count: 0,
      emittedRows: 0,
      evidenceStatus: "insufficient",
      unattendedStatus: "NO",
      publishAllowed: false,
      latestOverwriteAllowed: false,
      preservePreviousGood: true,
      fallbackUsed: false,
      blockedReason: error?.message || String(error),
      reason: error?.message || String(error),
    };
  }
}

function mergeSourceReport(payload, report) {
  const reports = Array.isArray(payload?.sourceReports) ? [...payload.sourceReports] : [];
  const index = reports.findIndex((item) => cleanText(item?.key).toLowerCase() === cleanText(report?.key).toLowerCase());
  if (index >= 0) reports[index] = { ...reports[index], ...report };
  else reports.push(report);
  return { ...payload, sourceReports: reports };
}

async function withLiveStrategy3SourceReport(payload) {
  const result = await callStrategy3Latest();
  return mergeSourceReport(payload, buildStrategy3SourceReport(result));
}

function sourceReportDateValue(report) {
  const text = cleanText(report?.date || report?.usedDate || report?.sourceDate || report?.tradeDate || report?.runId);
  const match = text.match(/(20\d{6})/);
  return match ? Number(match[1]) : 0;
}

function maxSourceReportDate(reports) {
  return Math.max(0, ...(Array.isArray(reports) ? reports.map(sourceReportDateValue) : []));
}

function readRuntimeTerminalScorecardPayload() {
  const runtimeDir = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
  const candidates = [
    path.join(runtimeDir, "data", "scorecard-terminal-current.json"),
    path.join(process.cwd(), "data", "scorecard-terminal-current.json"),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const payload = JSON.parse(fs.readFileSync(file, "utf8"));
      if (payload && typeof payload === "object") return payload;
    } catch {}
  }
  return null;
}
function alignPayloadDateWithSourceReports(payload) {
  const reports = Array.isArray(payload?.sourceReports) ? payload.sourceReports : [];
  const reportDate = maxSourceReportDate(reports);
  const payloadDate = Number(compactDate(payload?.latestDate || payload?.marketDate || payload?.selectedDate));
  if (!reportDate || reportDate <= payloadDate) return payload;
  const latestDate = compactDateToIso(String(reportDate));
  return {
    ...payload,
    latestDate,
    marketDate: latestDate,
    selectedDate: latestDate,
    sourceReportsDate: latestDate,
    fallbackReason: cleanText(payload?.fallbackReason || "scorecard_snapshot_older_than_source_reports"),
    warnings: [
      ...(Array.isArray(payload?.warnings) ? payload.warnings : []),
      `scorecard records snapshot older than sourceReports; selectedDate=${latestDate}`,
    ],
  };
}


async function withFreshStrategySourceReports(payload) {
  let nextPayload = payload;
  try {
    const strategy2Report = buildStrategy2SourceReport(await callStrategy2Latest());
    if (strategy2Report.runId) nextPayload = mergeSourceReport(nextPayload, strategy2Report);
  } catch {}
  try {
    const strategy3Report = buildStrategy3SourceReport(await callStrategy3Latest());
    if (strategy3Report.runId) nextPayload = mergeSourceReport(nextPayload, strategy3Report);
  } catch {}
  try {
    const strategy4Report = buildStrategy4SourceReport(await callStrategy4Latest());
    if (strategy4Report.runId) nextPayload = mergeSourceReport(nextPayload, strategy4Report);
  } catch {}
  try {
    const strategy5Report = buildStrategy5SourceReport(await callStrategy5SourceReportFast());
    if (strategy5Report.runId) nextPayload = mergeSourceReport(nextPayload, strategy5Report);
  } catch {}
  try {
    const institutionReport = buildInstitutionSourceReport(await callInstitutionLatest());
    if (institutionReport.runId) nextPayload = mergeSourceReport(nextPayload, institutionReport);
  } catch {}
  try {
    const cbReport = buildCbSourceReport(await callCbDetectLatest());
    if (cbReport.runId) nextPayload = mergeSourceReport(nextPayload, cbReport);
  } catch {}
  try {
    const warrantReport = buildWarrantSourceReport(await callWarrantLatest());
    if (warrantReport.runId) nextPayload = mergeSourceReport(nextPayload, warrantReport);
  } catch {}
  try {
    const daytradeReport = await buildDaytradeSourceReport();
    if (daytradeReport.runId) nextPayload = mergeSourceReport(nextPayload, daytradeReport);
  } catch {}
  return nextPayload;
}

async function withLiveSourceReports(payload, options = {}) {
  const existingReports = (Array.isArray(payload?.sourceReports) ? payload.sourceReports : [])
    .filter((report) => !isRetiredScorecardSurfaceName(report?.key)
      && !isRetiredScorecardSurfaceName(report?.strategy)
      && !isRetiredScorecardSurfaceName(report?.endpoint));
  const runtimePayload = readRuntimeTerminalScorecardPayload();
  const runtimeReports = (Array.isArray(runtimePayload?.sourceReports) ? runtimePayload.sourceReports : [])
    .filter((report) => !isRetiredScorecardSurfaceName(report?.key)
      && !isRetiredScorecardSurfaceName(report?.strategy)
      && !isRetiredScorecardSurfaceName(report?.endpoint));
  const refreshFreshStrategyReports = options.freshStrategySourceReports === true;
  const maybeFreshStrategyReports = (nextPayload) => refreshFreshStrategyReports ? withFreshStrategySourceReports(nextPayload) : Promise.resolve(nextPayload);
  const releaseReports = releaseSourceReports();
  const lightweightReports = await Promise.all(LIGHTWEIGHT_SOURCE_REPORTS.map(buildLightweightSourceReport));
  const mergeLightweightReports = (reports) => {
    const sourceReports = Array.isArray(reports) ? reports : [];
    const byKey = new Map(sourceReports.map((report) => [cleanText(report?.key).toLowerCase(), report]));
    const merged = sourceReports.map((report) => {
      const live = lightweightReports.find((item) => cleanText(item?.key).toLowerCase() === cleanText(report?.key).toLowerCase());
      if (!isBlank(live?.runId) && sourceReportDateValue(live) >= sourceReportDateValue(report)) {
        return { ...report, ...live, reason: cleanText(live.reason || "scorecard_live_latest_complete_run") };
      }
      return report;
    });
    for (const live of lightweightReports) {
      const key = cleanText(live?.key).toLowerCase();
      if (!isBlank(live?.runId) && key && !byKey.has(key)) merged.push(live);
    }
    return merged;
  };
  const mergedRuntimeReports = mergeLightweightReports(runtimeReports);
  const mergedReleaseReports = mergeLightweightReports(releaseReports);
  const releaseComplete = releaseReports.some((report) => !isBlank(report?.runId));
  const existingComplete = existingReports.length >= 7 && existingReports.every((report) => !isBlank(report?.runId));
  const runtimeComplete = mergedRuntimeReports.length >= 7 && mergedRuntimeReports.every((report) => !isBlank(report?.runId));
  const mergedReleaseComplete = mergedReleaseReports.some((report) => !isBlank(report?.runId));
  if (runtimeComplete && maxSourceReportDate(mergedRuntimeReports) >= Math.max(maxSourceReportDate(existingReports), maxSourceReportDate(mergedReleaseReports))) {
    const runtimeDate = cleanText(runtimePayload?.latestDate || runtimePayload?.marketDate || runtimePayload?.selectedDate || payload?.latestDate);
    const runtimeBase = {
      ...payload,
      ...runtimePayload,
      latestDate: runtimeDate || runtimePayload?.latestDate || payload?.latestDate,
      marketDate: runtimeDate || runtimePayload?.marketDate || payload?.marketDate,
      selectedDate: runtimeDate || runtimePayload?.selectedDate || payload?.selectedDate,
      sourceReportsSource: "runtime-scorecard-terminal-current",
    };
    return alignPayloadDateWithSourceReports(await maybeFreshStrategyReports(mergedRuntimeReports.reduce((nextPayload, report) => mergeSourceReport(nextPayload, report), runtimeBase)));
  }
  if (mergedReleaseComplete && maxSourceReportDate(mergedReleaseReports) >= maxSourceReportDate(existingReports)) {
    return alignPayloadDateWithSourceReports(await maybeFreshStrategyReports(mergedReleaseReports.reduce((nextPayload, report) => mergeSourceReport(nextPayload, report), payload)));
  }
  if (existingComplete) {
    return alignPayloadDateWithSourceReports(await maybeFreshStrategyReports(existingReports.reduce((nextPayload, report) => mergeSourceReport(nextPayload, report), payload)));
  }
  if (releaseComplete) {
    return alignPayloadDateWithSourceReports(await maybeFreshStrategyReports(mergedReleaseReports.reduce((nextPayload, report) => mergeSourceReport(nextPayload, report), payload)));
  }
  return alignPayloadDateWithSourceReports(await maybeFreshStrategyReports(lightweightReports.reduce((nextPayload, report) => mergeSourceReport(nextPayload, report), payload)));
}
function withScorecardContract(payload, status, reason = "") {
  const latestDate = isoDate(payload?.latestDate || payload?.summary?.latestDate || "");
  const snapshotTradeDate = cleanText(payload?.snapshot?.tradeDate || "");
  const marketDate = latestDate || (snapshotTradeDate.length === 8
    ? `${snapshotTradeDate.slice(0, 4)}-${snapshotTradeDate.slice(4, 6)}-${snapshotTradeDate.slice(6, 8)}`
    : "");
  const runDate = compactDate(marketDate || snapshotTradeDate || payload?.updatedAt || "");
  const runStamp = compactTimestamp(payload?.updatedAt || payload?.snapshot?.updatedAt || "");
  return {
    ...payload,
    contract: cleanText(payload?.contract || SCORECARD_CONTRACT),
    qualityStatus: cleanText(payload?.qualityStatus || status),
    marketDate: cleanText(payload?.marketDate || marketDate || latestDate),
    runId: cleanText(payload?.runId || `scorecard-${runDate || "unknown"}-${runStamp || "snapshot"}`),
    fallbackReason: cleanText(payload?.fallbackReason || reason),
  };
}

function fieldCompleteness(row) {
  const blankCounts = {};
  const sampleMissingRows = [];
  for (const field of SCORECARD_REQUIRED_FIELDS) {
    const blank = isBlank(row?.[field]);
    blankCounts[field] = blank ? 1 : 0;
    if (blank) {
      sampleMissingRows.push({
        field,
        record_id: cleanText(row?.record_id || row?.id || ""),
        strategy: cleanText(row?.strategy || ""),
        ticker: cleanText(row?.ticker || ""),
      });
    }
  }
  return {
    requiredFields: [...SCORECARD_REQUIRED_FIELDS],
    blankCounts,
    sampleMissingRows,
    blankTotal: Object.values(blankCounts).reduce((sum, value) => sum + value, 0),
  };
}

function fallbackContract(payload, reason = "") {
  const fallbackUsed = payload?.cacheSource !== "supabase-snapshot" || Boolean(reason);
  return {
    fallbackUsed,
    fallbackAllowed: false,
    fallbackScope: fallbackUsed ? ["scorecard_snapshot"] : [],
    fallbackDetails: fallbackUsed ? [{
      source: cleanText(payload?.cacheSource || "unknown"),
      reason: cleanText(reason || payload?.fallbackReason || "fallback_used"),
      formalPublishAllowed: false,
    }] : [],
  };
}

function sourceSnapshot(payload, fallback) {
  const capturedAt = cleanText(
    payload?.source_snapshot_captured_at
    || payload?.snapshot?.updatedAt
    || payload?.updatedAt
  );
  return {
    source_snapshot_captured_at: capturedAt,
    source_status_at_run: payload?.source_status_at_run || {
      status: fallback.fallbackUsed ? "blocked" : "complete",
      source: cleanText(payload?.cacheSource || payload?.source || "scorecard"),
    },
    quote_coverage_at_run: payload?.quote_coverage_at_run || { status: "not_required", reason: "scorecard_rows_use_published_entry_high_prices" },
    intraday_1m_readiness_at_run: payload?.intraday_1m_readiness_at_run || { status: "not_required", reason: "scorecard_snapshot_readback" },
    ma_readiness_at_run: payload?.ma_readiness_at_run || { status: "not_required", reason: "scorecard_snapshot_readback" },
    preopen_futopt_daily_readiness_at_run: payload?.preopen_futopt_daily_readiness_at_run || { status: "not_required", reason: "scorecard_snapshot_readback" },
    run_quality_at_publish: payload?.run_quality_at_publish || {
      status: fallback.fallbackUsed ? "blocked" : "complete",
      publishAllowed: fallback.fallbackUsed !== true,
      reason: fallback.fallbackUsed ? "fallback_source_cannot_publish_yes" : "formal_scorecard_snapshot",
    },
    writeBudget: payload?.writeBudget || { status: "not_required", reason: "read_only_scorecard_api" },
    retentionOk: payload?.retentionOk ?? true,
  };
}

function decorateRecords(payload, reason = "") {
  const fallback = fallbackContract(payload, reason);
  const snapshot = sourceSnapshot(payload, fallback);
  const formal = payload?.ok !== false
    && cleanText(payload?.qualityStatus) === "complete"
    && cleanText(payload?.cacheSource) === "supabase-snapshot"
    && !fallback.fallbackUsed
    && !isBlank(snapshot.source_snapshot_captured_at);
  const records = Array.isArray(payload?.records) ? payload.records : [];
  return records.map((row) => {
    const fields = fieldCompleteness(row);
    const blockers = [];
    if (!formal) blockers.push(cleanText(reason || payload?.fallbackReason || "scorecard_source_not_formal"));
    if (fields.blankTotal > 0) blockers.push(`blank_fields_${fields.blankTotal}`);
    if (isBlank(snapshot.source_snapshot_captured_at)) blockers.push("source_snapshot_captured_at_missing");
    const evidenceStatus = blockers.length ? "insufficient" : "complete";
    const publishAllowed = blockers.length === 0;
    const strategyName = cleanText(row.strategy || "未分類");
    return {
      ...row,
      strategyName,
      endpoint: FORMAL_STRATEGY_ENDPOINTS[strategyName] || "/api/scorecard?live=1",
      runId: cleanText(payload.runId),
      tradeDate: cleanText(row.record_date || payload.marketDate || payload.latestDate),
      usedDate: cleanText(row.record_date || payload.latestDate),
      updatedAt: cleanText(payload.updatedAt || snapshot.source_snapshot_captured_at),
      unattendedStatus: publishAllowed ? "YES" : "NO",
      evidenceStatus,
      needsHumanWatch: !publishAllowed,
      blockers,
      warnings: [],
      fallbackUsed: fallback.fallbackUsed,
      fallbackAllowed: fallback.fallbackAllowed,
      fallbackScope: fallback.fallbackScope,
      fallbackDetails: fallback.fallbackDetails,
      publishAllowed,
      source_snapshot_captured_at: snapshot.source_snapshot_captured_at,
      source_status_at_run: snapshot.source_status_at_run,
      quote_coverage_at_run: snapshot.quote_coverage_at_run,
      intraday_1m_readiness_at_run: snapshot.intraday_1m_readiness_at_run,
      ma_readiness_at_run: snapshot.ma_readiness_at_run,
      preopen_futopt_daily_readiness_at_run: snapshot.preopen_futopt_daily_readiness_at_run,
      run_quality_at_publish: snapshot.run_quality_at_publish,
      writeBudget: snapshot.writeBudget,
      retentionOk: snapshot.retentionOk,
      requiredFields: fields.requiredFields,
      blankCounts: fields.blankCounts,
      sampleMissingRows: fields.sampleMissingRows,
    };
  });
}

function buildAuditSurfaces(payload, reason = "") {
  const records = Array.isArray(payload?.records) ? payload.records : [];
  const strategies = new Set(records.map((row) => cleanText(row.strategyName || row.strategy)).filter(Boolean));
  const formal = payload?.ok !== false
    && cleanText(payload?.qualityStatus) === "complete"
    && cleanText(payload?.cacheSource) === "supabase-snapshot"
    && records.length > 0;
  return AUDIT_SURFACES.map(([key, name, endpoint]) => {
    const isTradingSurface = Object.values(FORMAL_STRATEGY_ENDPOINTS).includes(endpoint);
    const covered = isTradingSurface
      ? [...strategies].some((strategy) => endpoint === FORMAL_STRATEGY_ENDPOINTS[strategy])
      : formal;
    const blockers = [];
    if (!formal) blockers.push(cleanText(reason || payload?.fallbackReason || "scorecard_source_not_formal"));
    if (!covered) blockers.push("surface_not_covered");
    return {
      key,
      strategyName: name,
      endpoint,
      runId: cleanText(payload?.runId),
      tradeDate: cleanText(payload?.marketDate || payload?.latestDate),
      usedDate: cleanText(payload?.latestDate),
      updatedAt: cleanText(payload?.updatedAt),
      unattendedStatus: blockers.length ? "NO" : "YES",
      evidenceStatus: blockers.length ? "insufficient" : "complete",
      needsHumanWatch: blockers.length > 0,
      blockers,
      warnings: [],
      fallbackUsed: payload?.cacheSource !== "supabase-snapshot",
      publishAllowed: blockers.length === 0,
      source_snapshot_captured_at: cleanText(payload?.source_snapshot_captured_at || payload?.snapshot?.updatedAt || payload?.updatedAt),
      requiredFields: ["surface", "endpoint", "runId", "source_snapshot_captured_at"],
      blankCounts: {
        surface: isBlank(name) ? 1 : 0,
        endpoint: isBlank(endpoint) ? 1 : 0,
        runId: isBlank(payload?.runId) ? 1 : 0,
        source_snapshot_captured_at: isBlank(payload?.source_snapshot_captured_at || payload?.snapshot?.updatedAt || payload?.updatedAt) ? 1 : 0,
      },
      sampleMissingRows: [],
    };
  });
}

function summarizeAudit(payload, reason = "") {
  const records = Array.isArray(payload?.records) ? payload.records : [];
  const surfaces = buildAuditSurfaces(payload, reason);
  const blockers = [
    ...records.flatMap((row) => Array.isArray(row.blockers) ? row.blockers.map((issue) => `${row.strategyName || row.strategy}: ${issue}`) : []),
    ...surfaces.flatMap((surface) => Array.isArray(surface.blockers) ? surface.blockers.map((issue) => `${surface.strategyName}: ${issue}`) : []),
  ];
  const warnings = [
    ...records.flatMap((row) => Array.isArray(row.warnings) ? row.warnings.map((warning) => `${row.strategyName || row.strategy}: ${warning}`) : []),
    ...surfaces.flatMap((surface) => Array.isArray(surface.warnings) ? surface.warnings.map((warning) => `${surface.strategyName}: ${warning}`) : []),
  ];
  return {
    ok: blockers.length === 0,
    unattendedStatus: blockers.length ? "NO" : "YES",
    needsHumanWatch: blockers.length > 0,
    blockers,
    warnings,
    strategyCount: new Set(records.map((row) => cleanText(row.strategyName || row.strategy)).filter(Boolean)).size,
    recordCount: records.length,
    surfaces,
  };
}

function blankCountTotal(row) {
  if (!row?.blankCounts || typeof row.blankCounts !== "object") return 0;
  return Object.values(row.blankCounts).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function validateScorecardPayload(payload) {
  const issues = [];
  const rows = Array.isArray(payload?.records) ? payload.records : [];
  if (payload?.ok !== true) issues.push("scorecard_ok_not_true");
  if (cleanText(payload?.qualityStatus) !== "complete") issues.push("quality_status_not_complete");
  if (cleanText(payload?.cacheSource) !== "supabase-snapshot") issues.push("cache_source_not_supabase_snapshot");
  if (!rows.length) issues.push("empty_rows");
  if (!Array.isArray(payload?.sources)) issues.push("top_level_sources_missing");
  if (!Array.isArray(payload?.issues)) issues.push("top_level_issues_missing");
  if (!Array.isArray(payload?.warnings)) issues.push("top_level_warnings_missing");
  rows.forEach((row, index) => {
    const prefix = `row_${index}`;
    const evidenceStatus = cleanText(row.evidenceStatus).toLowerCase();
    const blockers = Array.isArray(row.blockers) ? row.blockers : [];
    if (!evidenceStatus) issues.push(`${prefix}_missing_evidence_status`);
    else if (evidenceStatus !== "complete" && evidenceStatus !== "sufficient") issues.push(`${prefix}_evidence_status_insufficient`);
    if (isBlank(row.source_snapshot_captured_at)) issues.push(`${prefix}_missing_source_snapshot_captured_at`);
    if (row.fallbackUsed === true) issues.push(`${prefix}_fallback_used`);
    if (blankCountTotal(row) > 0) issues.push(`${prefix}_blank_required_field`);
    if (blockers.length > 0 && row.publishAllowed === true) issues.push(`${prefix}_blockers_publish_allowed_conflict`);
    if (blockers.length > 0 && isBlank(blockers[0])) issues.push(`${prefix}_missing_blocked_reason`);
    if (row.needsHumanWatch !== false && row.publishAllowed === true) issues.push(`${prefix}_human_watch_publish_allowed_conflict`);
    if (row.publishAllowed !== true) issues.push(`${prefix}_publish_allowed_false`);
    if (row.unattendedStatus !== "YES") issues.push(`${prefix}_unattended_status_not_yes`);
  });
  return {
    rawOk: issues.length === 0,
    issues,
  };
}

function historyDates(records) {
  return [...new Set((Array.isArray(records) ? records : [])
    .map((row) => cleanText(row.record_date))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))]
    .sort()
    .reverse();
}

function candidateIsoDate(value) {
  const compact = cleanText(value?.date || value?.summary_date || value).replace(/\D/g, "").slice(0, 8);
  if (!/^\d{8}$/.test(compact)) return "";
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function activeStrategyCount(rows) {
  return new Set((Array.isArray(rows) ? rows : [])
    .map((row) => cleanText(row.strategy))
    .filter((strategy) => strategy && !isRetiredScorecardSurfaceName(strategy))).size;
}

function defaultScorecardDate(payload, allRecords, dates) {
  const sourceQuery = sanitizeScorecardSourceQuery(payload?.sourceQuery || {});
  const candidates = Array.isArray(sourceQuery.latestDateCandidates) ? sourceQuery.latestDateCandidates : [];
  for (const candidate of candidates) {
    const date = candidateIsoDate(candidate);
    if (!date || !dates.includes(date)) continue;
    const rows = allRecords.filter((row) => cleanText(row.record_date) === date);
    if (!rows.length) continue;
    const missing = Array.isArray(candidate.missingStrategies)
      ? candidate.missingStrategies.filter((strategy) => !isRetiredScorecardSurfaceName(strategy))
      : [];
    const completeAfterRetired = missing.length === 0;
    if (completeAfterRetired && activeStrategyCount(rows) >= 5) return date;
  }
  const payloadDate = isoDate(payload?.latestDate || payload?.marketDate || "");
  if (payloadDate && dates.includes(payloadDate)) {
    const rows = allRecords.filter((row) => cleanText(row.record_date) === payloadDate);
    if (activeStrategyCount(rows) >= 5) return payloadDate;
  }
  return dates
    .map((date) => ({ date, rows: allRecords.filter((row) => cleanText(row.record_date) === date) }))
    .sort((a, b) => activeStrategyCount(b.rows) - activeStrategyCount(a.rows) || b.rows.length - a.rows.length || b.date.localeCompare(a.date))[0]?.date || "";
}

function summarize(records, dailyRows, latestDate) {
  const rows = Array.isArray(records) ? records : [];
  const wins = rows.filter((row) => cleanNumber(row.pnl) > 0).length;
  const losses = rows.filter((row) => cleanNumber(row.pnl) < 0).length;
  const flats = rows.length - wins - losses;
  const totalPnl = rows.reduce((sum, row) => sum + cleanNumber(row.pnl), 0);
  const grouped = new Map();
  rows.forEach((row) => {
    const strategy = cleanText(row.strategy || "未分類") || "未分類";
    grouped.set(strategy, [...(grouped.get(strategy) || []), row]);
  });
  const byStrategy = [...grouped.entries()].map(([strategy, items]) => {
    const strategyWins = items.filter((row) => cleanNumber(row.pnl) > 0).length;
    const strategyLosses = items.filter((row) => cleanNumber(row.pnl) < 0).length;
    const strategyPnl = items.reduce((sum, row) => sum + cleanNumber(row.pnl), 0);
    return {
      strategy,
      rows: items.length,
      wins: strategyWins,
      losses: strategyLosses,
      flats: items.length - strategyWins - strategyLosses,
      winRate: items.length ? (strategyWins / items.length) * 100 : 0,
      pnl: strategyPnl,
    };
  }).sort((a, b) => b.pnl - a.pnl || b.rows - a.rows);
  return {
    latestDate,
    rows: rows.length,
    wins,
    losses,
    flats,
    winRate: rows.length ? (wins / rows.length) * 100 : 0,
    totalPnl,
    byStrategy,
    daily: Array.isArray(dailyRows) ? dailyRows : [],
  };
}

function blockedSourceReports(sourceReports) {
  return (Array.isArray(sourceReports) ? sourceReports : []).filter((report) => {
    const evidenceStatus = cleanText(report?.evidenceStatus).toLowerCase();
    return report?.ok === false
      || report?.publishAllowed === false
      || evidenceStatus === "insufficient"
      || evidenceStatus === "source_quality_fail";
  });
}

function selectPayloadDate(payload, requestedDate = "") {
  const allRecords = (Array.isArray(payload?.records) ? payload.records : []).filter((row) => !isRetiredScorecardSurfaceName(row?.strategy));
  const dates = historyDates(allRecords);
  const selectedDate = dates.includes(requestedDate) ? requestedDate : (defaultScorecardDate(payload, allRecords, dates) || dates[0] || "");
  const selectedRecords = selectedDate ? allRecords.filter((row) => cleanText(row.record_date) === selectedDate) : allRecords;
  const allDaily = (Array.isArray(payload?.summary?.daily) ? payload.summary.daily : [])
    .filter((row) => !isRetiredScorecardSurfaceName(row?.strategy));
  const daily = selectedDate ? allDaily.filter((row) => cleanText(row.summary_date) === selectedDate) : allDaily;
  const sourceReports = (Array.isArray(payload?.sourceReports) ? payload.sourceReports : [])
    .filter((report) => !isRetiredScorecardSurfaceName(report?.key)
      && !isRetiredScorecardSurfaceName(report?.strategy)
      && !isRetiredScorecardSurfaceName(report?.endpoint)
      && !isRetiredScorecardSurfaceName(report?.runId));
  const blockedReports = blockedSourceReports(sourceReports);
  const blockedStrategies = new Set(blockedReports.map((report) => cleanText(report.strategy)).filter(Boolean));
  const suppressedRows = selectedRecords.filter((row) => blockedStrategies.has(cleanText(row.strategy)));
  const records = blockedStrategies.size
    ? selectedRecords.filter((row) => !blockedStrategies.has(cleanText(row.strategy)))
    : selectedRecords;
  const selected = {
    ...payload,
    latestDate: selectedDate || payload.latestDate || "",
    selectedDate: selectedDate || payload.latestDate || "",
    historyLatestDate: dates[0] || payload.latestDate || "",
    historyDates: dates,
    sourceQuery: sanitizeScorecardSourceQuery(payload.sourceQuery || {}),
    records,
    sourceReports,
    suppressedRows: suppressedRows.map((row) => ({
      record_id: cleanText(row.record_id),
      strategy: cleanText(row.strategy),
      ticker: cleanText(row.ticker),
      entry_time: cleanText(row.entry_time),
    })),
    blockedSourceReports: blockedReports.map((report) => ({
      key: cleanText(report.key),
      strategy: cleanText(report.strategy),
      runId: cleanText(report.runId),
      reason: cleanText(report.reason),
    })),
    summary: {
      ...summarize(records, daily, selectedDate || payload.latestDate || ""),
      suppressedRows: suppressedRows.length,
      blockedStrategies: [...blockedStrategies],
    },
  };
  selected.records = decorateRecords(selected, selected.fallbackReason || "");
  selected.audit = summarizeAudit(selected, selected.fallbackReason || "");
  selected.sources = selected.sources || [{
    name: "scorecard_snapshot",
    cacheSource: cleanText(selected.cacheSource || ""),
    exportSource: cleanText(selected.exportSource || ""),
    snapshotKey: cleanText(selected.snapshot?.key || SNAPSHOT_KEY),
    updatedAt: cleanText(selected.snapshot?.updatedAt || selected.updatedAt || ""),
  }];
  selected.issues = Array.isArray(selected.issues) ? selected.issues : selected.audit.blockers;
  selected.warnings = Array.isArray(selected.warnings) ? selected.warnings : selected.audit.warnings;
  selected.unattendedStatus = selected.audit.unattendedStatus;
  selected.needsHumanWatch = selected.audit.needsHumanWatch;
  return selected;
}

function buildPayloadFromSnapshotPayload(snapshotPayload, options = {}) {
  const snapshot = options.snapshot || {};
  return selectPayloadDate(withScorecardContract({
    ok: snapshotPayload?.ok !== false,
    ...snapshotPayload,
    source: snapshotPayload?.source || "supabase:scorecard_snapshot",
    cacheSource: snapshotPayload?.cacheSource || "supabase-snapshot",
    snapshot: {
      key: snapshot.key || SNAPSHOT_KEY,
      tradeDate: snapshot.tradeDate || "",
      updatedAt: snapshot.updatedAt || snapshotPayload?.updatedAt || "",
      source: snapshot.source || "",
    },
  }, options.status || "complete", options.reason || ""), options.requestedDate || "");
}

function readStaticSnapshot(reason = "scorecard_static_snapshot") {
  const stat = fs.statSync(SNAPSHOT_FILE);
  if (!staticSnapshotCache || staticSnapshotCache.mtimeMs !== stat.mtimeMs) {
    const raw = fs.readFileSync(SNAPSHOT_FILE, "utf8");
    staticSnapshotCache = {
      mtimeMs: stat.mtimeMs,
      payload: JSON.parse(raw),
    };
  }
  const payload = staticSnapshotCache.payload;
  return withScorecardContract({
    ok: payload.ok !== false,
    ...payload,
    cacheSource: "json-snapshot",
    fallbackReason: reason,
  }, "degraded", reason);
}

async function buildPayload(requestedDate = "", options = {}) {
  const liveSourceReports = options.liveSourceReports === true;
  const noCache = options.noCache === true || liveSourceReports;
  const cacheKey = JSON.stringify({ requestedDate, liveSourceReports });
  const cached = payloadMemoryCache.get(cacheKey);
  if (!noCache && cached && Date.now() - cached.cachedAt < SCORECARD_MEMORY_TTL_MS) return cached.payload;

  const snapshot = await readSnapshot(SNAPSHOT_KEY, {
    allowLatestFallback: true,
    timeoutMs: Number(options.timeoutMs || (noCache ? SCORECARD_LIVE_SNAPSHOT_TIMEOUT_MS : SCORECARD_SNAPSHOT_TIMEOUT_MS)) || SCORECARD_SNAPSHOT_TIMEOUT_MS,
  }).catch(() => null);
  let payload;
  if (snapshot?.payload && typeof snapshot.payload === "object") {
    const basePayload = withScorecardContract({
      ok: snapshot.payload.ok !== false,
      ...snapshot.payload,
      source: snapshot.payload.source || "supabase:scorecard_snapshot",
      cacheSource: "supabase-snapshot",
      snapshot: {
        key: snapshot.key || SNAPSHOT_KEY,
        tradeDate: snapshot.tradeDate || "",
        updatedAt: snapshot.updatedAt || "",
        source: snapshot.source || "",
      },
    }, "complete");
    payload = liveSourceReports
      ? selectPayloadDate(await withLiveSourceReports(basePayload, options), requestedDate)
      : selectPayloadDate(basePayload, requestedDate);
  } else {
    const basePayload = readStaticSnapshot("supabase_scorecard_snapshot_timeout_previous_good");
    payload = liveSourceReports
      ? selectPayloadDate(await withLiveSourceReports(basePayload, options), requestedDate)
      : selectPayloadDate(basePayload, requestedDate);
  }
  if (!noCache) payloadMemoryCache.set(cacheKey, { cachedAt: Date.now(), payload });
  return payload;
}

async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }
  try {
    const requestedDate = isoDate(request.query?.date || request.query?.record_date || "");
    const marketCalendar = await buildMarketCalendarContract().catch(() => null);
    const forceLiveSourceReports = request.query?.strictLiveReports === "1" || request.query?.refreshSourceReports === "1";
    const noCache = forceLiveSourceReports || request.query?.noCache === "1" || request.query?.refresh === "1";
    const payload = attachMarketCalendar(await buildPayload(requestedDate, {
      liveSourceReports: forceLiveSourceReports,
      noCache,
      freshStrategySourceReports: forceLiveSourceReports,
      timeoutMs: forceLiveSourceReports ? SCORECARD_LIVE_SNAPSHOT_TIMEOUT_MS : SCORECARD_SNAPSHOT_TIMEOUT_MS,
    }), marketCalendar);
    if (request.method === "HEAD") response.status(200).end("");
    else response.status(200).json(payload);
  } catch (error) {
    response.status(503).json({ ok: false, error: "scorecard_unavailable", reason: error?.message || String(error), updatedAt: new Date().toISOString() });
  }
}

module.exports = withEntitlementRequired(handler, "scorecard");
module.exports.__test = {
  SCORECARD_REQUIRED_FIELDS,
  buildPayloadFromSnapshotPayload,
  validateScorecardPayload,
  decorateRecords,
  summarizeAudit,
  selectPayloadDate,
  withScorecardContract,
  buildPayload,
};

