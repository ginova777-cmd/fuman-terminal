const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { cleanNumber, isIntradayTradable } = require("./intraday-radar-rules");
const { isTwseTradingDay } = require("./twse-trading-day");
const { buildRunTimeSourceSnapshotFields } = require("../lib/run-time-source-snapshot-contract");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = process.env.FUMAN_DATA_DIR || path.join(ROOT, "data");
const OUT_FILE = path.join(DATA_DIR, "realtime-radar-latest.json");
const STATE_DIR = process.env.FUMAN_STATE_DIR || path.join(ROOT, "state");
const FAILED_QUEUE_FILE = path.join(STATE_DIR, "realtime-radar-failed-batches.json");
const ALERT_STATUS_FILE = path.join(STATE_DIR, "realtime-radar-alert-status.json");
const ALERT_RECEIPT_FILE = path.join(STATE_DIR, "realtime-radar-alert-receipt.json");
const SUPABASE_STATUS_FILE = path.join(STATE_DIR, "realtime-radar-supabase-status.json");
const WRITE_BUDGET_STATUS_FILE = path.join(STATE_DIR, "realtime-radar-write-budget.json");
const BASE_URL = process.env.FUMAN_BASE_URL || "https://fuman-terminal.vercel.app";

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = process.env.FUMAN_SUPABASE_URL
  || process.env.SUPABASE_URL
  || readSecretText(path.join(ROOT, "secrets", "supabase-url.txt"))
  || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-url.txt"))
  || "https://jxnqyqnigsppqsxinlrq.supabase.co";
const SUPABASE_KEY = process.env.FUMAN_SUPABASE_SERVICE_KEY
  || process.env.FUMAN_SUPABASE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || readSecretText(path.join(ROOT, "secrets", "supabase-service-role-key.txt"))
  || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-service-role-key.txt"));
const SUPABASE_TABLE = process.env.FUMAN_REALTIME_RADAR_TABLE || "fuman_realtime_radar_cache";
const STALE_AFTER_MS = Number(process.env.REALTIME_RADAR_STALE_MS || 20000);
const MAX_QUOTE_AGE_SECONDS = Number(process.env.REALTIME_RADAR_MAX_QUOTE_AGE_SECONDS || 150);
const REALTIME_RESCAN_BATCH_SIZE = Number(process.env.REALTIME_RADAR_RESCAN_BATCH_SIZE || 80);
const REALTIME_BATCH_TIMEOUT_MS = Number(process.env.REALTIME_RADAR_BATCH_TIMEOUT_MS || 18000);
const REALTIME_BATCH_CONCURRENCY = Math.max(1, Number(process.env.REALTIME_RADAR_BATCH_CONCURRENCY || 3));
const REALTIME_BATCH_SIZE = Math.max(20, Number(process.env.REALTIME_RADAR_BATCH_SIZE || 100));
const REALTIME_BATCH_RETRIES = Math.max(0, Number(process.env.REALTIME_RADAR_BATCH_RETRIES || 2));
const REALTIME_BATCH_RETRY_DELAY_MS = Math.max(0, Number(process.env.REALTIME_RADAR_BATCH_RETRY_DELAY_MS || 700));
const REALTIME_STALE_RESCAN_LIMIT = Math.max(0, Number(process.env.REALTIME_RADAR_STALE_RESCAN_LIMIT || 180));
const REALTIME_RADAR_ALERT_COOLDOWN_MS = Math.max(0, Number(process.env.REALTIME_RADAR_ALERT_COOLDOWN_MS || 15 * 60 * 1000));
const USE_LOCAL_REALTIME_API = process.env.REALTIME_RADAR_USE_LOCAL_API !== "0";
const REALTIME_RADAR_EXCLUDED_CODES = new Set(String(process.env.REALTIME_RADAR_EXCLUDED_CODES || "1475,1538,2254,2321,2901,5906,7732,8101,8488")
  .split(",")
  .map((code) => code.replace(/\D/g, "").slice(0, 4))
  .filter(Boolean));
const MARKET_START_MINUTES = 9 * 60;
const MARKET_END_MINUTES = 13 * 60 + 30;
const MARKET_START_SECONDS = MARKET_START_MINUTES * 60;
const MARKET_END_SECONDS = MARKET_END_MINUTES * 60;
const REALTIME_RADAR_SESSION_LIMIT = Math.max(120, Number(process.env.REALTIME_RADAR_SESSION_LIMIT || 1200));
const REALTIME_RADAR_WRITE_BUDGET_PER_SCAN = Math.max(1, Number(process.env.REALTIME_RADAR_WRITE_BUDGET_PER_SCAN || 3));
const REALTIME_RADAR_PRESERVE_GOOD_MAX_AGE_MS = Math.max(60 * 1000, Number(process.env.REALTIME_RADAR_PRESERVE_GOOD_MAX_AGE_MS || 5 * 60 * 1000));
const REALTIME_RADAR_FRESH_QUOTE_SECONDS = Math.max(1, Number(process.env.REALTIME_RADAR_FRESH_QUOTE_SECONDS || 120));
const REALTIME_RADAR_MIN_FRESH_QUOTE_COVERAGE = Math.min(1, Math.max(0, Number(process.env.REALTIME_RADAR_MIN_FRESH_QUOTE_COVERAGE || 0.95)));
const REALTIME_RADAR_RAW_KEEP_DAYS = Math.max(0, Number(process.env.REALTIME_RADAR_RAW_KEEP_DAYS || 0));
const REQUIRED_RADAR_FIELDS = {
  identity: ["code", "name"],
  quote: ["close", "percent", "value", "volume"],
  signal: ["side", "score", "time", "signalTags"],
};

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function compactDateKey(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function buildRealtimeRadarRunId(tradeDate, parts = taipeiParts(), detectedAt = Date.now()) {
  const date = compactDateKey(tradeDate || `${parts.year}${parts.month}${parts.day}`) || "unknown";
  const time = `${parts.hour || "00"}${parts.minute || "00"}${parts.second || "00"}`;
  return `realtime-radar-${date}-${time}-${detectedAt}`;
}

function createWriteBudget(runId) {
  return {
    runId,
    source: "realtime-radar-write-budget",
    limit: REALTIME_RADAR_WRITE_BUDGET_PER_SCAN,
    writesAttempted: 0,
    writesCompleted: 0,
    blocked: false,
    reason: "",
    checkedAt: new Date().toISOString(),
  };
}

function writeBudgetSnapshot(writeBudget, status = "open") {
  const finalStatus = {
    ok: "completed",
    completed: "completed",
    failed: "failed",
    blocked: "blocked",
    preserved: "preserved",
    skipped: "skipped",
  }[status] || (status === "committing" || status === "open" ? "pending" : status);
  return {
    source: writeBudget.source,
    status,
    finalStatus,
    runId: writeBudget.runId,
    limit: writeBudget.limit,
    writesAttempted: writeBudget.writesAttempted,
    writesCompleted: writeBudget.writesCompleted,
    allowed: writeBudget.blocked !== true && writeBudget.writesAttempted <= writeBudget.limit,
    used: writeBudget.writesAttempted,
    remaining: Math.max(0, writeBudget.limit - writeBudget.writesAttempted),
    blocked: writeBudget.blocked,
    reason: writeBudget.reason,
    checkedAt: new Date().toISOString(),
  };
}

function persistWriteBudget(writeBudget, status = "open") {
  const snapshot = writeBudgetSnapshot(writeBudget, status);
  writeJson(WRITE_BUDGET_STATUS_FILE, snapshot);
  return snapshot;
}

function runtimeSecret(fileNames = []) {
  for (const name of fileNames) {
    for (const dir of [
      path.join(RUNTIME_DIR, "secrets"),
      path.join(ROOT, "secrets"),
    ]) {
      const value = readSecretText(path.join(dir, name));
      if (value) return value;
    }
  }
  return "";
}

function alertEnvSecret(envName, fileNames = []) {
  return runtimeSecret(fileNames) || process.env[envName] || "";
}

async function sendOpsText(text) {
  const result = spawnSync(process.execPath, [path.join(__dirname, "send-workflow-alert.js")], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      FUMAN_ALERT_KIND: "failure",
      FUMAN_ALERT_SOURCE: "realtime-radar-runtime",
      FUMAN_ALERT_SUBJECT: "即時雷達資料源警示",
      FUMAN_ALERT_TEXT: text,
      FUMAN_ALERT_RECEIPT_FILE: process.env.REALTIME_RADAR_ALERT_RECEIPT_FILE || ALERT_RECEIPT_FILE,
      REPORT_EMAIL_TO: alertEnvSecret("REPORT_EMAIL_TO", ["report-email-to.txt", "smtp-to.txt", "gmail-to.txt"]),
      SMTP_USER: alertEnvSecret("SMTP_USER", ["smtp-user.txt", "gmail-user.txt"]),
      SMTP_PASS: alertEnvSecret("SMTP_PASS", ["smtp-pass.txt", "gmail-app-password.txt"]),
      SMTP_HOST: alertEnvSecret("SMTP_HOST", ["smtp-host.txt"]),
      SMTP_PORT: alertEnvSecret("SMTP_PORT", ["smtp-port.txt"]),
    },
  });
  if (result.status === 0) return "workflow-alert";
  const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
  throw new Error(`workflow alert failed${detail ? `: ${detail.slice(0, 500)}` : ""}`);
}

function normalizeAlertReceipt(receipt = {}, fallback = {}) {
  const source = String(receipt.source || fallback.source || "").toLowerCase();
  const rawKind = String(receipt.kind || fallback.kind || "").toLowerCase();
  const kind = /smoke/.test(source) || /smoke/.test(rawKind)
    ? "smoke"
    : /failure|failed|alert/.test(rawKind) || /runtime/.test(source)
      ? "failure"
      : rawKind || fallback.kind || "none";
  const deliveredAt = receipt.deliveredAt || (!receipt.dryRun && receipt.ok === true ? receipt.finishedAt : "") || "";
  return {
    ok: receipt.ok === true,
    kind,
    channel: receipt.channel || fallback.channel || "",
    deliveredAt,
    delivery_error: receipt.delivery_error || receipt.deliveryError || receipt.error || "",
    dryRun: receipt.dryRun === true,
    receiptFile: receipt.receiptFile || fallback.receiptFile || ALERT_RECEIPT_FILE,
    requiredForRun: fallback.requiredForRun === true,
    checkedAt: new Date().toISOString(),
  };
}

function noAlertReceipt() {
  const latestReceipt = readJson(ALERT_RECEIPT_FILE, {});
  const receipt = normalizeAlertReceipt({
    ...latestReceipt,
    kind: "smoke",
    source: "realtime-radar-no-alert",
  }, {
    kind: "smoke",
    channel: "smtp",
    receiptFile: ALERT_RECEIPT_FILE,
    requiredForRun: false,
  });
  return {
    ...receipt,
    kind: "smoke",
    requiredForRun: false,
    skipped: false,
    skipReason: "",
  };
}

function alertSignature(payload) {
  const staleCodes = (payload.staleQuoteDetails || []).map((item) => item.code).filter(Boolean).join(",");
  const issues = (payload.externalSourceIssues || [])
    .map((item) => `${item.source}:${item.type}:${item.status || ""}:${item.count || 0}:${item.sampleCodes || ""}`)
    .join("|");
  return `${payload.date || ""}|stale=${payload.staleQuoteCount || 0}:${staleCodes}|issues=${issues}|failed=${payload.failedBatchCount || 0}`;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(String(value).replace(/[,+%]/g, "").trim());
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function payloadQuoteCoverage(payload = {}) {
  return payload.quote_coverage_at_run || payload.quoteCoverageAtRun || payload.sourceCoverage || {};
}

function quoteCoverageMeetsRealtimeThresholds(quoteCoverage = {}) {
  const freshQuoteCoverage120s = firstFiniteNumber(
    quoteCoverage.fresh_quote_coverage_120s,
    quoteCoverage.freshQuoteCoverage120s,
    quoteCoverage.coverage_120s,
    quoteCoverage.coverage120s,
    quoteCoverage.coverage
  );
  const quoteAgeSeconds = firstFiniteNumber(
    quoteCoverage.quote_age_seconds,
    quoteCoverage.quoteAgeSeconds,
    quoteCoverage.sourceAgeSeconds,
    quoteCoverage.stale_seconds,
    quoteCoverage.staleSeconds
  );
  const failedBatchCount = cleanNumber(quoteCoverage.failedBatchCount ?? quoteCoverage.failed_batch_count);
  return Boolean(
    freshQuoteCoverage120s !== null
    && freshQuoteCoverage120s >= REALTIME_RADAR_MIN_FRESH_QUOTE_COVERAGE
    && (quoteAgeSeconds === null || quoteAgeSeconds <= REALTIME_RADAR_FRESH_QUOTE_SECONDS)
    && failedBatchCount === 0
  );
}

async function maybeSendRealtimeRadarAlert(payload) {
  const noAlert = noAlertReceipt();
  const staleDetails = payload.staleQuoteDetails || [];
  const issues = payload.externalSourceIssues || [];
  const qualityBlocksLatest = payload?.run_quality_at_publish?.publishAllowed === false
    || payload?.run_quality_at_publish?.degradedBlocksLatest === true;
  const failedBatchProblem = Number(payload.failedBatchCount || 0) > 0;
  const hasProblem = qualityBlocksLatest || failedBatchProblem;
  if (!hasProblem) return noAlert;
  const workflowAlertEnabled = process.env.REALTIME_RADAR_WORKFLOW_ALERT_NOTIFY === "1"
    || process.env.REALTIME_RADAR_GMAIL_NOTIFY === "1";
  if (process.env.REALTIME_RADAR_NOTIFY === "0" && !workflowAlertEnabled) {
    return {
      ...noAlert,
      kind: "failure",
      skipped: true,
      skipReason: "REALTIME_RADAR_NOTIFY=0",
    };
  }
  const previous = readJson(ALERT_STATUS_FILE, {});
  const signature = alertSignature(payload);
  const lastAlertAt = previous.lastAlertAt ? Date.parse(previous.lastAlertAt) : 0;
  if (previous.signature === signature && lastAlertAt && Date.now() - lastAlertAt < REALTIME_RADAR_ALERT_COOLDOWN_MS) {
    return {
      ...noAlert,
      kind: "failure",
      skipped: true,
      skipReason: "alert_cooldown",
      lastAlertAt: previous.lastAlertAt || "",
    };
  }
  const staleLines = staleDetails.slice(0, 10).map((item) => `${item.code} ${item.name || ""} age=${item.quoteAgeSeconds ?? ""}s quote=${item.quoteTime || "--"}`);
  const issueLines = issues.slice(0, 8).map((item) => `${item.source || ""} ${item.type || ""}${item.status ? ` HTTP ${item.status}` : ""} x${item.count || 0}${item.sampleCodes ? ` ${item.sampleCodes}` : ""}`.trim());
  const text = [
    `即時雷達資料源警示｜${payload.timestamp || ""}`,
    `狀態：${payload.status || ""}`,
    `staleQuoteCount：${payload.staleQuoteCount || 0}`,
    `failedBatch：${payload.failedBatchCount || 0}/${payload.totalBatchCount || 0}`,
    staleLines.length ? "" : null,
    staleLines.length ? "stale 標的：" : null,
    ...staleLines,
    issueLines.length ? "" : null,
    issueLines.length ? "外部資料源：" : null,
    ...issueLines,
  ].filter((line) => line !== null).join("\n");
  try {
    const channel = await sendOpsText(text);
    const receipt = normalizeAlertReceipt(readJson(ALERT_RECEIPT_FILE, {}), { kind: "failure", channel });
    writeJson(ALERT_STATUS_FILE, { signature, lastAlertAt: new Date().toISOString(), channel, lastError: "", receipt });
    return receipt;
  } catch (error) {
    const receipt = normalizeAlertReceipt(readJson(ALERT_RECEIPT_FILE, {}), { kind: "failure" });
    const failedReceipt = {
      ...receipt,
      ok: false,
      kind: "failure",
      delivery_error: String(error.message || error).slice(0, 500),
    };
    writeJson(ALERT_STATUS_FILE, { signature, lastAlertAt: previous.lastAlertAt || "", channel: "", lastError: failedReceipt.delivery_error, checkedAt: new Date().toISOString(), receipt: failedReceipt });
    console.log(`realtime radar alert failed: ${error.message}`);
    return failedReceipt;
  }
}

function normalizeDeferredBatch(batch = {}, reason = "failed_batch") {
  const codes = (batch.codes || []).map((code) => String(code || "")).filter(Boolean);
  return {
    reason: batch.reason || reason,
    batchIndex: batch.batchIndex || "",
    startCode: batch.startCode || codes[0] || "",
    endCode: batch.endCode || codes.at(-1) || "",
    count: batch.count || codes.length,
    codes,
    error: String(batch.error || "").slice(0, 240),
    failedAt: batch.failedAt || new Date().toISOString(),
  };
}

function readFailedBatchQueue() {
  const payload = readJson(FAILED_QUEUE_FILE, { batches: [] });
  return Array.isArray(payload?.batches) ? payload.batches : [];
}

function writeFailedBatchQueue(batches = []) {
  const byKey = new Map();
  for (const batch of batches) {
    const normalized = normalizeDeferredBatch(batch, batch.reason || "failed_batch");
    if (!normalized.codes.length) continue;
    byKey.set(normalized.codes.join(","), normalized);
  }
  const queue = [...byKey.values()].slice(0, 60);
  writeJson(FAILED_QUEUE_FILE, { updatedAt: new Date().toISOString(), count: queue.length, batches: queue });
}

function hydrateQueuedBatches(queuedBatches = [], stocks = []) {
  const stockByCode = new Map(stocks.map((stock) => [String(stock.code || ""), stock]));
  return queuedBatches.map((batch) => {
    const codes = (batch.codes || []).map((code) => String(code || "")).filter(Boolean);
    return { ...batch, codes, stocks: codes.map((code) => stockByCode.get(code)).filter(Boolean) };
  }).filter((batch) => batch.codes.length && batch.stocks.length);
}

function updateSupabaseUploadStatus(ok, error = "") {
  const previous = readJson(SUPABASE_STATUS_FILE, { consecutiveFailures: 0 });
  const payload = {
    ok,
    checkedAt: new Date().toISOString(),
    consecutiveFailures: ok ? 0 : Number(previous.consecutiveFailures || 0) + 1,
    lastSuccessAt: ok ? new Date().toISOString() : previous.lastSuccessAt || "",
    lastErrorAt: ok ? previous.lastErrorAt || "" : new Date().toISOString(),
    lastError: ok ? "" : String(error || "").slice(0, 500),
  };
  writeJson(SUPABASE_STATUS_FILE, payload);
  return payload;
}

async function safeUploadRealtimeRadarPayload(payload, writeBudget = null) {
  if (writeBudget) {
    writeBudget.writesAttempted += 1;
    if (writeBudget.writesAttempted > writeBudget.limit) {
      writeBudget.blocked = true;
      writeBudget.reason = `write budget exceeded ${writeBudget.writesAttempted}/${writeBudget.limit}`;
      payload.writeBudget = persistWriteBudget(writeBudget, "blocked");
      refreshRealtimeRadarEvidence(payload);
      return updateSupabaseUploadStatus(false, writeBudget.reason);
    }
    persistWriteBudget(writeBudget, "committing");
    payload.writeBudget = writeBudgetSnapshot({
      ...writeBudget,
      writesCompleted: writeBudget.writesCompleted + 1,
    }, "completed");
    refreshRealtimeRadarEvidence(payload);
  }
  try {
    const uploaded = await uploadRealtimeRadarPayload(payload);
    if (writeBudget && uploaded !== false) {
      writeBudget.writesCompleted += 1;
      payload.writeBudget = persistWriteBudget(writeBudget, "completed");
      refreshRealtimeRadarEvidence(payload);
    } else if (writeBudget) {
      writeBudget.reason = "Supabase credentials missing; upload skipped.";
      payload.writeBudget = persistWriteBudget(writeBudget, "skipped");
      refreshRealtimeRadarEvidence(payload);
    }
    return updateSupabaseUploadStatus(uploaded !== false, uploaded === false ? "Supabase credentials missing; upload skipped." : "");
  } catch (error) {
    if (writeBudget) {
      writeBudget.reason = error.message || String(error);
      payload.writeBudget = persistWriteBudget(writeBudget, "failed");
      refreshRealtimeRadarEvidence(payload);
    }
    console.log(`realtime radar supabase upload failed: ${error.message}`);
    return updateSupabaseUploadStatus(false, error.message);
  }
}

async function uploadRealtimeRadarPayload(payload) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${SUPABASE_TABLE}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      id: "latest",
      payload,
      updated_at: new Date(payload.updatedAtMs || Date.now()).toISOString(),
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`supabase upload failed HTTP ${response.status} ${text}`.trim());
  }
  return true;
}

function radarPayloadUpdatedAtMs(payload = {}) {
  const explicit = cleanNumber(payload.updatedAtMs);
  if (explicit > 0) return explicit;
  const parsed = Date.parse(payload.updatedAt || payload.timestamp || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function isGoodRealtimeRadarPayload(payload, tradeDate) {
  const quoteCoverage = payloadQuoteCoverage(payload || {});
  return Boolean(
    payload
    && payload.date === tradeDate
    && Array.isArray(payload.rows)
    && payload.rows.length > 0
    && quoteCoverageMeetsRealtimeThresholds(quoteCoverage)
    && cleanNumber(payload.failedBatchCount) === 0
    && payload?.run_quality_at_publish?.publishAllowed !== false
  );
}

function canPreservePreviousGoodPayload(previousPayload, tradeDate, nowMs = Date.now()) {
  if (!isGoodRealtimeRadarPayload(previousPayload, tradeDate)) return false;
  const updatedAtMs = radarPayloadUpdatedAtMs(previousPayload);
  return Boolean(updatedAtMs && nowMs - updatedAtMs <= REALTIME_RADAR_PRESERVE_GOOD_MAX_AGE_MS);
}

function rejectedScanSummary(payload = {}) {
  return {
    runId: payload.runId || "",
    timestamp: payload.timestamp || "",
    updatedAt: payload.updatedAt || "",
    staleQuoteCount: cleanNumber(payload.staleQuoteCount),
    failedBatchCount: cleanNumber(payload.failedBatchCount),
    totalBatchCount: cleanNumber(payload.totalBatchCount),
    staleQuoteDetails: Array.isArray(payload.staleQuoteDetails) ? payload.staleQuoteDetails.slice(0, 20) : [],
    failedBatchDetails: Array.isArray(payload.failedBatchDetails) ? payload.failedBatchDetails.slice(0, 20) : [],
    externalSourceIssues: Array.isArray(payload.externalSourceIssues) ? payload.externalSourceIssues.slice(0, 20) : [],
    sourceCoverage: payload.sourceCoverage || null,
    quote_coverage_at_run: payload.quote_coverage_at_run || null,
    run_quality_at_publish: payload.run_quality_at_publish || null,
    alertReceipt: payload.alertReceipt || null,
  };
}

async function publishRealtimeRadarPayload(payload, previousPayload, writeBudget) {
  refreshRealtimeRadarEvidence(payload);
  const qualityBlocksLatest = payload?.run_quality_at_publish?.publishAllowed === false
    || payload?.run_quality_at_publish?.degradedBlocksLatest === true;
  const hasBlockingSourceIssue = cleanNumber(payload.failedBatchCount) > 0
    || qualityBlocksLatest;
  if (hasBlockingSourceIssue && canPreservePreviousGoodPayload(previousPayload, payload.date, Date.now())) {
    const reason = `preserved previous good latest; rejected run ${payload.runId || ""} stale=${cleanNumber(payload.staleQuoteCount)} failed=${cleanNumber(payload.failedBatchCount)}/${cleanNumber(payload.totalBatchCount) || "--"}`;
    payload.alertReceipt = await maybeSendRealtimeRadarAlert({
      ...payload,
      status: "degraded_preserved_latest",
      publishBlocked: true,
      preserveReason: reason,
    });
    refreshRealtimeRadarEvidence(payload);
    const preservedPayload = {
      ...previousPayload,
      preservedLatest: true,
      publishBlocked: true,
      preserveReason: reason,
      lastRejectedScan: rejectedScanSummary(payload),
      writeBudget: writeBudgetSnapshot(writeBudget, "preserved"),
    };
    writeJson(OUT_FILE, preservedPayload);
    updateSupabaseUploadStatus(false, reason);
    console.log(`realtime radar ${payload.timestamp}: ${reason}`);
    return preservedPayload;
  }

  payload.alertReceipt = await maybeSendRealtimeRadarAlert(payload);
  refreshRealtimeRadarEvidence(payload);
  writeJson(OUT_FILE, payload);
  const supabaseUpload = await safeUploadRealtimeRadarPayload(payload, writeBudget);
  const uploadedPayload = { ...payload, supabaseUpload };
  writeJson(OUT_FILE, uploadedPayload);
  return uploadedPayload;
}

function taipeiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function dateKey(parts = taipeiParts()) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function timestampKey(parts = taipeiParts()) {
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function secondsOfDay(value) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}

function quoteAgeSeconds(scanTimestamp, quoteTime) {
  const scanSeconds = secondsOfDay(scanTimestamp);
  const quoteSeconds = secondsOfDay(quoteTime);
  if (scanSeconds == null || quoteSeconds == null) return null;
  return Math.abs(scanSeconds - quoteSeconds);
}

function quoteSnapshotAgeSeconds(scanTimestamp, stock) {
  const timestamp = stock?.quoteSeenAt || stock?.sourceUpdatedAt || stock?.updatedAt || stock?.latestSeenAt || "";
  const parsed = Date.parse(timestamp);
  if (Number.isFinite(parsed)) {
    return Math.max(0, Math.round((Date.now() - parsed) / 1000));
  }
  const explicitRaw = stock?.sourceAgeSeconds ?? stock?.snapshotAgeSeconds;
  if (explicitRaw !== null && explicitRaw !== undefined && explicitRaw !== "") {
    return Math.max(0, cleanNumber(explicitRaw));
  }
  return quoteAgeSeconds(scanTimestamp, stock?.quoteTime || stock?.time);
}

function isFutureQuoteTime(scanTimestamp, quoteTime, toleranceSeconds = 90) {
  const scanSeconds = secondsOfDay(scanTimestamp);
  const quoteSeconds = secondsOfDay(quoteTime);
  if (scanSeconds == null || quoteSeconds == null) return false;
  return quoteSeconds > scanSeconds + toleranceSeconds;
}

function hasFreshQuote(stock) {
  return stock?.isRealtime === true && cleanNumber(stock.close) > 0;
}

function hasFreshLastTrade(stock, scanTimestamp) {
  const age = quoteAgeSeconds(scanTimestamp, stock.quoteTime || stock.time);
  return age != null && age <= MAX_QUOTE_AGE_SECONDS;
}

function finiteQuoteAges(stocks = [], scanTimestamp = "") {
  return stocks
    .filter((stock) => hasFreshQuote(stock))
    .map((stock) => quoteSnapshotAgeSeconds(scanTimestamp, stock))
    .filter((age) => Number.isFinite(age));
}

function buildQuoteCoverageAtRun({
  liveStocks = [],
  scanTimestamp = "",
  failedBatchCount = 0,
  staleQuoteCount = 0,
} = {}) {
  const activeSymbols = liveStocks.filter((stock) => stock?.code).length;
  const realtimeStocks = liveStocks.filter((stock) => hasFreshQuote(stock));
  const quoteAges = finiteQuoteAges(liveStocks, scanTimestamp);
  const freshQuotes = realtimeStocks.filter((stock) => {
    const age = quoteSnapshotAgeSeconds(scanTimestamp, stock);
    return Number.isFinite(age) && age <= REALTIME_RADAR_FRESH_QUOTE_SECONDS;
  }).length;
  const maxQuoteAgeSeconds = quoteAges.length ? Math.max(...quoteAges) : null;
  const freshQuoteCoverage120s = activeSymbols ? freshQuotes / activeSymbols : 0;
  const coverageReady = Boolean(
    activeSymbols > 0
    && freshQuoteCoverage120s >= REALTIME_RADAR_MIN_FRESH_QUOTE_COVERAGE
    && (maxQuoteAgeSeconds === null || maxQuoteAgeSeconds <= REALTIME_RADAR_FRESH_QUOTE_SECONDS)
  );
  const ready = Boolean(coverageReady && cleanNumber(failedBatchCount) === 0);
  return {
    status: ready ? "ready" : "degraded",
    ok: ready,
    ready,
    reason: ready
      ? (cleanNumber(staleQuoteCount) > 0 ? "fresh_quote_coverage_120s_ready_with_residual_stale_disclosed" : "fresh_quote_coverage_120s_ready")
      : "fresh_quote_coverage_120s_below_threshold_or_stale",
    fresh_quote_coverage_120s: Number(freshQuoteCoverage120s.toFixed(4)),
    freshQuoteCoverage120s: Number(freshQuoteCoverage120s.toFixed(4)),
    fresh_quotes: freshQuotes,
    freshQuotes,
    active_symbols: activeSymbols,
    activeSymbols,
    quote_age_seconds: maxQuoteAgeSeconds,
    quoteAgeSeconds: maxQuoteAgeSeconds,
    maxAllowedQuoteAgeSeconds: REALTIME_RADAR_FRESH_QUOTE_SECONDS,
    minFreshQuoteCoverage120s: REALTIME_RADAR_MIN_FRESH_QUOTE_COVERAGE,
    staleQuoteCount: cleanNumber(staleQuoteCount),
    staleQuoteBlocking: cleanNumber(staleQuoteCount) > 0 && !coverageReady,
    failedBatchCount: cleanNumber(failedBatchCount),
    checkedAt: new Date().toISOString(),
  };
}

function radarRequiredFieldValue(row, field) {
  if (field === "signalTags") return Array.isArray(row.signalTags) ? row.signalTags : row.tags;
  if (field === "time") return row.firstSignalTime || row.time || row.quoteTime || row.lastSignalTime;
  if (field === "volume") return row.volume || row.tradeVolume;
  if (field === "percent") return row.percent ?? row.pct;
  return row[field];
}

function isRadarFieldBlank(field, value) {
  if (Array.isArray(value)) return value.length === 0;
  if (value === null || value === undefined || value === "") return true;
  if (["close", "value", "volume", "score"].includes(field)) return cleanNumber(value) <= 0;
  return false;
}

function buildRadarFieldCompleteness(rows = []) {
  const fields = [...new Set(Object.values(REQUIRED_RADAR_FIELDS).flat())];
  const blankCounts = Object.fromEntries(fields.map((field) => [field, 0]));
  const sampleMissingRows = [];
  for (const row of rows) {
    const missing = fields.filter((field) => isRadarFieldBlank(field, radarRequiredFieldValue(row, field)));
    for (const field of missing) blankCounts[field] += 1;
    if (missing.length && sampleMissingRows.length < 10) {
      sampleMissingRows.push({
        code: row.code || "",
        name: row.name || "",
        missing,
        time: row.firstSignalTime || row.time || row.quoteTime || "",
      });
    }
  }
  const blankTotal = Object.values(blankCounts).reduce((sum, value) => sum + value, 0);
  return {
    requiredFields: REQUIRED_RADAR_FIELDS,
    blankCounts,
    blankTotal,
    sampleMissingRows,
  };
}

function realtimeRadarNotRequired(reason) {
  return { status: "not_required", ok: true, reason };
}

function refreshRealtimeRadarEvidence(payload, options = {}) {
  if (!payload || typeof payload !== "object") return payload;
  const quoteCoverage = options.quoteCoverage || payload.quote_coverage_at_run || payload.quoteCoverageAtRun || payload.sourceCoverage || {};
  const fieldCompleteness = options.fieldCompleteness || {
    requiredFields: payload.requiredFields || REQUIRED_RADAR_FIELDS,
    blankCounts: payload.blankCounts || {},
    blankTotal: cleanNumber(payload.blankTotal),
    sampleMissingRows: Array.isArray(payload.sampleMissingRows) ? payload.sampleMissingRows : [],
  };
  const writeBudget = options.writeBudget || payload.writeBudget || null;
  const fallbackUsed = payload.fallbackUsed === true;
  const budgetFinalStatus = String(writeBudget?.finalStatus || writeBudget?.status || "").toLowerCase();
  const quoteCoverageReady = quoteCoverageMeetsRealtimeThresholds(quoteCoverage);
  const publishAllowed = Boolean(
    quoteCoverageReady
    && cleanNumber(payload.failedBatchCount) === 0
    && cleanNumber(fieldCompleteness.blankTotal) === 0
    && fallbackUsed === false
    && !(writeBudget?.blocked === true)
    && !["failed", "blocked"].includes(budgetFinalStatus)
  );
  const snapshotFields = buildRunTimeSourceSnapshotFields({
    strategy: "realtime-radar",
    runId: payload.runId,
    payload,
    capturedAt: payload.updatedAt || new Date().toISOString(),
    startedAt: payload.startedAt || payload.updatedAt || "",
    finishedAt: payload.updatedAt || "",
    sourceStatus: {
      ...quoteCoverage,
      status: publishAllowed ? "ready" : quoteCoverage.status || "degraded",
      ok: publishAllowed,
      ready: publishAllowed,
      residualStaleQuoteCount: cleanNumber(payload.staleQuoteCount),
    },
    quoteCoverage,
    intraday1mReadiness: realtimeRadarNotRequired("realtime radar does not require intraday 1m"),
    maReadiness: realtimeRadarNotRequired("realtime radar does not require MA readiness"),
    preopenFutoptDailyReadiness: realtimeRadarNotRequired("realtime radar does not require preopen/futopt/daily readiness"),
    expectedTotal: options.expectedTotal ?? payload.active_symbols ?? payload.totalCount ?? payload.count,
    scannedCount: options.scannedCount ?? payload.active_symbols ?? payload.totalCount ?? payload.count,
    resultCount: Array.isArray(payload.rows) ? payload.rows.length : payload.count,
    readbackCount: Array.isArray(payload.rows) ? payload.rows.length : payload.count,
    publishAllowed,
    degradedBlocksLatest: !publishAllowed,
    preservePreviousGood: !publishAllowed,
    fallbackUsed,
    fallbackScope: Array.isArray(payload.fallbackScope) ? payload.fallbackScope : [],
    fallbackAllowed: fallbackUsed === false,
    fallbackDetails: Array.isArray(payload.fallbackDetails) ? payload.fallbackDetails : [],
    writeBudget,
    retentionOk: payload.retentionOk !== false,
    qualityStatus: publishAllowed ? "ready" : "degraded",
  });
  const alertReceipt = payload.alertReceipt || noAlertReceipt();
  Object.assign(payload, snapshotFields, {
    sourceCoverage: quoteCoverage,
    quote_coverage_at_run: snapshotFields.quote_coverage_at_run,
    fresh_quote_coverage_120s: quoteCoverage.fresh_quote_coverage_120s,
    fresh_quotes: quoteCoverage.fresh_quotes,
    active_symbols: quoteCoverage.active_symbols,
    quote_age_seconds: quoteCoverage.quote_age_seconds,
    requiredFields: fieldCompleteness.requiredFields,
    blankCounts: fieldCompleteness.blankCounts,
    blankTotal: fieldCompleteness.blankTotal,
    sampleMissingRows: fieldCompleteness.sampleMissingRows,
    rawKeepDays: REALTIME_RADAR_RAW_KEEP_DAYS,
    retentionOk: payload.retentionOk !== false,
    alertReceipt,
  });
  payload.run_quality_at_publish = {
    ...(payload.run_quality_at_publish || {}),
    requiredFields: fieldCompleteness.requiredFields,
    blankCounts: fieldCompleteness.blankCounts,
    blankTotal: fieldCompleteness.blankTotal,
    sampleMissingRows: fieldCompleteness.sampleMissingRows,
    rawKeepDays: REALTIME_RADAR_RAW_KEEP_DAYS,
    alertReceipt,
    writeBudget,
  };
  if (payload.runTimeSourceSnapshot) payload.runTimeSourceSnapshot.run_quality_at_publish = payload.run_quality_at_publish;
  if (payload.run_time_source_snapshot) payload.run_time_source_snapshot.run_quality_at_publish = payload.run_quality_at_publish;
  return payload;
}

function attachRealtimeRadarRunEvidence(payload, {
  liveStocks = [],
  scanTimestamp = "",
  writeBudget = null,
} = {}) {
  if (!payload || typeof payload !== "object") return payload;
  const quoteCoverage = buildQuoteCoverageAtRun({
    liveStocks,
    scanTimestamp,
    failedBatchCount: payload.failedBatchCount,
    staleQuoteCount: payload.staleQuoteCount,
  });
  const fieldCompleteness = buildRadarFieldCompleteness(Array.isArray(payload.rows) ? payload.rows : []);
  payload.quoteCoverageAtRun = quoteCoverage;
  payload.quote_coverage_at_run = quoteCoverage;
  payload.sourceCoverage = quoteCoverage;
  payload.fresh_quote_coverage_120s = quoteCoverage.fresh_quote_coverage_120s;
  payload.fresh_quotes = quoteCoverage.fresh_quotes;
  payload.active_symbols = quoteCoverage.active_symbols;
  payload.quote_age_seconds = quoteCoverage.quote_age_seconds;
  payload.requiredFields = fieldCompleteness.requiredFields;
  payload.blankCounts = fieldCompleteness.blankCounts;
  payload.blankTotal = fieldCompleteness.blankTotal;
  payload.sampleMissingRows = fieldCompleteness.sampleMissingRows;
  payload.rawKeepDays = REALTIME_RADAR_RAW_KEEP_DAYS;
  payload.retentionOk = true;
  payload.alertReceipt = payload.alertReceipt || noAlertReceipt();
  return refreshRealtimeRadarEvidence(payload, {
    quoteCoverage,
    fieldCompleteness,
    writeBudget: writeBudget || payload.writeBudget,
    expectedTotal: quoteCoverage.active_symbols,
    scannedCount: liveStocks.length,
  });
}

function chunkStocks(stocks = [], size = REALTIME_RESCAN_BATCH_SIZE) {
  const chunks = [];
  for (let index = 0; index < stocks.length; index += size) {
    const batchStocks = stocks.slice(index, index + size);
    chunks.push({ stocks: batchStocks, codes: batchStocks.map((stock) => stock.code).filter(Boolean) });
  }
  return chunks.filter((batch) => batch.codes.length);
}

function isMarketTime(parts = taipeiParts()) {
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= MARKET_START_MINUTES && minutes <= MARKET_END_MINUTES;
}

function isRealtimeRadarSourceCandidate(stock) {
  const code = String(stock?.code || "");
  return isIntradayTradable(stock) && !REALTIME_RADAR_EXCLUDED_CODES.has(code);
}

async function fetchJson(url, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "FumanRealtimeRadarCache/1.0" } });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError" || /aborted/i.test(String(error?.message || ""))) {
      throw new Error(`timeout ${timeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function localRealtimeApiHandler() {
  if (!localRealtimeApiHandler.instance) {
    localRealtimeApiHandler.instance = require("../api/realtime");
  }
  return localRealtimeApiHandler.instance;
}

async function fetchLocalRealtimeBatch(codes = []) {
  const handler = localRealtimeApiHandler();
  return await new Promise((resolve, reject) => {
    const request = {
      method: "GET",
      query: { codes: codes.join(",") },
      url: `/api/realtime?codes=${encodeURIComponent(codes.join(","))}`,
    };
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) {
        this.headers[key] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        if (this.statusCode >= 400 || payload?.ok === false) {
          reject(new Error(payload?.error || `local realtime API HTTP ${this.statusCode}`));
          return;
        }
        resolve(payload);
      },
      end() {
        resolve({});
      },
    };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt = 0) {
  return REALTIME_BATCH_RETRY_DELAY_MS * Math.max(1, attempt + 1);
}

async function fetchRealtimeBatch(codes = [], timeout = REALTIME_BATCH_TIMEOUT_MS) {
  if (USE_LOCAL_REALTIME_API) return fetchLocalRealtimeBatch(codes);
  return fetchJson(`${BASE_URL}/api/realtime?codes=${encodeURIComponent(codes.join(","))}&t=${Date.now()}`, timeout);
}

async function fetchStocks() {
  try {
    const market = await fetchJson(`${BASE_URL}/api/market?t=${Date.now()}`, 30000);
    if (Array.isArray(market?.stocks) && market.stocks.length) {
      return market.stocks.map((stock) => ({
        code: String(stock.code || ""),
        name: String(stock.name || ""),
        stock_type: stock.stock_type ?? stock.stockType,
        industry: stock.industry || stock.officialIndustry || stock.primaryIndustry || "",
        officialIndustry: stock.officialIndustry || "",
        primaryIndustry: stock.primaryIndustry || "",
        is_active: stock.is_active ?? stock.isActive,
        is_etf: stock.is_etf ?? stock.isEtf,
        is_warrant: stock.is_warrant ?? stock.isWarrant,
        is_cb: stock.is_cb ?? stock.isCb,
        is_blacklisted: stock.is_blacklisted ?? stock.isBlacklisted,
        is_daytrade_unsuitable: stock.is_daytrade_unsuitable ?? stock.isDaytradeUnsuitable,
        is_halted: stock.is_halted ?? stock.isHalted,
        is_trial: stock.is_trial ?? stock.isTrial,
        avg_volume_5: stock.avg_volume_5 ?? stock.avgVolume5,
        cumulative_bid_ask_volume: stock.cumulative_bid_ask_volume ?? stock.cumulativeBidAskVolume,
        cumulative_bid_volume: stock.cumulative_bid_volume ?? stock.cumulativeBidVolume,
        cumulative_ask_volume: stock.cumulative_ask_volume ?? stock.cumulativeAskVolume,
        close: cleanNumber(stock.close),
        change: cleanNumber(stock.change),
        percent: cleanNumber(stock.pct ?? stock.percent),
        value: cleanNumber(stock.value),
        tradeVolume: cleanNumber(stock.volume ?? stock.tradeVolume),
      })).filter((stock) => stock.code && stock.name && isRealtimeRadarSourceCandidate(stock));
    }
  } catch {}

  const payload = await fetchJson("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL", 30000);
  return payload.map((stock) => {
    const close = cleanNumber(stock.ClosingPrice || stock["收盤價"]);
    const change = cleanNumber(stock.Change || stock["漲跌價差"]);
    const prevClose = close - change;
    return {
      code: String(stock.Code || stock["證券代號"] || ""),
      name: String(stock.Name || stock["證券名稱"] || ""),
      close,
      change,
      percent: prevClose ? (change / prevClose) * 100 : 0,
      value: cleanNumber(stock.TradeValue || stock["成交金額"]),
      tradeVolume: cleanNumber(stock.TradeVolume || stock["成交股數"]),
    };
  }).filter((stock) => stock.code && stock.name && stock.close && isRealtimeRadarSourceCandidate(stock));
}

async function runWithConcurrency(items, limit, worker) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
}
async function fetchRealtime(stocks, scanTimestamp = "") {
  const quotes = new Map();
  const batchSize = REALTIME_BATCH_SIZE;
  const failedBatches = [];
  const apiErrors = [];
  const fallbackRecovered = { fugle: 0, finmind: 0, twseMis: 0, yahoo: 0 };
  const sourceAttempts = [];
  const batches = [];
  for (let i = 0; i < stocks.length; i += batchSize) {
    const batchStocks = stocks.slice(i, i + batchSize);
    const codes = batchStocks.map((stock) => stock.code);
    if (!codes.length) continue;
    batches.push({
      batchIndex: batches.length + 1,
      batchStocks,
      codes,
    });
  }
  await runWithConcurrency(batches, REALTIME_BATCH_CONCURRENCY, async ({ batchStocks, codes, batchIndex }) => {
    let lastError = null;
    try {
      let payload = null;
      for (let attempt = 0; attempt <= REALTIME_BATCH_RETRIES; attempt += 1) {
        try {
          payload = await fetchRealtimeBatch(codes, REALTIME_BATCH_TIMEOUT_MS + attempt * 3000);
          break;
        } catch (error) {
          lastError = error;
          if (attempt >= REALTIME_BATCH_RETRIES) throw error;
          await sleep(retryDelayMs(attempt));
        }
      }
      (payload.quotes || []).forEach((quote) => quotes.set(quote.code, quote));
      (payload.errors || []).forEach((error) => apiErrors.push({ ...error, parentBatch: batchIndex }));
      fallbackRecovered.fugle += Number(payload.fallbackRecovered?.fugle || 0);
      fallbackRecovered.finmind += Number(payload.fallbackRecovered?.finmind || 0);
      fallbackRecovered.twseMis += Number(payload.fallbackRecovered?.twseMis || 0);
      fallbackRecovered.yahoo += Number(payload.fallbackRecovered?.yahoo || 0);
      if (Array.isArray(payload.sourceAttempts)) {
        sourceAttempts.push(...payload.sourceAttempts.map((item) => ({ ...item, parentBatch: batchIndex })));
      }
    } catch (error) {
      failedBatches.push({
        batchIndex,
        startCode: codes[0],
        endCode: codes.at(-1),
        count: codes.length,
        codes,
        stocks: batchStocks,
        error: error.message || lastError?.message || "realtime batch failed",
      });
      console.log(`realtime batch deferred #${batchIndex} ${codes[0]}-${codes.at(-1)}: ${error.message}`);
    }
  });
  failedBatches.sort((a, b) => a.batchIndex - b.batchIndex);
  const batchByCode = new Map();
  for (const batch of batches) {
    for (const code of batch.codes) {
      batchByCode.set(code, { batchIndex: batch.batchIndex, startCode: batch.codes[0], endCode: batch.codes.at(-1) });
    }
  }
  const liveStocks = applyRealtimeQuotes(stocks, quotes, scanTimestamp).map((stock) => ({
    ...stock,
    realtimeBatch: batchByCode.get(stock.code) || null,
  }));
  const quoteSourceCounts = {};
  for (const stock of liveStocks) {
    if (!stock.isRealtime) continue;
    const source = stock.quoteSource || "unknown";
    quoteSourceCounts[source] = (quoteSourceCounts[source] || 0) + 1;
  }
  return { stocks: liveStocks, failedBatches, apiErrors, fallbackRecovered, quoteSourceCounts, sourceAttempts, totalBatches: batches.length, quoteCount: quotes.size };
}

function staleRescanPriority(stock) {
  const value = cleanNumber(stock.value);
  const volume = cleanNumber(stock.tradeVolume);
  const percent = Math.abs(cleanNumber(stock.percent));
  const change = Math.abs(cleanNumber(stock.change));
  return value / 1000000 + volume / 100 + percent * 8 + change * 3;
}

function selectStaleStocksForRescan(staleStocks = []) {
  if (!REALTIME_STALE_RESCAN_LIMIT) return [];
  return [...staleStocks]
    .filter((stock) => stock?.code)
    .map((stock, index) => ({ stock, index, score: staleRescanPriority(stock) }))
    .sort((a, b) => b.score - a.score || a.index - b.index || String(a.stock.code || "").localeCompare(String(b.stock.code || "")))
    .map((item) => item.stock)
    .slice(0, REALTIME_STALE_RESCAN_LIMIT);
}

function normalizeRescanBatches(batches = []) {
  return batches.flatMap((batch) => {
    const stocks = Array.isArray(batch.stocks) ? batch.stocks : [];
    const chunks = chunkStocks(stocks, REALTIME_RESCAN_BATCH_SIZE);
    return chunks.map((chunk, index) => ({
      ...batch,
      ...chunk,
      reason: batch.reason || "retry",
      batchIndex: batch.batchIndex ? `${batch.batchIndex}.${index + 1}` : "",
      startCode: chunk.codes[0] || "",
      endCode: chunk.codes.at(-1) || "",
      count: chunk.codes.length,
    }));
  });
}

function applyRealtimeQuotes(stocks, quotes, scanTimestamp = "") {
  return stocks.map((stock) => {
    const quote = quotes.get(stock.code);
    if (!quote?.close) return stock;
    const quoteSeenAt = quote.quoteSeenAt || new Date().toISOString();
    if (isFutureQuoteTime(scanTimestamp, quote.time)) {
      return {
        ...stock,
        quoteTime: quote.time || stock.quoteTime || stock.time || "",
        quoteSeenAt,
        sourceUpdatedAt: quote.sourceUpdatedAt || quote.updatedAt || stock.sourceUpdatedAt || "",
        quoteSource: quote.quoteSource || quote.realtimeFallback || "api/realtime",
        rejectedQuoteReason: "future_quote_time",
        isRealtime: false,
      };
    }
    const volume = cleanNumber(quote.tradeVolume) || cleanNumber(stock.tradeVolume);
    const close = cleanNumber(quote.close) || cleanNumber(stock.close);
    return {
      ...stock,
      ...quote,
      name: String(stock.name || quote.name || stock.code || quote.code || ""),
      close,
      quoteTime: quote.time || "",
      quoteSeenAt,
      sourceUpdatedAt: quote.sourceUpdatedAt || quote.updatedAt || stock.sourceUpdatedAt || "",
      lastTradeTime: quote.lastTradeTime || stock.lastTradeTime || "",
      quoteSource: quote.quoteSource || quote.realtimeFallback || "api/realtime",
      tradeVolume: volume,
      value: volume && close ? volume * close * 1000 : cleanNumber(stock.value),
      isRealtime: true,
    };
  });
}

async function rescanRealtimeBatches(failedBatches = []) {
  const quotes = new Map();
  const stillFailedBatches = [];
  let recoveredBatches = 0;
  for (const batch of normalizeRescanBatches(failedBatches)) {
    const codes = batch.codes || [];
    if (!codes.length) continue;
    let lastError = null;
    try {
      let payload = null;
      for (let attempt = 0; attempt <= REALTIME_BATCH_RETRIES; attempt += 1) {
        try {
          await sleep(retryDelayMs(attempt));
          payload = await fetchRealtimeBatch(codes, Math.max(20000, REALTIME_BATCH_TIMEOUT_MS) + attempt * 3000);
          break;
        } catch (error) {
          lastError = error;
          if (attempt >= REALTIME_BATCH_RETRIES) throw error;
        }
      }
      (payload.quotes || []).forEach((quote) => quotes.set(quote.code, quote));
      recoveredBatches += 1;
    } catch (error) {
      stillFailedBatches.push(normalizeDeferredBatch({ ...batch, error: error.message || lastError?.message }, batch.reason || "retry_failed"));
      console.log(`realtime deferred batch failed ${codes[0]}-${codes.at(-1)}: ${error.message}`);
    }
  }
  return { quotes, recoveredBatches, failedBatches: stillFailedBatches };
}

function buildFailedBatchDetails(failedBatches = []) {
  return failedBatches.map((batch) => ({
    batchIndex: batch.batchIndex || "",
    range: batch.startCode && batch.endCode ? `${batch.startCode}-${batch.endCode}` : "",
    count: batch.count || (batch.codes || []).length,
    sampleCodes: (batch.codes || []).slice(0, 12).join(","),
    error: String(batch.error || "").slice(0, 240),
  }));
}

function httpStatusCounts(details = []) {
  const counts = {};
  for (const item of details) {
    const status = String(item.error || "").match(/HTTP\s+(\d{3})/i)?.[1] || "other";
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function buildExternalSourceIssues({ failedBatchDetails = [], staleQuoteDetails = [] } = {}) {
  const issues = [];
  const httpCounts = httpStatusCounts(failedBatchDetails);
  for (const [status, count] of Object.entries(httpCounts)) {
    issues.push({ source: "api/realtime", type: "http_error", status, count });
  }
  if (staleQuoteDetails.length) {
    issues.push({
      source: "api/realtime",
      type: "stale_quote",
      count: staleQuoteDetails.length,
      sampleCodes: staleQuoteDetails.slice(0, 12).map((item) => item.code).join(","),
    });
  }
  return issues;
}

function buildStaleQuoteDetails(staleStocks = [], scanTimestamp = "") {
  return staleStocks
    .map((stock) => {
      const batch = stock.realtimeBatch || {};
      const quoteTime = stock.quoteTime || stock.time || "";
      return {
        code: String(stock.code || ""),
        name: String(stock.name || ""),
        quoteTime,
        quoteAgeSeconds: quoteAgeSeconds(scanTimestamp, quoteTime),
        batchIndex: batch.batchIndex || "",
        batchRange: batch.startCode && batch.endCode ? `${batch.startCode}-${batch.endCode}` : "",
        close: cleanNumber(stock.close),
        percent: cleanNumber(stock.percent),
      };
    })
    .sort((a, b) => (Number(b.quoteAgeSeconds) || 0) - (Number(a.quoteAgeSeconds) || 0) || a.code.localeCompare(b.code))
    .slice(0, 80);
}

function staleQuoteLogText(staleQuoteDetails = [], staleQuoteCount = 0) {
  const count = Number(staleQuoteCount || 0);
  if (!count) return "stale 0";
  const sample = staleQuoteDetails
    .slice(0, 12)
    .map((item) => `${item.code}${item.quoteAgeSeconds ? `(${item.quoteAgeSeconds}s)` : ""}`)
    .join(",");
  return `stale ${count}${sample ? ` [${sample}]` : " [details empty]"}`;
}

function radarSignalTags(stock) {
  const tags = [];
  const pct = cleanNumber(stock.percent);
  const value = cleanNumber(stock.value);
  const volume = cleanNumber(stock.tradeVolume || stock.volume);
  const close = cleanNumber(stock.close);
  const open = cleanNumber(stock.open);
  const high = cleanNumber(stock.high);
  const low = cleanNumber(stock.low);
  const bodyPct = open ? ((close - open) / open) * 100 : 0;

  if (close && open && close > open && bodyPct >= 3) tags.push("長紅逾3%");
  if (close && open && close < open && bodyPct <= -1.5) tags.push("長黑轉弱");
  if (value >= 1000000000 || (volume >= 5000 && Math.abs(pct) >= 1.2)) tags.push("即時爆量");
  if (pct >= 3) tags.push("短線急拉");
  if (pct >= 1.5 && value >= 200000000) tags.push("短線強勢");
  if (pct <= -3) tags.push("急殺");
  if (pct <= -1.5 && value >= 200000000) tags.push("短線轉弱");
  if (high && close && close >= high * 0.985 && pct > 0) tags.push("逼近日高");
  if (low && close && close <= low * 1.015 && pct < 0) tags.push("貼近日低");
  return [...new Set(tags)];
}

function radarFlowValue(stock) {
  const value = cleanNumber(stock.value);
  const pct = Math.abs(cleanNumber(stock.percent));
  const tags = stock.signalTags?.length || 0;
  const volume = cleanNumber(stock.tradeVolume || stock.volume);
  const volumeBoost = volume >= 10000 ? 0.18 : volume >= 5000 ? 0.12 : 0.06;
  const signalBoost = Math.min(tags * 0.11, 0.46);
  const moveBoost = Math.min(pct / 9, 0.42);
  return value * (0.55 + signalBoost + moveBoost + volumeBoost);
}

function radarSignalScore(stock) {
  const pct = Math.abs(cleanNumber(stock.percent));
  const value = cleanNumber(stock.value);
  const volume = cleanNumber(stock.tradeVolume || stock.volume);
  const tagScore = (stock.signalTags?.length || 0) * 16;
  const moveScore = Math.min(pct * 7, 32);
  const valueScore = Math.min(Math.log10(Math.max(value, 1)) * 5, 46);
  const volumeScore = Math.min(Math.log10(Math.max(volume, 1)) * 5, 22);
  return Math.max(1, Math.min(100, Math.round(tagScore + moveScore + valueScore + volumeScore - 42)));
}

function buildRadarRows(stocks, detectedAt, scanTimestamp = "") {
  return stocks
    .filter(isIntradayTradable)
    .map((stock) => {
      const pct = cleanNumber(stock.percent);
      const close = cleanNumber(stock.close);
      const volume = cleanNumber(stock.tradeVolume || stock.volume);
      const value = cleanNumber(stock.value) || close * volume * 1000;
      const signalTags = radarSignalTags({ ...stock, percent: pct, value });
      const hasLongSignal =
        signalTags.some((tag) => /逼近|爆量|強勢|急拉|長紅/.test(tag)) ||
        pct >= 3 ||
        (pct >= 1.5 && value >= 200000000) ||
        (value >= 1000000000 && pct > 0) ||
        (volume >= 5000 && pct >= 1.2);
      const hasShortSignal =
        signalTags.some((tag) => /急殺|轉弱|長黑|貼近/.test(tag)) ||
        pct <= -3 ||
        (pct <= -1.5 && value >= 200000000) ||
        (value >= 1000000000 && pct < 0) ||
        (volume >= 5000 && pct <= -1.2);
      const side = hasLongSignal && (!hasShortSignal || pct >= 0) ? "long" : hasShortSignal ? "short" : "";
      const signalTime = stock.quoteTime || stock.time || String(scanTimestamp).match(/\d{1,2}:\d{2}(?::\d{2})?/)?.[0] || "";
      const row = {
        ...stock,
        pct,
        percent: pct,
        value,
        volume,
        side,
        trust: 0,
        foreign: 0,
        totalInst: 0,
        signalTags,
        detectedAt,
        firstSignalTime: stock.firstSignalTime || signalTime,
        lastSignalTime: signalTime,
        time: stock.firstSignalTime || signalTime,
        quoteTime: stock.quoteTime || stock.time || signalTime,
      };
      row.score = radarSignalScore(row);
      row.flow = radarFlowValue(row);
      return row;
    })
    .filter((stock) => stock.value > 0 && stock.side && stock.signalTags.length)
    .sort((a, b) => b.score - a.score || b.value - a.value);
}

function radarRowSessionSeconds(row) {
  return secondsOfDay(row?.firstSignalTime || row?.time || row?.quoteTime || row?.lastSignalTime);
}

function isSessionRadarRow(row, scanTimestamp = "") {
  const seconds = radarRowSessionSeconds(row);
  const rowTime = row?.firstSignalTime || row?.time || row?.quoteTime || row?.lastSignalTime || "";
  return (seconds == null || (seconds >= MARKET_START_SECONDS && seconds <= MARKET_END_SECONDS))
    && !isFutureQuoteTime(scanTimestamp, rowTime);
}

function radarRowKey(row) {
  const time = String(row?.firstSignalTime || row?.time || row?.quoteTime || "").match(/\d{1,2}:\d{2}/)?.[0] || "open";
  const tags = Array.isArray(row?.signalTags) ? row.signalTags : Array.isArray(row?.tags) ? row.tags : [];
  const signal = tags.slice(0, 3).join("/") || row?.signal || row?.reason || "";
  return [row?.code || "", row?.side || row?.state || "", signal, time].join("|");
}

function radarRowsSignature(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => [row?.code || "", row?.side || "", row?.firstSignalTime || row?.time || "", row?.score || "", row?.value || ""].join(":"))
    .join("|");
}

function mergeRadarSessionRows(previousPayload, currentRows, scanTimestamp, tradeDate) {
  const previousRows = previousPayload?.date === tradeDate && Array.isArray(previousPayload.rows)
    ? previousPayload.rows
    : [];
  const rowsByKey = new Map();
  const addRow = (row, preferLatest) => {
    if (!row || !row.code || !isSessionRadarRow(row, scanTimestamp)) return;
    const firstSignalTime = row.firstSignalTime || row.time || row.quoteTime || String(scanTimestamp).match(/\d{1,2}:\d{2}(?::\d{2})?/)?.[0] || "";
    const normalized = {
      ...row,
      firstSignalTime,
      lastSignalTime: row.lastSignalTime || row.quoteTime || row.time || firstSignalTime,
      time: firstSignalTime,
    };
    const key = radarRowKey(normalized);
    const existing = rowsByKey.get(key);
    if (!existing) {
      rowsByKey.set(key, normalized);
      return;
    }
    const keep = preferLatest ? normalized : existing;
    const firstSeconds = Math.min(radarRowSessionSeconds(existing) ?? Infinity, radarRowSessionSeconds(normalized) ?? Infinity);
    const firstTime = [existing.firstSignalTime || existing.time, normalized.firstSignalTime || normalized.time]
      .filter(Boolean)
      .sort((a, b) => (secondsOfDay(a) ?? firstSeconds) - (secondsOfDay(b) ?? firstSeconds))[0] || keep.firstSignalTime || keep.time;
    rowsByKey.set(key, {
      ...existing,
      ...keep,
      firstSignalTime: firstTime,
      lastSignalTime: normalized.lastSignalTime || existing.lastSignalTime || keep.quoteTime || keep.time,
      time: firstTime,
      score: Math.max(cleanNumber(existing.score), cleanNumber(normalized.score)),
      value: Math.max(cleanNumber(existing.value), cleanNumber(normalized.value)),
      flow: Math.max(cleanNumber(existing.flow), cleanNumber(normalized.flow)),
    });
  };
  previousRows.forEach((row) => addRow(row, false));
  currentRows.forEach((row) => addRow(row, true));
  return [...rowsByKey.values()]
    .filter((row) => isSessionRadarRow(row, scanTimestamp))
    .sort((a, b) => (radarRowSessionSeconds(b) ?? 0) - (radarRowSessionSeconds(a) ?? 0)
      || cleanNumber(b.score) - cleanNumber(a.score)
      || cleanNumber(b.value) - cleanNumber(a.value)
      || String(a.code).localeCompare(String(b.code), "zh-Hant"))
    .slice(0, REALTIME_RADAR_SESSION_LIMIT);
}

async function main() {
  const parts = taipeiParts();
  const key = dateKey(parts);
  const detectedAt = Date.now();
  const timestamp = timestampKey(parts);
  const runId = buildRealtimeRadarRunId(key, parts, detectedAt);
  const writeBudget = createWriteBudget(runId);
  persistWriteBudget(writeBudget, "open");
  const tradingDay = await isTwseTradingDay(new Date(detectedAt), { stateDir: STATE_DIR });
  if (!tradingDay.isTradingDay) {
    writeFailedBatchQueue([]);
    console.log(`realtime radar skipped non-trading day ${tradingDay.date} (${tradingDay.reason}, source=${tradingDay.source})`);
    return;
  }
  if (!isMarketTime(parts)) {
    writeFailedBatchQueue([]);
    console.log(`realtime radar skipped outside 09:00-13:30 detection window ${timestamp}; existing snapshot left unchanged`);
    return;
  }

  const rawStocks = await fetchStocks();
  const queuedBatches = hydrateQueuedBatches(readFailedBatchQueue(), rawStocks);
  const realtime = await fetchRealtime(rawStocks, timestamp);
  const liveStocks = realtime.stocks;
  let finalLiveStocks = liveStocks;
  const freshStocks = liveStocks.filter((stock) => hasFreshQuote(stock));
  const staleStocks = liveStocks.filter((stock) => !hasFreshQuote(stock));
  const lastTradeStaleStocks = freshStocks.filter((stock) => !hasFreshLastTrade(stock, timestamp));
  const staleQuoteCount = staleStocks.length;
  const lastTradeStaleCount = lastTradeStaleStocks.length;
  const staleQuoteDetails = buildStaleQuoteDetails(staleStocks, timestamp);
  const lastTradeStaleDetails = buildStaleQuoteDetails(lastTradeStaleStocks, timestamp);
  const failedBatchDetails = buildFailedBatchDetails(realtime.failedBatches);
  const externalSourceIssues = buildExternalSourceIssues({ failedBatchDetails, staleQuoteDetails });
  const previousPayload = readJson(OUT_FILE, null);
  const currentRows = buildRadarRows(freshStocks, detectedAt, timestamp);
  const rows = mergeRadarSessionRows(previousPayload, currentRows, timestamp, key);
  let payload = {
    runId,
    source: "mini-pc-realtime-radar",
    status: realtime.failedBatches.length ? "degraded" : "ok",
    date: key,
    timestamp,
    updatedAt: new Date(detectedAt).toISOString(),
    updatedAtMs: detectedAt,
    staleAfterMs: STALE_AFTER_MS,
    maxQuoteAgeSeconds: MAX_QUOTE_AGE_SECONDS,
    staleQuoteCount,
    lastTradeStaleCount,
    failedBatchCount: realtime.failedBatches.length,
    totalBatchCount: realtime.totalBatches,
    quoteCount: realtime.quoteCount,
    quoteSourceCounts: realtime.quoteSourceCounts,
    sourceAttempts: realtime.sourceAttempts,
    fallbackRecovered: realtime.fallbackRecovered,
    apiErrorDetails: realtime.apiErrors,
    staleQuoteDetails,
    lastTradeStaleDetails,
    failedBatchDetails,
    externalSourceIssues,
    rows,
    sessionStart: "09:00",
    sessionEnd: "13:30",
    sessionLimit: REALTIME_RADAR_SESSION_LIMIT,
    batchSize: REALTIME_BATCH_SIZE,
    batchConcurrency: REALTIME_BATCH_CONCURRENCY,
    batchTimeoutMs: REALTIME_BATCH_TIMEOUT_MS,
    batchRetries: REALTIME_BATCH_RETRIES,
    staleRescanLimit: REALTIME_STALE_RESCAN_LIMIT,
    sourceExcludedCodes: [...REALTIME_RADAR_EXCLUDED_CODES],
    currentScanCount: currentRows.length,
    longCount: rows.filter((row) => row.side === "long").length,
    shortCount: rows.filter((row) => row.side === "short").length,
    writeBudget: writeBudgetSnapshot(writeBudget, "open"),
  };
  if (!rows.length && realtime.failedBatches.length) {
    const previous = readJson(OUT_FILE, null);
    if (previous?.status !== "outside_market_time" && previous?.date === key && Array.isArray(previous.rows) && previous.rows.length) {
      payload = {
        ...previous,
        runId,
        status: "degraded_keepalive",
        timestamp,
        updatedAt: new Date(detectedAt).toISOString(),
        updatedAtMs: detectedAt,
        staleAfterMs: STALE_AFTER_MS,
        maxQuoteAgeSeconds: MAX_QUOTE_AGE_SECONDS,
        staleQuoteCount,
        lastTradeStaleCount,
        failedBatchCount: realtime.failedBatches.length,
        totalBatchCount: realtime.totalBatches,
        quoteCount: realtime.quoteCount,
        staleQuoteDetails,
        lastTradeStaleDetails,
        failedBatchDetails,
        externalSourceIssues,
        lastFailedScanAt: timestamp,
        writeBudget: writeBudgetSnapshot(writeBudget, "open"),
      };
      console.log(`realtime radar ${timestamp}: kept previous rows ${previous.rows.length} after ${realtime.failedBatches.length}/${realtime.totalBatches} failed batches`);
    }
  }
  const staleStocksForRescan = selectStaleStocksForRescan(staleStocks);
  const deferredBatches = [...queuedBatches, ...realtime.failedBatches, ...chunkStocks(staleStocksForRescan).map((batch) => ({ ...batch, reason: "stale_quote" }))];
  let deferredRetry = null;
  if (deferredBatches.length) {
    const retry = await rescanRealtimeBatches(deferredBatches);
    deferredRetry = retry;
    if (retry.quotes.size) {
      const retryStocks = applyRealtimeQuotes(deferredBatches.flatMap((batch) => batch.stocks || []), retry.quotes, timestamp)
        .filter((stock) => hasFreshQuote(stock));
      const retryRows = buildRadarRows(retryStocks, detectedAt, timestamp);
      const mergedRows = mergeRadarSessionRows(payload, retryRows, timestamp, key);
      if (retryStocks.length || mergedRows.length > payload.rows.length || radarRowsSignature(mergedRows) !== radarRowsSignature(payload.rows)) {
        const retryFreshCodes = new Set(retryStocks.map((stock) => String(stock.code || "")).filter(Boolean));
        const remainingStaleStocks = staleStocks.filter((stock) => !retryFreshCodes.has(String(stock.code || "")));
        const retryLiveStocksByCode = new Map(liveStocks.map((stock) => [String(stock.code || ""), stock]));
        for (const retryStock of retryStocks) retryLiveStocksByCode.set(String(retryStock.code || ""), retryStock);
        finalLiveStocks = [...retryLiveStocksByCode.values()];
        const patchedFreshStocks = [...retryLiveStocksByCode.values()].filter((stock) => hasFreshQuote(stock));
        const patchedLastTradeStaleStocks = patchedFreshStocks.filter((stock) => !hasFreshLastTrade(stock, timestamp));
        const patchedStaleQuoteDetails = buildStaleQuoteDetails(remainingStaleStocks, timestamp);
        const patchedLastTradeStaleDetails = buildStaleQuoteDetails(patchedLastTradeStaleStocks, timestamp);
        const patchedFailedBatchDetails = buildFailedBatchDetails(retry.failedBatches || []);
        const patchedPayload = {
          ...payload,
          runId,
          status: "ok_after_deferred_rescan",
          rows: mergedRows,
          longCount: mergedRows.filter((row) => row.side === "long").length,
          shortCount: mergedRows.filter((row) => row.side === "short").length,
          recoveredBatchCount: retry.recoveredBatches,
          staleRescanCount: staleStocksForRescan.length,
          staleQuoteCount: remainingStaleStocks.length,
          lastTradeStaleCount: patchedLastTradeStaleStocks.length,
          staleQuoteDetails: patchedStaleQuoteDetails,
          lastTradeStaleDetails: patchedLastTradeStaleDetails,
          failedBatchDetails: patchedFailedBatchDetails,
          externalSourceIssues: buildExternalSourceIssues({ failedBatchDetails: patchedFailedBatchDetails, staleQuoteDetails: patchedStaleQuoteDetails }),
          writeBudget: writeBudgetSnapshot(writeBudget, "open"),
        };
        payload = patchedPayload;
        console.log(`realtime radar ${timestamp}: deferred rescan merged rows ${mergedRows.length} ${staleQuoteLogText(patchedPayload.staleQuoteDetails, patchedPayload.staleQuoteCount)} lastTradeStale ${patchedPayload.lastTradeStaleCount || 0} recovered ${retry.recoveredBatches}/${deferredBatches.length}`);
      }
    }
  }
  attachRealtimeRadarRunEvidence(payload, {
    liveStocks: finalLiveStocks,
    scanTimestamp: timestamp,
    writeBudget: payload.writeBudget || writeBudgetSnapshot(writeBudget, "open"),
  });
  payload = await publishRealtimeRadarPayload(payload, previousPayload, writeBudget);
  console.log(`realtime radar ${timestamp}: rows ${payload.rows.length} status ${payload.status} ${staleQuoteLogText(payload.staleQuoteDetails, payload.staleQuoteCount)} lastTradeStale ${payload.lastTradeStaleCount || 0} failed ${realtime.failedBatches.length}/${realtime.totalBatches}`);
  writeFailedBatchQueue(deferredRetry ? deferredRetry.failedBatches || [] : realtime.failedBatches || []);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});




