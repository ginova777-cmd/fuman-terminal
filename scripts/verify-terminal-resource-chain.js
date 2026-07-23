const fs = require("fs");
const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");
const { buildMarketCalendarContract } = require("../lib/market-calendar-contract");
const { normalizeStrategyScanReceipt } = require("../lib/strategy-scan-receipt-contract");
const {
  resolveProtectedReadbackCredential,
  publicCredentialSummary,
} = require("../lib/protected-readback-credential");

const BASE_URL = (process.env.FUMAN_AUDIT_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/terminal-resource-chain-audit");
const NOW = new Date();
const REQUIRE_UNATTENDED = process.argv.includes("--require-unattended");
const CLI_EXPECTED_DATE = process.argv.find((arg) => arg.startsWith("--expected-date="))?.slice("--expected-date=".length).replace(/\D/g, "").slice(0, 8) || "";
let EXPECTED_DATE = CLI_EXPECTED_DATE || taipeiDateKey(NOW);
let EXPECTED_DATE_SOURCE = CLI_EXPECTED_DATE ? "cli" : "taipei_today";
let MARKET_CALENDAR = null;
const ROUTE_ALIASES = new Map([
  ["strategy2-latest", "strategy2"],
  ["strategy3-latest", "strategy3"],
  ["strategy4-latest", "strategy4"],
  ["strategy5-latest", "strategy5"],
  ["institution-latest", "institution"],
  ["chip", "institution"],
  ["cb-detect", "cb"],
  ["cb-detect-latest", "cb"],
  ["warrant-flow", "warrant"],
  ["warrant-flow-latest", "warrant"],
  ["market-overview", "market"],
]);

function normalizeRouteFilter(value) {
  const key = String(value || "").trim().replace(/^\/+api\//, "").replace(/^\/+/, "").replace(/\?.*$/, "");
  return ROUTE_ALIASES.get(key) || key;
}

const ROUTE_FILTER = new Set((process.argv.find((arg) => arg.startsWith("--routes="))?.slice("--routes=".length) || "")
  .split(",")
  .map(normalizeRouteFilter)
  .filter(Boolean));

const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });
let PROTECTED_READBACK_TOKEN = [
  process.env.FUMAN_VERIFY_BEARER_TOKEN,
  process.env.FUMAN_MEMBERSHIP_BEARER_TOKEN,
  process.env.FUMAN_AUTH_BEARER_TOKEN,
  process.env.FUMAN_TEST_MEMBER_ACCESS_TOKEN,
  process.env.FUMAN_SMOKE_BEARER_TOKEN,
].map((value) => String(value || "").trim()).find(Boolean) || "";

const MEMBERSHIP_AUTH_URL = (process.env.FUMAN_MEMBERSHIP_AUTH_URL || "https://jxnqyqnigsppqsxinlrq.supabase.co").replace(/\/+$/, "");
const MEMBERSHIP_AUTH_KEY = process.env.FUMAN_MEMBERSHIP_AUTH_KEY || "sb_publishable_kCocRYzO4oCBnFRQO_pfvg_JZUl0oxm";
const MEMBERSHIP_READBACK_EMAIL = String(process.env.FUMAN_TEST_MEMBER_EMAIL || "").trim();
const MEMBERSHIP_READBACK_PASSWORD = String(process.env.FUMAN_TEST_MEMBER_PASSWORD || "");
let protectedReadbackAuth = {
  attempted: false,
  enabled: Boolean(PROTECTED_READBACK_TOKEN),
  source: PROTECTED_READBACK_TOKEN ? "env-token" : "none",
  status: 0,
  error: "",
};

function protectedReadbackHeaders(url) {
  if (!PROTECTED_READBACK_TOKEN) return {};
  if (!String(url || "").startsWith(BASE_URL)) return {};
  return {
    Authorization: `Bearer ${PROTECTED_READBACK_TOKEN}`,
    "X-Fuman-Readback-Auth": "membership-bearer",
  };
}

async function ensureProtectedReadbackToken() {
  const credential = await resolveProtectedReadbackCredential({ timeoutMs: 20000 });
  if (credential.token) PROTECTED_READBACK_TOKEN = credential.token;
  protectedReadbackAuth = publicCredentialSummary(credential);
  return protectedReadbackAuth;
}
const STRATEGIES = [
  {
    key: "strategy2",
    label: "策略2 即時",
    policy: "same-day live",
    unattendedDueTime: "09:00",
    endpoint: "/api/strategy2-latest",
    mobileTab: "strategy2",
    receiptKey: "strategy2",
    runView: { table: "v_strategy2_latest_complete_run", strategy: "strategy2" },
    resultTable: "strategy2_scan_results",
    resultStrategy: "strategy2",
    allowMissingDesktopSnapshot: true,
    allowDesktopSnapshotRunIdDrift: true,
    allowReceiptDriftWhenDownstreamFresh: true,
    scorecardKeys: ["strategy2","策略2成績單","策略2當沖成績單","策略2"],
  },
  {
    key: "strategy3",
    label: "策略3",
    policy: "latest complete scan",
    unattendedDueTime: "13:05",
    endpoint: "/api/strategy3-latest",
    mobileTab: "strategy3",
    receiptKey: "strategy3",
    requireReceiptRunId: true,
    requireReceiptCountMatch: true,
    allowReceiptDriftWhenDownstreamFresh: true,
    allowZeroTerminal: true,
    allowSourceHealthDriftReady: true,
    runView: { table: "v_strategy3_latest_complete_run", strategy: "strategy3" },
    resultTable: "strategy3_scan_results",
    resultStrategy: "strategy3",
    scorecardKeys: ["strategy3","策略3隔日沖成績單","策略3"],
  },
  {
    key: "strategy4",
    label: "策略4",
    policy: "latest complete scan",
    unattendedDueTime: "16:00",
    endpoint: "/api/strategy4-latest",
    mobileTab: "strategy4",
    receiptKey: "strategy4",
    allowReceiptDriftWhenDownstreamFresh: true,
    runView: { table: "strategy4_scan_runs", strategy: "strategy4", order: "finished_at.desc" },
    resultTable: "strategy4_scan_results",
    resultStrategy: "strategy4",
    scorecardKeys: ["strategy4","策略4成績單","策略4"],
  },
  {
    key: "strategy5",
    label: "策略5",
    policy: "latest complete scan",
    unattendedDueTime: "21:00",
    endpoint: "/api/strategy5-latest",
    mobileTab: "strategy5",
    receiptKey: "strategy5",
    runView: { table: "v_strategy5_latest_complete_run", strategy: "strategy5" },
    resultTable: "strategy5_scan_results",
    resultStrategy: "strategy5",
    allowReceiptDriftWhenDownstreamFresh: true,
    scorecardKeys: ["strategy5","策略5成績單","策略5"],
  },
  {
    key: "institution",
    label: "買賣超",
    policy: "latest complete scan",
    unattendedDueTime: "21:00",
    endpoint: "/api/institution-latest",
    mobileTab: "chip",
    receiptKey: "institution",
    runView: { table: "v_institution_latest_complete_run", strategy: "institution" },
    resultTable: "institution_scan_results",
    resultStrategy: "institution",
    allowReceiptDriftWhenDownstreamFresh: true,
    scorecardKeys: ["institution","買賣超成績單","買賣超"],
  },
  {
    key: "cb",
    label: "CB",
    policy: "latest complete scan",
    unattendedDueTime: "21:25",
    endpoint: "/api/cb-detect-latest",
    mobileTab: "cb",
    receiptKey: "cb-detect",
    runView: { table: "cb_detect_scan_runs", strategy: "cb_detect", order: "finished_at.desc" },
    resultTable: "cb_detect_scan_results",
    resultSelect: "run_id,scan_date,symbol,name,payload,updated_at",
    resultOrder: "symbol.asc",
    snapshotKey: "cb_detect_latest",
    scorecardKeys: ["cb","CB成績單","CB"],
  },
  {
    key: "warrant",
    label: "權證走向",
    policy: "latest complete scan",
    unattendedDueTime: "20:30",
    endpoint: "/api/warrant-flow-latest",
    mobileTab: "warrant",
    receiptKey: "warrant-flow",
    runView: { table: "v_warrant_flow_latest_complete_run", strategy: "warrant_flow" },
    resultTable: "warrant_flow_scan_results",
    resultStrategy: "warrant_flow",
    allowReceiptDriftWhenDownstreamFresh: true,
    scorecardKeys: ["warrant","權證成績單","權證走向","權證"],
  },
  {
    key: "market",
    label: "市場總覽",
    policy: "same-day live",
    endpoint: "/api/market",
    allowMissingDesktopSnapshot: true,
  },
];

function readSecret(name) {
  for (const file of [
    path.join(RUNTIME_DIR, "secrets", name),
    path.join(process.cwd(), "secrets", name),
  ]) {
    try {
      return fs.readFileSync(file, "utf8").trim();
    } catch {}
  }
  return "";
}

function readJsonFile(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replace(/\D/g, "");
}

function compactDate(value) {
  const text = String(value || "");
  if (!text) return "";
  const direct = text.replace(/\D/g, "");
  if (direct.length >= 8) return direct.slice(0, 8);
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return taipeiDateKey(new Date(parsed));
  return "";
}

function taipeiMinuteOfDay(date = NOW) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function minuteFromClock(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function scheduleStatusForConfig(config) {
  if (!REQUIRE_UNATTENDED || !config?.unattendedDueTime || config.key === "market") {
    return { state: "not_required", dueTime: config?.unattendedDueTime || "", pendingNotDue: false };
  }
  const todayKey = taipeiDateKey(NOW);
  const dueMinute = minuteFromClock(config.unattendedDueTime);
  if (dueMinute === null || EXPECTED_DATE !== todayKey) {
    return { state: "date_locked", dueTime: config.unattendedDueTime, pendingNotDue: false };
  }
  const nowMinute = taipeiMinuteOfDay(NOW);
  if (nowMinute < dueMinute) {
    return {
      state: "pending_not_due",
      dueTime: config.unattendedDueTime,
      pendingNotDue: true,
      minutesUntilDue: dueMinute - nowMinute,
    };
  }
  return { state: "due_elapsed", dueTime: config.unattendedDueTime, pendingNotDue: false };
}
function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function receiptSummary(receiptKey) {
  if (!receiptKey) return null;
  const file = path.join(RUNTIME_DIR, "data", "scan-receipts", `${receiptKey}.json`);
  const raw = readJsonFile(file);
  if (!raw) return { ok: false, key: receiptKey, file, status: "missing", error: "receipt_missing" };
  const row = normalizeStrategyScanReceipt(raw, { key: receiptKey, strategy: receiptKey });
  const preservedLatest = row.preservedLatest === true && row.publishBlocked === true && Boolean(String(row.runId || ""));
  const fallback = row.fallback === true && !preservedLatest;
  return {
    ok: row.status === "complete" && row.complete !== false && !fallback && row.publishAllowed !== false && row.preservePreviousGood !== true,
    key: receiptKey,
    file,
    status: String(row.status || ""),
    complete: row.complete === true,
    fallback,
    preservedLatest,
    publishBlocked: row.publishBlocked === true,
    preservePreviousGood: row.preservePreviousGood === true,
    publishAllowed: row.publishAllowed === true,
    latestOverwriteAllowed: row.latestOverwriteAllowed === true,
    latestWriteAttempted: row.latestWriteAttempted === true,
    latestPointerUpdated: row.latestPointerUpdated === true,
    blockedReceiptWritten: row.blockedReceiptWritten === true,
    degradedBlocksLatest: row.degradedBlocksLatest === true,
    evidenceStatus: row.evidenceStatus || "",
    unattendedStatus: row.unattendedStatus || "",
    run_quality_at_publish: row.run_quality_at_publish || null,
    startedAt: row.startedAt || "",
    finishedAt: row.finishedAt || "",
    exitCode: row.exitCode,
    scanned: cleanNumber(row.scanned),
    total: cleanNumber(row.total),
    matches: cleanNumber(row.matches),
    qualityStatus: row.qualityStatus || "",
    runId: String(row.runId || ""),
    blockingReason: row.blockingReason || row.blockedReason || row.scanner_block_reason || "",
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
    log: row.log || "",
  };
}

function withQuery(endpoint, params = {}) {
  const url = new URL(endpoint, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

function publicUrl(endpoint) {
  return `${BASE_URL}${endpoint}`;
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 25000);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache",
        Accept: options.accept || "*/*",
        ...(options.headers || {}),
        ...protectedReadbackHeaders(url),
      },
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text,
      elapsedMs: Date.now() - startedAt,
      contentType: response.headers.get("content-type") || "",
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: "",
      elapsedMs: Date.now() - startedAt,
      error: error?.message || String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options = {}) {
  const result = await fetchText(url, { ...options, accept: "application/json" });
  let json = null;
  try {
    json = JSON.parse(result.text || "{}");
  } catch (error) {
    if (result.ok) return { ...result, ok: false, json: null, error: "json_parse_failed:" + error.message };
  }
  return { ...result, json };
}
async function fetchSupabaseRows(table, query, timeoutMs = 25000) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { ok: false, status: 0, rows: [], error: "missing_supabase_credentials" };
  }
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const result = await fetchJson(url, {
    timeoutMs,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
  });
  return {
    ok: result.ok,
    status: result.status,
    rows: Array.isArray(result.json) ? result.json : [],
    error: result.error || (!result.ok ? String(result.text || "").slice(0, 180) : ""),
  };
}

async function fetchLatestRun(config) {
  if (!config.runView) return null;
  const parts = ["select=*"];
  if (config.runView.strategy) parts.push(`strategy=eq.${encodeURIComponent(config.runView.strategy)}`);
  parts.push("status=eq.complete", "complete=eq.true");
  if (config.runView.order) parts.push(`order=${config.runView.order}`);
  parts.push("limit=1");
  const result = await fetchSupabaseRows(config.runView.table, parts.join("&"));
  const row = result.rows[0] || null;
  if (!result.ok || !row) return { ok: false, source: config.runView.table, error: result.error || "latest_run_missing" };
  return {
    ok: true,
    source: config.runView.table,
    runId: row.run_id || "",
    date: compactDate(row.scan_date || row.finished_at || row.updated_at),
    updatedAt: row.finished_at || row.updated_at || "",
    count: cleanNumber(row.result_count),
    expectedTotal: cleanNumber(row.expected_total),
    scannedCount: cleanNumber(row.scanned_count),
    qualityStatus: row.quality_status || "",
    row,
  };
}

async function fetchResultRows(config, runId) {
  if (!config.resultTable || !runId) return null;
  const result = await fetchSupabaseRows(
    config.resultTable,
    [
      `select=${config.resultSelect || "run_id,scan_date,code,name,rank,updated_at,generated_at,quality_status,payload"}`,
      config.resultStrategy ? `strategy=eq.${encodeURIComponent(config.resultStrategy)}` : "",
      `run_id=eq.${encodeURIComponent(runId)}`,
      `order=${config.resultOrder || "rank.asc"}`,
      "limit=10",
    ].filter(Boolean).join("&")
  );
  if (!result.ok) return { ok: false, source: config.resultTable, error: result.error };
  return {
    ok: true,
    source: config.resultTable,
    rows: result.rows,
    count: result.rows.length,
    top: topCodes(result.rows),
  };
}

async function fetchSnapshotKey(snapshotKey) {
  if (!snapshotKey) return null;
  const symbol = `__fuman_${snapshotKey}`;
  const result = await fetchSupabaseRows(
    "market_snapshots",
    `select=symbol,name,payload,updated_at&symbol=eq.${encodeURIComponent(symbol)}&limit=1`
  );
  const row = result.rows[0] || null;
  if (!result.ok || !row?.payload) return { ok: false, source: "market_snapshots", error: result.error || "snapshot_missing" };
  const payload = row.payload || {};
  return {
    ok: true,
    source: "market_snapshots",
    runId: payload.runId || payload.__snapshot?.snapshotId || "",
    date: compactDate(payload.usedDate || payload.sourceDate || payload.tradeDate || payload.updatedAt || row.updated_at),
    updatedAt: payload.updatedAt || row.updated_at || "",
    count: cleanNumber(payload.count ?? payload.rows?.length ?? payload.matches?.length),
    qualityStatus: payload.qualityStatus || "",
    top: topCodes(rowsOf(payload)),
    payload,
  };
}

function rowsOf(payload = {}) {
  if (Array.isArray(payload.matches)) return payload.matches;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.events)) return payload.events;
  if (Array.isArray(payload.volumeMatches)) return payload.volumeMatches;
  if (Array.isArray(payload.singleSignals)) return payload.singleSignals;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function rowCode(row = {}) {
  return String(
    row.code
    || row.stock_id
    || row.stockId
    || row.underlyingCode
    || row.warrantCode
    || row.cbCode
    || row.symbol
    || row.payload?.code
    || row.payload?.underlyingCode
    || ""
  ).trim();
}

function rowName(row = {}) {
  return String(
    row.name
    || row.stock_name
    || row.stockName
    || row.underlyingName
    || row.warrantName
    || row.cbName
    || row.payload?.name
    || row.payload?.underlyingName
    || ""
  ).trim();
}

function topCodes(rows, limit = 5) {
  return (Array.isArray(rows) ? rows : [])
    .slice(0, limit)
    .map((row) => {
      const code = rowCode(row);
      const name = rowName(row);
      return [code, name].filter(Boolean).join(" ");
    })
    .filter(Boolean);
}

function isMembershipRequiredPayload(payload) {
  return Boolean(payload && payload.error === "membership_required" && (payload.protected === true || payload.ok === false));
}

function membershipProtectedSummary(result) {
  return {
    status: result.status,
    ok: true,
    membershipProtected: true,
    elapsedMs: result.elapsedMs,
    runId: "",
    count: 0,
    returnedCount: 0,
    cacheSource: "membership-required",
    transportSource: "membership-gate",
  };
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function payloadQuality(payload = {}) {
  return payload?.run_quality_at_publish
    || payload?.runQualityAtPublish
    || payload?.payload?.run_quality_at_publish
    || payload?.payload?.runQualityAtPublish
    || payload?.transport?.payload?.run_quality_at_publish
    || {};
}
function summarizePayload(payload, status = 200, elapsedMs = 0) {
  const rows = rowsOf(payload);
  const quality = payloadQuality(payload);
  const evidenceStatus = String(firstPresent(payload?.evidenceStatus, payload?.payload?.evidenceStatus, quality?.evidenceStatus) || "");
  const unattendedStatus = String(firstPresent(payload?.unattendedStatus, payload?.payload?.unattendedStatus, quality?.unattendedStatus) || "");
  const publishAllowed = firstPresent(payload?.publishAllowed, payload?.payload?.publishAllowed, quality?.publishAllowed);
  const fallbackUsed = firstPresent(payload?.fallbackUsed, payload?.payload?.fallbackUsed, quality?.fallbackUsed);
  const rawPreservePreviousGood = firstPresent(payload?.preservePreviousGood, payload?.payload?.preservePreviousGood, quality?.preservePreviousGood);
  const preservePreviousGood = rawPreservePreviousGood === true
    && !(publishAllowed === true && evidenceStatus === "complete" && fallbackUsed !== true);
  return {
    ok: payload?.ok !== false,
    status,
    elapsedMs,
    runId: String(payload?.runId || payload?.transport?.runId || payload?.transport?.payloadRunId || payload?.payload?.runId || ""),
    date: compactDate(payload?.usedDate || payload?.date || payload?.scanStamp || payload?.sourceDate || payload?.tradeDate || payload?.updatedAt || payload?.generatedAt),
    updatedAt: payload?.updatedAt || payload?.generatedAt || payload?.finishedAt || "",
    count: cleanNumber(payload?.count ?? payload?.matchCount ?? payload?.entryCount ?? rows.length),
    returnedCount: cleanNumber(payload?.returnedCount ?? rows.length),
    resultCount: cleanNumber(firstPresent(payload?.resultCount, payload?.payload?.resultCount, quality?.resultCount)),
    readbackCount: cleanNumber(firstPresent(payload?.readbackCount, payload?.payload?.readbackCount, quality?.readbackCount)),
    expectedTotal: cleanNumber(firstPresent(payload?.expectedTotal, payload?.payload?.expectedTotal, quality?.expectedTotal)),
    scannedCount: cleanNumber(firstPresent(payload?.scannedCount, payload?.payload?.scannedCount, quality?.scannedCount)),
    qualityStatus: payload?.qualityStatus || payload?.sourceHealth?.status || "",
    evidenceStatus,
    unattendedStatus,
    publishAllowed,
    fallbackUsed,
    preservePreviousGood,
    source: payload?.source || "",
    cacheSource: payload?.cacheSource || "",
    transportSource: payload?.transport?.source || "",
    writeBudgetStatus: payload?.writeBudget?.status || "",
    writeBudgetLimit: cleanNumber(payload?.writeBudget?.limit),
    snapshotHit: Boolean(payload?.snapshotHit),
    snapshotFallback: Boolean(payload?.snapshotFallback || payload?.transport?.fallbackFromPreviousSnapshot),
    error: payload?.error || payload?.detail || payload?.reason || "",
    top: topCodes(rows),
  };
}

function sourceHealthSummary(payload = {}, supabase = {}) {
  const health = payload?.sourceHealth || payload?.payload?.sourceHealth || supabase?.row?.payload?.sourceHealth || null;
  if (!health || typeof health !== "object") return null;
  const drift = health.driftIntradayStatus && typeof health.driftIntradayStatus === "object" ? health.driftIntradayStatus : {};
  return {
    status: health.status || "",
    issues: Array.isArray(health.issues) ? health.issues : [],
    warnings: Array.isArray(health.warnings) ? health.warnings : [],
    warningCount: cleanNumber(health.warningCount),
    warningLimit: cleanNumber(health.warningLimit),
    stockUniverseCount: cleanNumber(health.stockUniverseCount),
    intraday1mReadyCount: cleanNumber(health.intraday1mReadyCount),
    minIntraday1mCandidates: cleanNumber(health.minIntraday1mCandidates),
    issuedSharesCount: cleanNumber(health.issuedSharesCount),
    volumeAverageCount: cleanNumber(health.volumeAverageCount),
    driftIntradayReady: health.driftIntradayReady === true || String(drift.status || "").toLowerCase() === "ready",
    driftIntradayRowCount: cleanNumber(drift.rowCount),
    driftIntradayMinRequired: cleanNumber(drift.minRequired),
    driftIntradayEffectiveMinRequired: cleanNumber(drift.effectiveMinRequired || drift.minRequired),
    driftIntradayReadinessGrade: String(drift.readinessGrade || ""),
  };
}

function endpointFromSnapshot(snapshotPayload, endpoint) {
  const endpoints = snapshotPayload?.endpoints && typeof snapshotPayload.endpoints === "object" ? snapshotPayload.endpoints : {};
  const target = new URL(endpoint, BASE_URL);
  const cleanTarget = `${target.pathname}${target.search}`;
  if (endpoints[cleanTarget]) return { endpoint: cleanTarget, payload: endpoints[cleanTarget] };
  const entries = Object.entries(endpoints).filter(([key]) => {
    try {
      return new URL(key, BASE_URL).pathname === target.pathname;
    } catch {
      return false;
    }
  });
  const preferred = entries.find(([key]) => {
    const url = new URL(key, BASE_URL);
    return target.searchParams.get("canvas") !== "1" || url.searchParams.get("canvas") === "1";
  }) || entries[0];
  return preferred ? { endpoint: preferred[0], payload: preferred[1] } : { endpoint: "", payload: null };
}

function endpointFromDesktopArtifact(fastBundlePayload, legacySnapshotPayload, endpoint) {
  const fastBundleEntry = endpointFromSnapshot(fastBundlePayload, endpoint);
  if (fastBundleEntry.payload) {
    return { ...fastBundleEntry, artifactSource: "terminal-fast-bundle" };
  }
  const legacyEntry = endpointFromSnapshot(legacySnapshotPayload, endpoint);
  if (legacyEntry.payload) {
    return { ...legacyEntry, artifactSource: "desktop-route-snapshot" };
  }
  return {
    endpoint: "",
    payload: null,
    artifactSource: "terminal-fast-bundle",
    error: "endpoint_not_in_desktop_artifact",
    fastBundleEndpointCount: Object.keys(fastBundlePayload?.endpoints || {}).length,
    legacyEndpointCount: Object.keys(legacySnapshotPayload?.endpoints || {}).length,
  };
}
function scorecardSourceReportForConfig(payload, config) {
  if (!config?.scorecardKeys?.length) return null;
  const reports = Array.isArray(payload?.sourceReports) ? payload.sourceReports : [];
  const needles = config.scorecardKeys.map((value) => String(value || "").toLowerCase()).filter(Boolean);
  return reports.find((report) => {
    const haystack = [report.key, report.strategy, report.strategyName, report.label, report.module, report.name]
      .map((value) => String(value || "").toLowerCase())
      .filter(Boolean);
    return needles.some((needle) => haystack.includes(needle) || haystack.some((value) => value.includes(needle)));
  }) || null;
}

function scorecardSummary(report) {
  if (!report) return { status: 404, ok: false, runId: "", error: "scorecard_source_report_missing" };
  return {
    status: 200,
    ok: report.ok !== false,
    runId: String(report.runId || report.sourceRunId || ""),
    strategy: String(report.strategy || report.strategyName || report.label || report.key || ""),
    key: String(report.key || ""),
    evidenceStatus: String(report.evidenceStatus || report.sourceEvidenceStatus || ""),
    publishAllowed: report.publishAllowed,
    reason: String(report.reason || report.blockedReason || report.error || ""),
  };
}

function runDateFromId(value) {
  const match = String(value || "").match(/(?:^|[-_])(\d{8})(?:[-_]|$)/);
  return match ? match[1] : "";
}

function runTimeSecondsFromId(value) {
  const match = String(value || "").match(/-(\d{6})$/);
  if (!match) return 0;
  const text = match[1];
  const hour = Number(text.slice(0, 2));
  const minute = Number(text.slice(2, 4));
  const second = Number(text.slice(4, 6));
  if (![hour, minute, second].every(Number.isFinite)) return 0;
  return hour * 3600 + minute * 60 + second;
}

function scorecardMembershipProtectedSummary(scorecardPayload) {
  return {
    status: Number(scorecardPayload?.status || 401),
    ok: true,
    membershipProtected: true,
    runId: "",
    strategy: "membership-required",
    key: "membership-required",
    evidenceStatus: "protected-display-layer",
    publishAllowed: null,
    reason: "scorecard protected by membership gate",
  };
}

function parseMobileFragment(html) {
  const runId = String(html.match(/data-run-id="([^"]*)"/)?.[1] || "").trim();
  const count = cleanNumber(html.match(/數量\s*<b>([^<]*)<\/b>/)?.[1]);
  const updated = String(html.match(/更新\s*<b>([^<]*)<\/b>/)?.[1] || "").trim();
  const title = String(html.match(/<strong>([^<]*)<\/strong>/)?.[1] || "").trim();
  const top = [...html.matchAll(/<h4>([^<]*)<\/h4>/g)].slice(0, 5).map((match) => decodeHtml(match[1]));
  const statusLine = String(html.match(/<article class="mobile-terminal-head">[\s\S]*?<p>([\s\S]*?)<\/p>/)?.[1] || "").replace(/<[^>]+>/g, "").trim();
  const empty = /empty-state/.test(html);
  return {
    status: 200,
    runId,
    count,
    updatedAt: updated,
    title: decodeHtml(title),
    statusLine: decodeHtml(statusLine),
    top,
    empty,
  };
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function compatibleRun(expected, actual, options = {}) {
  if (!expected || !actual) return true;
  if (expected.runId && actual.runId && expected.runId !== actual.runId) return false;
  if (!expected.runId && !actual.runId && expected.date && actual.date && expected.date !== actual.date && !options.allowDateMismatch) return false;
  return true;
}

function isMembershipSnapshotFallback(summary) {
  return Boolean(summary && summary.snapshotFallback === true && /membership_required/i.test(String(summary.error || "")));
}

function isNonTradingRealtimeZero(config, live, compact) {
  if (config?.key !== "realtime-radar") return false;
  const text = `${live?.error || ""} ${compact?.error || ""}`;
  return /non-trading-day-cache|market_closed|weekend|holiday|source_date_not_today|realtime_radar_source_date_not_today/i.test(text)
    && cleanNumber(live?.count || live?.returnedCount) === 0
    && cleanNumber(compact?.count || compact?.returnedCount) === 0;
}

function previousGoodHoldSupabaseAuthoritative(config, supabase) {
  if (!REQUIRE_UNATTENDED || config?.key === "market") return false;
  if (!MARKET_CALENDAR?.formalScanSkipped || !MARKET_CALENDAR?.preservePreviousGood) return false;
  if (!supabase?.ok || !supabase?.runId) return false;
  const latestDate = runDateFromId(supabase.runId) || compactDate(supabase.date || supabase.tradeDate || supabase.updatedAt);
  if (latestDate !== EXPECTED_DATE) return false;
  if (supabase.fallback === true || supabase.snapshotFallback === true) return false;
  return true;
}
function membershipOrDesktopSnapshotFresh(config, supabase, live, compact, snapshot) {
  if (!config?.allowReceiptDriftWhenDownstreamFresh) return false;
  if (!supabase?.runId || !snapshot?.runId || snapshot.runId !== supabase.runId) return false;
  const snapshotCount = cleanNumber(snapshot.count || snapshot.returnedCount);
  const supabaseCount = cleanNumber(supabase.count);
  const protectedSurface = Boolean(live?.membershipProtected || compact?.membershipProtected);
  if (!protectedSurface) return false;
  if (snapshotCount === supabaseCount) return true;
  return supabaseCount > 0 && snapshotCount > 0 && snapshotCount <= supabaseCount;
}

function obviousFallback(summary) {
  const text = [
    summary?.source,
    summary?.cacheSource,
    summary?.transportSource,
    summary?.error,
  ].join(" ").toLowerCase();
  const officialDesktopSnapshot = /supabase:desktop_route_snapshot/.test(text)
    && !/snapshot-soft-fallback|snapshot-friendly-empty|previous/.test(text);
  return /(static|fallback|previous|json-snapshot|snapshot-friendly-empty)/.test(text)
    || (summary?.snapshotFallback && !officialDesktopSnapshot);
}

function allowedFormalQuoteViewFallback(config, summary) {
  return Boolean(
    config?.allowFormalQuoteViewFallback
    && summary
    && summary.status < 500
    && summary.ok !== false
    && summary.cacheSource === "supabase-quote-view"
    && summary.source === "supabase:fugle_realtime_quote_latest"
    && summary.date === taipeiDateKey()
    && cleanNumber(summary.count || summary.returnedCount) > 0
  );
}

function compatibleLiveSurfaceRun(config, left, right) {
  if (!left?.runId || !right?.runId || left.runId === right.runId) return true;
  if (allowedHighFrequencySnapshotDrift(config, left, right)) return true;
  if (!config?.allowFormalQuoteViewFallback) return false;
  return allowedFormalQuoteViewFallback(config, left)
    && allowedFormalQuoteViewFallback(config, right)
    && left.date
    && left.date === right.date;
}
function desktopArtifactCoveredByTerminalApi(config, live, compact, snapshot) {
  const missingDesktopArtifact = snapshot?.error === "endpoint_not_in_desktop_snapshot"
    || snapshot?.error === "endpoint_not_in_desktop_artifact";
  if (!missingDesktopArtifact) return false;
  if (!compact || compact.membershipProtected || compact.status >= 500 || compact.ok === false) return false;
  if (obviousFallback(compact) && !allowedFormalQuoteViewFallback(config, compact)) return false;
  if (live && !live.membershipProtected && !compatibleLiveSurfaceRun(config, live, compact)) return false;
  if (!compact.runId && !compact.date) return false;
  return true;
}
function timestampMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function allowedHighFrequencySnapshotDrift(config, live, snapshot) {
  if (!["realtime-radar", "strategy2"].includes(config?.key)) return false;
  if (!config.allowDesktopSnapshotRunIdDrift) return false;
  if (!live?.runId || !snapshot?.runId || live.runId === snapshot.runId) return false;
  if (live?.status >= 500 || snapshot?.status >= 500 || live?.ok === false || snapshot?.ok === false) return false;
  if (obviousFallback(live) || obviousFallback(snapshot)) return false;
  if (cleanNumber(live.count || live.returnedCount) <= 0 || cleanNumber(snapshot.count || snapshot.returnedCount) <= 0) return false;
  const liveDate = runDateFromId(live.runId) || compactDate(live.date || live.tradeDate || live.updatedAt);
  const snapshotDate = runDateFromId(snapshot.runId) || compactDate(snapshot.date || snapshot.tradeDate || snapshot.updatedAt);
  if (!liveDate || !snapshotDate || liveDate !== snapshotDate) return false;
  if (config.key === "strategy2" && liveDate !== EXPECTED_DATE) return false;
  const maxDriftMs = (config.key === "strategy2" ? 3 : 5) * 60 * 1000;
  const liveAt = timestampMs(live.updatedAt || live.sourceSnapshotCapturedAt || live.servedAt);
  const snapshotAt = timestampMs(snapshot.updatedAt || snapshot.sourceSnapshotCapturedAt || snapshot.servedAt);
  if (liveAt && snapshotAt) return Math.abs(liveAt - snapshotAt) <= maxDriftMs;
  const liveRunSeconds = runTimeSecondsFromId(live.runId);
  const snapshotRunSeconds = runTimeSecondsFromId(snapshot.runId);
  if (liveRunSeconds && snapshotRunSeconds) return Math.abs(liveRunSeconds - snapshotRunSeconds) <= maxDriftMs / 1000;
  return config.key !== "strategy2";
}


function downstreamReadyDespiteReceiptWarning(config, receipt, supabase, live, compact, snapshot, mobile) {
  const reason = `${receipt?.blockingReason || ""} ${(receipt?.warnings || []).join(" ")}`;
  if (!/desktop snapshot refresh/i.test(reason)) return false;
  if (!supabase?.runId || cleanNumber(supabase.count) <= 0) return false;
  if (live?.status >= 500 || live?.ok === false || live.runId !== supabase.runId) return false;
  if (compact?.status >= 500 || compact?.ok === false || compact.runId !== supabase.runId) return false;
  if (snapshot?.status >= 500 || snapshot?.ok === false || snapshot.runId !== supabase.runId) return false;
  if (mobile?.runId && !String(mobile.runId).includes("waiting") && mobile.runId !== supabase.runId) return false;
  return cleanNumber(live.count || live.returnedCount) > 0
    && cleanNumber(compact.count || compact.returnedCount) > 0
    && (config.allowMissingDesktopSnapshot || cleanNumber(snapshot.count || snapshot.returnedCount) > 0);
}

function allowedStrategy2IntradayReceiptDrift(config, receipt, supabase, live, compact, mobile) {
  if (config?.key !== "strategy2") return false;
  if (!receipt || receipt.status !== "complete" || receipt.complete !== true || receipt.fallback || receipt.exitCode > 0) return false;
  if (!supabase?.ok || !supabase.runId) return false;
  const receiptDate = runDateFromId(receipt.runId) || compactDate(receipt.finishedAt);
  const latestDate = runDateFromId(supabase.runId) || compactDate(supabase.date || supabase.tradeDate || supabase.updatedAt);
  if (receiptDate !== EXPECTED_DATE || latestDate !== EXPECTED_DATE) return false;
  if (live && !live.membershipProtected) {
    if (live.status >= 500 || live.ok === false || live.runId !== supabase.runId) return false;
    if (cleanNumber(live.count || live.returnedCount) <= 0) return false;
  }
  if (compact && !compact.membershipProtected) {
    if (compact.status >= 500 || compact.ok === false || compact.runId !== supabase.runId) return false;
    if (cleanNumber(compact.count || compact.returnedCount) <= 0) return false;
  }
  if (mobile && mobile.runId && !String(mobile.runId).includes("waiting") && mobile.runId !== supabase.runId) return false;
  return true;
}
function downstreamAuthoritativeDespiteReceiptDrift(config, supabase, live, compact, snapshot, mobile) {
  const expectedRunId = supabase?.runId || "";
  const expectedDate = supabase?.date || live?.date || compact?.date || "";
  if (!config?.allowReceiptDriftWhenDownstreamFresh) return false;
  if (!expectedRunId && !expectedDate) return false;
  const expectedCount = cleanNumber(supabase?.count);
  const allowZero = Boolean(config.allowZeroTerminal && expectedCount === 0);
  for (const item of [live, compact, snapshot]) {
    if (!item || item.status >= 500 || item.ok === false) return false;
    if (expectedRunId && item.runId && item.runId !== expectedRunId) return false;
    if (!expectedRunId && expectedDate && item.date && item.date !== expectedDate) return false;
    if (!allowZero && cleanNumber(item.count || item.returnedCount) <= 0) return false;
    if (obviousFallback(item)) return false;
  }
  if (mobile) {
    if (mobile.status >= 500 || mobile.ok === false) return false;
    if (mobile.empty && !allowZero) return false;
    if (expectedRunId && mobile.runId && !String(mobile.runId).includes("waiting") && mobile.runId !== expectedRunId) return false;
  }
  return true;
}

function issueList(config, receipt, sourceHealth, supabase, live, compact, snapshot, mobile, scorecard) {
  const issues = [];
  const scheduleStatus = scheduleStatusForConfig(config);
  const pendingNotDue = scheduleStatus.pendingNotDue === true;
  const downstreamFresh = previousGoodHoldSupabaseAuthoritative(config, supabase)
    || allowedStrategy2IntradayReceiptDrift(config, receipt, supabase, live, compact, mobile)
    || downstreamAuthoritativeDespiteReceiptDrift(config, supabase, live, compact, snapshot, mobile)
    || membershipOrDesktopSnapshotFresh(config, supabase, live, compact, snapshot);
  const downstreamReceiptAuthoritative = downstreamFresh
    || downstreamReadyDespiteReceiptWarning(config, receipt, supabase, live, compact, snapshot, mobile);
  if (REQUIRE_UNATTENDED && config.key !== "market") {
    if (!receipt) {
      if (!downstreamReceiptAuthoritative && !pendingNotDue) issues.push("unattended: scanner receipt missing");
    } else if (!downstreamReceiptAuthoritative && !pendingNotDue) {
      if (receipt.status !== "complete" || receipt.complete !== true || receipt.exitCode > 0) {
        issues.push(`unattended: scanner receipt is not complete (${receipt.status || "unknown"} exit=${receipt.exitCode ?? ""})`);
      }
      if (receipt.fallback) issues.push("unattended: scanner receipt fallback=true");
      const receiptDate = runDateFromId(receipt.runId) || compactDate(receipt.finishedAt);
      if (receiptDate && receiptDate !== EXPECTED_DATE && !pendingNotDue) issues.push(`unattended: scanner receipt date ${receiptDate} != expected ${EXPECTED_DATE}`);
      if (!receipt.runId && !pendingNotDue) issues.push("unattended: scanner receipt missing runId");
    }
    const latestDate = runDateFromId(supabase?.runId) || compactDate(supabase?.date || supabase?.tradeDate || supabase?.updatedAt);
    if (!supabase?.runId && config.key !== "market" && !pendingNotDue) issues.push("unattended: Supabase latest missing runId");
    if (latestDate && latestDate !== EXPECTED_DATE && !pendingNotDue) issues.push(`unattended: Supabase latest date ${latestDate} != expected ${EXPECTED_DATE}`);
    if (scorecard?.membershipProtected && config.scorecardKeys?.length && !pendingNotDue) {
      if (!protectedReadbackAuth.enabled) {
        const suffix = protectedReadbackAuth.attempted ? ` (${protectedReadbackAuth.source || "auth"} status=${protectedReadbackAuth.status || 0} ${protectedReadbackAuth.error || ""})` : " (token not armed)";
        issues.push(`unattended: /88 authenticated readback required${suffix}`.trim());
      }
    }
  }
  if (receipt && !pendingNotDue) {
    if (receipt.status === "missing") issues.push(`scanner receipt missing: ${receipt.key}`);
    if (receipt.status === "failed" || receipt.complete === false || receipt.exitCode > 0) {
      if (!downstreamFresh && !downstreamReadyDespiteReceiptWarning(config, receipt, supabase, live, compact, snapshot, mobile)) {
        issues.push(`scanner receipt failed: ${receipt.status || "unknown"} exit=${receipt.exitCode ?? ""} ${receipt.blockingReason || ""}`.trim());
      }
    } else if (receipt.status && receipt.status !== "complete" && !downstreamFresh) {
      issues.push(`scanner receipt not clean: ${receipt.status}`);
    }
    if (receipt.fallback && !downstreamFresh) issues.push("scanner receipt fallback=true");
    if (config.requireReceiptRunId && supabase?.runId && !receipt.runId && !downstreamFresh) {
      issues.push(`scanner receipt missing runId for latest complete run ${supabase.runId}`);
    }
    if (config.requireReceiptCountMatch && supabase?.count > 0 && receipt.matches !== supabase.count && !downstreamFresh) {
      issues.push(`scanner receipt matches != Supabase latest count (${receipt.matches} vs ${supabase.count})`);
    }
    if (receipt.runId && supabase?.runId && receipt.runId !== supabase.runId && !downstreamFresh) {
      issues.push(`scanner receipt runId != Supabase latest (${receipt.runId} vs ${supabase.runId})`);
    }
    if (receipt.runId && compact?.runId && receipt.runId !== compact.runId && !downstreamFresh) {
      issues.push(`scanner receipt runId != terminal API (${receipt.runId} vs ${compact.runId})`);
    }
  }
  if (sourceHealth) {
    const sourceHealthIssues = Array.isArray(sourceHealth.issues) ? sourceHealth.issues : [];
    const sourceHealthWarnings = Array.isArray(sourceHealth.warnings) ? sourceHealth.warnings : [];
    const sourceHealthHasActionableFailure = sourceHealthIssues.length > 0 || sourceHealthWarnings.length > 0;
    if (sourceHealth.status && sourceHealth.status !== "ok" && sourceHealthHasActionableFailure) {
      issues.push(`sourceHealth ${sourceHealth.status}: ${sourceHealthIssues.join("; ") || sourceHealthWarnings.join("; ")}`);
    }
    if (sourceHealth.warningLimit && sourceHealth.warningCount > sourceHealth.warningLimit) {
      issues.push(`sourceHealth warningCount ${sourceHealth.warningCount} > ${sourceHealth.warningLimit}`);
    }const driftReadyCoversCandidateFloor = Boolean(
      config.allowSourceHealthDriftReady
      && sourceHealth.driftIntradayReady
      && sourceHealth.driftIntradayRowCount >= (sourceHealth.driftIntradayEffectiveMinRequired || sourceHealth.driftIntradayMinRequired)
      && (
        sourceHealth.driftIntradayRowCount >= sourceHealth.minIntraday1mCandidates
        || sourceHealth.driftIntradayReadinessGrade === "ready_with_tolerance"
      )
    );
    if (sourceHealth.minIntraday1mCandidates && sourceHealth.intraday1mReadyCount < sourceHealth.minIntraday1mCandidates && !driftReadyCoversCandidateFloor) {
      issues.push(`sourceHealth intraday1mReadyCount ${sourceHealth.intraday1mReadyCount} < ${sourceHealth.minIntraday1mCandidates}`);
    }
  }
  const nonTradingRealtimeZero = isNonTradingRealtimeZero(config, live, compact);
  if (!live?.membershipProtected && !nonTradingRealtimeZero && (live?.status >= 500 || live?.ok === false)) issues.push(`live API ${live.status || ""} ${live.error || ""}`.trim());
  if (!compact?.membershipProtected && !nonTradingRealtimeZero && (compact?.status >= 500 || compact?.ok === false)) issues.push(`terminal API ${compact.status || ""} ${compact.error || ""}`.trim());
  if (config.requireApiRunId && !live?.runId && !live?.membershipProtected) issues.push("live API missing runId");
  if (config.requireApiRunId && !compact?.runId && !compact?.membershipProtected) issues.push("terminal API missing runId");
  if (config.requireWriteBudgetDisclosure && !live?.writeBudgetStatus && !live?.membershipProtected) issues.push("live API missing writeBudget disclosure");
  if (config.requireWriteBudgetDisclosure && !compact?.writeBudgetStatus && !compact?.membershipProtected) issues.push("terminal API missing writeBudget disclosure");
  const desktopSnapshotMissingAllowed = Boolean(
    (config.allowMissingDesktopSnapshot && (snapshot?.error === "endpoint_not_in_desktop_snapshot" || snapshot?.error === "endpoint_not_in_desktop_artifact"))
    || desktopArtifactCoveredByTerminalApi(config, live, compact, snapshot)
  );
  if (!nonTradingRealtimeZero && !snapshot?.membershipProtected && (snapshot?.status >= 500 || (snapshot?.ok === false && !desktopSnapshotMissingAllowed))) {
    issues.push(`desktop artifact endpoint missing/error`);
  }
  if (mobile && mobile.status >= 500) issues.push(`mobile fragment ${mobile.status}`);
  if (supabase?.ok && live && !live?.membershipProtected && !compatibleRun(supabase, live, { allowDateMismatch: config.key === "strategy5" })) {
    issues.push(`Supabase latest run != live API (${supabase.runId || supabase.date} vs ${live.runId || live.date})`);
  }
  if (!live?.membershipProtected && !compact?.membershipProtected && !compatibleLiveSurfaceRun(config, live, compact)) issues.push(`live API != terminal API runId (${live.runId} vs ${compact.runId})`);
  const allowedDesktopSnapshotDrift = Boolean(
    config.allowDesktopSnapshotRunIdDrift
    && allowedFormalQuoteViewFallback(config, live)
    && allowedFormalQuoteViewFallback(config, snapshot)
    && live.date
    && live.date === snapshot.date
  );
  const allowedRealtimeSnapshotDrift = allowedHighFrequencySnapshotDrift(config, live, snapshot);
  if (!nonTradingRealtimeZero && !desktopSnapshotMissingAllowed && !live?.membershipProtected && !snapshot?.membershipProtected && !compatibleLiveSurfaceRun(config, live, snapshot) && !allowedDesktopSnapshotDrift && !allowedRealtimeSnapshotDrift) issues.push(`live API != desktop artifact runId (${live.runId} vs ${snapshot.runId})`);
  const allowedMobileRunIdDrift = allowedHighFrequencySnapshotDrift(config, live, mobile);
  if (live?.runId && mobile?.runId && !String(mobile.runId).includes("waiting") && live.runId !== mobile.runId && !allowedMobileRunIdDrift) issues.push(`live API != mobile fragment runId (${live.runId} vs ${mobile.runId})`);
  if (config.scorecardKeys?.length) {
    const expectedRunId = supabase?.runId || live?.runId || compact?.runId || snapshot?.runId || receipt?.runId || "";
    if (scorecard?.membershipProtected) {
      // The /88 scorecard API is protected by membership. This proves the
      // display gate is active; computation continuity is checked via
      // Supabase latest + desktop snapshot above.
    } else if (!scorecard || scorecard.status === 404) issues.push(`scorecard /88 row/sourceReport missing for ${config.key}`);
    else if (expectedRunId && scorecard.runId && scorecard.runId !== expectedRunId && !allowedHighFrequencySnapshotDrift(config, { runId: expectedRunId, date: supabase?.date || live?.date || compact?.date, count: supabase?.count || live?.count || compact?.count, ok: true, status: 200, updatedAt: supabase?.updatedAt || live?.updatedAt || compact?.updatedAt }, { ...scorecard, count: scorecard.count || scorecard.returnedCount || supabase?.count || live?.count || compact?.count })) issues.push(`scorecard /88 row/sourceReport runId != latest pointer (${scorecard.runId} vs ${expectedRunId})`);
    else if (expectedRunId && !scorecard.runId) issues.push(`scorecard /88 row/sourceReport missing runId for ${config.key}`);
  }
  const controlledWaiting = config.allowSoftSnapshotFallback && /decision|futopt|not_ready|waiting/i.test(`${compact?.error || ""} ${snapshot?.error || ""} ${mobile?.runId || ""}`);
  if (obviousFallback(compact) && !controlledWaiting && !allowedFormalQuoteViewFallback(config, compact)) issues.push(`terminal API fallback marker: ${compact.cacheSource || compact.transportSource || compact.error}`);
  if (obviousFallback(snapshot) && !controlledWaiting && !allowedFormalQuoteViewFallback(config, snapshot) && !isMembershipSnapshotFallback(snapshot)) issues.push(`desktop snapshot fallback marker: ${snapshot.cacheSource || snapshot.transportSource || snapshot.error}`);
  if (!config.allowZeroTerminal && compact && !compact.membershipProtected && cleanNumber(compact.count || compact.returnedCount) <= 0 && !nonTradingRealtimeZero) issues.push("terminal API has zero rows");
  if (!config.allowZeroTerminal && mobile && mobile.empty) issues.push("mobile fragment empty");
  return issues;
}

async function auditOne(config, desktopSnapshotPayload, fastBundlePayload, scorecardPayload) {
  const receipt = receiptSummary(config.receiptKey);
  const endpoint = withQuery(config.endpoint, { canvas: 1, compact: 1, shell: 1, limit: 60, t: Date.now() });
  const liveEndpoint = withQuery(config.directEndpoint || config.endpoint, { canvas: 1, compact: 1, shell: 1, limit: 60, t: Date.now() });
  const [latestRun, snapshotKey, liveResult, compactResult, mobileResult] = await Promise.all([
    fetchLatestRun(config),
    fetchSnapshotKey(config.snapshotKey),
    fetchJson(publicUrl(liveEndpoint)),
    fetchJson(publicUrl(endpoint)),
    config.mobileTab ? fetchText(publicUrl(withQuery("/api/mobile-fragment", { tab: config.mobileTab, t: Date.now() })), { accept: "text/html", timeoutMs: 30000 }) : Promise.resolve(null),
  ]);
  const supabase = latestRun || snapshotKey;
  const resultRows = supabase?.runId ? await fetchResultRows(config, supabase.runId) : null;
  const live = isMembershipRequiredPayload(liveResult.json) ? membershipProtectedSummary(liveResult) : liveResult.json ? summarizePayload(liveResult.json, liveResult.status, liveResult.elapsedMs) : {
    status: liveResult.status,
    ok: false,
    elapsedMs: liveResult.elapsedMs,
    error: liveResult.error || liveResult.text?.slice(0, 140) || "",
  };
  const compact = isMembershipRequiredPayload(compactResult.json) ? membershipProtectedSummary(compactResult) : compactResult.json ? summarizePayload(compactResult.json, compactResult.status, compactResult.elapsedMs) : {
    status: compactResult.status,
    ok: false,
    elapsedMs: compactResult.elapsedMs,
    error: compactResult.error || compactResult.text?.slice(0, 140) || "",
  };
  const snapEntry = endpointFromDesktopArtifact(fastBundlePayload, desktopSnapshotPayload, endpoint);
  const desktopSnapshot = snapEntry.payload ? {
    ...summarizePayload(snapEntry.payload, 200, 0),
    endpoint: snapEntry.endpoint,
    artifactSource: snapEntry.artifactSource,
  } : (fastBundlePayload?.membershipRequired || fastBundlePayload?.protected) && !PROTECTED_READBACK_TOKEN ? {
    status: 401,
    ok: true,
    membershipProtected: true,
    endpoint: "",
    artifactSource: "terminal-fast-bundle",
    cacheSource: "membership-required",
    transportSource: "membership-gate",
    error: "desktop artifact protected by membership gate; protected readback token not armed",
  } : {
    status: 404,
    ok: false,
    endpoint: "",
    artifactSource: snapEntry.artifactSource,
    error: snapEntry.error || "endpoint_not_in_desktop_artifact",
    fastBundleEndpointCount: snapEntry.fastBundleEndpointCount,
    legacyEndpointCount: snapEntry.legacyEndpointCount,
  };
  const mobile = mobileResult ? (mobileResult.ok
    ? parseMobileFragment(mobileResult.text)
    : { status: mobileResult.status, ok: false, error: mobileResult.error || mobileResult.text?.slice(0, 140) || "" }) : null;
  const sourceHealth = sourceHealthSummary(liveResult.json, supabase)
    || sourceHealthSummary(compactResult.json, supabase)
    || sourceHealthSummary(snapEntry.payload, supabase);
  const scorecard = isMembershipRequiredPayload(scorecardPayload)
    ? scorecardMembershipProtectedSummary(scorecardPayload)
    : scorecardSummary(scorecardSourceReportForConfig(scorecardPayload, config));
  const scheduleStatus = scheduleStatusForConfig(config);
  const issues = issueList(config, receipt, sourceHealth, supabase, live, compact, desktopSnapshot, mobile, scorecard);
  return {
    key: config.key,
    label: config.label,
    policy: config.policy,
    scheduleStatus,
    receipt,
    sourceHealth,
    endpoint,
    liveEndpoint,
    supabase,
    supabaseNotApplicable: !config.runView && !config.snapshotKey,
    resultRows,
    live,
    terminalApi: compact,
    desktopSnapshot,
    desktopSnapshotNotApplicable: config.allowMissingDesktopSnapshot && (desktopSnapshot?.error === "endpoint_not_in_desktop_snapshot" || desktopSnapshot?.error === "endpoint_not_in_desktop_artifact"),
    mobileFragment: mobile,
    scorecard,
    ok: issues.length === 0,
    issues,
  };
}

function markdown(results, desktopSnapshot, fastBundle) {
  const lines = [];
  lines.push("# Terminal Resource Chain Audit");
  lines.push("");
  lines.push(`- Checked: ${NOW.toISOString()} / Taipei ${new Date().toLocaleString("sv-SE", { timeZone: "Asia/Taipei" })}`);
  lines.push(`- Base URL: ${BASE_URL}`);
  lines.push(`- Desktop snapshot: status=${desktopSnapshot.status} fresh=${desktopSnapshot.summary?.snapshotFresh ?? ""} updatedAt=${desktopSnapshot.summary?.updatedAt || ""} endpointCount=${desktopSnapshot.summary?.endpointCount || 0}`);
  lines.push(`- Terminal fast bundle: status=${fastBundle.status} fresh=${fastBundle.summary?.snapshotFresh ?? ""} updatedAt=${fastBundle.summary?.updatedAt || ""} endpointCount=${fastBundle.summary?.endpointCount || 0}`);
  lines.push("");
  lines.push("| 項目 | 排程狀態 | scanner receipt | source health | Supabase 最新 | production API | 終端 compact API | desktop artifact | mobile fragment | /88 row/sourceReport | 判定 |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const row of results) {
    const schedule = row.scheduleStatus ? `${row.scheduleStatus.state || "--"}<br>${row.scheduleStatus.dueTime || "--"}` : "n/a";
    const receipt = row.receipt
      ? `${row.receipt.status || "--"}<br>${row.receipt.runId || "--"}<br>${row.receipt.finishedAt || "--"}`
      : "n/a";
    const sourceHealth = row.sourceHealth
      ? `${row.sourceHealth.status || "--"}<br>session1m=${row.sourceHealth.intraday1mReadyCount || 0}/${row.sourceHealth.minIntraday1mCandidates || "--"} warn=${row.sourceHealth.warningCount || 0}/${row.sourceHealth.warningLimit || "--"}`
      : "n/a";
    const sup = row.supabase?.ok
      ? `${row.supabase.runId || row.supabase.date || "--"}<br>${row.supabase.count ?? "--"}`
      : row.supabaseNotApplicable
        ? "n/a"
      : `ERR ${row.supabase?.error || "missing"}`;
    const live = `${row.live?.status || "--"} ${row.live?.runId || row.live?.date || "--"}<br>${row.live?.count ?? "--"} ${row.live?.cacheSource || row.live?.transportSource || ""}`;
    const term = `${row.terminalApi?.status || "--"} ${row.terminalApi?.runId || row.terminalApi?.date || "--"}<br>${row.terminalApi?.count ?? "--"} ${row.terminalApi?.cacheSource || row.terminalApi?.transportSource || ""}`;
    const snap = row.desktopSnapshotNotApplicable
      ? "n/a"
      : `${row.desktopSnapshot?.status || "--"} ${row.desktopSnapshot?.runId || row.desktopSnapshot?.date || "--"}<br>${row.desktopSnapshot?.count ?? "--"} ${row.desktopSnapshot?.cacheSource || row.desktopSnapshot?.transportSource || ""}`;
    const mob = row.mobileFragment
      ? `${row.mobileFragment.status || "--"} ${row.mobileFragment.runId || "--"}<br>${row.mobileFragment.count ?? "--"}`
      : "n/a";
    const scorecard = row.scorecard ? `${row.scorecard.status || "--"} ${row.scorecard.runId || "--"}<br>${row.scorecard.strategy || row.scorecard.key || row.scorecard.error || "--"}` : "n/a";
    lines.push(`| ${row.label} | ${schedule} | ${receipt} | ${sourceHealth} | ${sup} | ${live} | ${term} | ${snap} | ${mob} | ${scorecard} | ${row.ok ? "OK" : row.issues.join("<br>")} |`);
  }
  lines.push("");
  lines.push("## Top Rows");
  for (const row of results) {
    lines.push(`### ${row.label}`);
    lines.push(`- Supabase top: ${(row.resultRows?.top || row.supabase?.top || []).join(" / ") || "--"}`);
    lines.push(`- live API top: ${(row.live?.top || []).join(" / ") || "--"}`);
    lines.push(`- terminal API top: ${(row.terminalApi?.top || []).join(" / ") || "--"}`);
    lines.push(`- desktop artifact top: ${(row.desktopSnapshot?.top || []).join(" / ") || "--"}`);
    if (row.mobileFragment) lines.push(`- mobile fragment top: ${(row.mobileFragment.top || []).join(" / ") || "--"}`);
    if (row.issues.length) lines.push(`- Issues: ${row.issues.join("；")}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const marketCalendar = await buildMarketCalendarContract().catch(() => null);
  MARKET_CALENDAR = marketCalendar;
  if (!CLI_EXPECTED_DATE && marketCalendar) {
    const calendarExpected = marketCalendar.marketOpen === false ? compactDate(marketCalendar.displayTradeDate || marketCalendar.marketDate || marketCalendar.requestedDate) : compactDate(marketCalendar.marketDate || marketCalendar.requestedDate || marketCalendar.displayTradeDate);
    if (calendarExpected) {
      EXPECTED_DATE = calendarExpected;
      EXPECTED_DATE_SOURCE = marketCalendar.marketOpen === false ? "market_calendar_display_trade_date" : "market_calendar_market_date";
    }
  }
  await ensureProtectedReadbackToken();
  const [desktopSnapshotResult, fastBundleResult, scorecardResult] = await Promise.all([
    fetchJson(publicUrl(withQuery("/api/desktop-route-snapshot", { t: Date.now() })), { timeoutMs: 35000 }),
    fetchJson(publicUrl(withQuery("/api/terminal-fast-bundle", { t: Date.now() })), { timeoutMs: 35000 }),
    fetchJson(publicUrl(withQuery("/api/scorecard", { t: Date.now() })), { timeoutMs: 35000 }),
  ]);
  const desktopSnapshotPayload = desktopSnapshotResult.json || {};
  const fastBundlePayload = fastBundleResult.json || {};
  const scorecardPayload = scorecardResult.json || {};
  const results = [];
  for (const config of STRATEGIES.filter((item) => !ROUTE_FILTER.size || ROUTE_FILTER.has(item.key))) {
    console.log(`[audit] ${config.key}`);
    results.push(await auditOne(config, desktopSnapshotPayload, fastBundlePayload, scorecardPayload));
  }
  const desktopSnapshot = {
    status: desktopSnapshotResult.status,
    summary: {
      snapshotFresh: desktopSnapshotPayload.snapshotFresh,
      updatedAt: desktopSnapshotPayload.updatedAt || desktopSnapshotPayload.generatedAt,
      endpointCount: Object.keys(desktopSnapshotPayload.endpoints || {}).length,
      partial: desktopSnapshotPayload.partial,
      misses: desktopSnapshotPayload.misses || [],
    },
  };
  const fastBundle = {
    status: fastBundleResult.status,
    summary: {
      snapshotFresh: fastBundlePayload.snapshotFresh,
      updatedAt: fastBundlePayload.updatedAt || fastBundlePayload.generatedAt,
      endpointCount: Object.keys(fastBundlePayload.endpoints || {}).length,
      partial: fastBundlePayload.partial,
      misses: fastBundlePayload.misses || [],
    },
  };
  const payload = {
    checkedAt: NOW.toISOString(),
    baseUrl: BASE_URL,
    expectedDate: EXPECTED_DATE,
    expectedDateSource: EXPECTED_DATE_SOURCE,
    marketCalendar,
    desktopSnapshot,
    fastBundle,
    protectedReadbackAuth,
    results,
    ok: results.every((row) => row.ok),
  };
  const jsonFile = path.join(OUT_DIR, "terminal-resource-chain-audit.json");
  const mdFile = path.join(OUT_DIR, "terminal-resource-chain-audit.md");
  await fs.promises.writeFile(jsonFile, JSON.stringify(payload, null, 2));
  await fs.promises.writeFile(mdFile, markdown(results, desktopSnapshot, fastBundle));
  console.log(`[audit] wrote ${mdFile}`);
  if (!payload.ok) {
    console.error("[audit] issues found");
    for (const row of results.filter((item) => !item.ok)) {
      console.error(`- ${row.key}: ${row.issues.join("; ")}`);
    }
    process.exitCode = 1;
  } else {
    console.log("[audit] ok");
  }
}

main().catch((error) => {
  console.error(`[audit] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
