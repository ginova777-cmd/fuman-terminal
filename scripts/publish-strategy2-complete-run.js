const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { publishStrategyCacheStatus } = require("../lib/strategy-cache-status");
const { upsertSnapshot } = require("../lib/supabase-snapshots");
const { assertStrategy2SourcePublishGate } = require("../lib/strategy2-source-publish-gate");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const DATA_DIR = process.env.FUMAN_DATA_DIR || path.join(RUNTIME_DIR, "data");
const STRATEGY2_SNAPSHOT_KEY = process.env.STRATEGY2_SUPABASE_SNAPSHOT_KEY || "strategy2_latest_snapshot";
const STRATEGY2_SOURCE_GATE_ALERT_RECEIPT = process.env.STRATEGY2_SOURCE_GATE_ALERT_RECEIPT
  || path.join(DATA_DIR, "scan-receipts", "strategy2-source-publish-gate-alert.json");
const LOCAL_COMPLETE_RUN_FILE = process.env.STRATEGY2_COMPLETE_RUN_SOURCE_FILE
  || path.join(DATA_DIR, `${["strategy2", "intraday", "latest"].join("-")}.json`);

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function getTaipeiParts(value) {
  const date = new Date(value || Date.now());
  const safeDate = Number.isFinite(date.getTime()) ? date : new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(safeDate).map((part) => [part.type, part.value]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === "24" ? "00" : parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function normalizeScanDate(value, fallbackTime) {
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const digits = text.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  const parts = getTaipeiParts(fallbackTime);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function buildCompleteRunPayload(report) {
  const qualityStatus = report.qualityStatus
    || (report.realtime?.entrySourceHealthy === false || report.realtime?.skippedPartialCoverage ? "degraded" : "ok");
  const dedupeRows = (rows, kind) => {
    const seen = new Set();
    return (Array.isArray(rows) ? rows : []).filter((row) => {
      if (!row || typeof row !== "object") return false;
      const key = [
        kind,
        row.code || row.symbol || "",
        row.rowKind || row.row_kind || row.stateId || row.state_id || "",
        row.signalId || row.signal_id || row.primaryStrategy || "",
        row.entryAt || row.timestamp || row.time || row.latestSeenAt || "",
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  return {
    ...report,
    events: dedupeRows(report.events, "event"),
    records: dedupeRows(report.records, "record"),
    entryCount: cleanNumber(report.entryCount || report.aCount),
    qualityStatus,
    schemaVersion: report.schemaVersion || "strategy2-run-id-complete-v1",
    dataContractSource: report.dataContractSource || "supabase:strategy2_intraday_ready_cache",
  };
}

function buildCompleteRunId(report) {
  const scanDate = normalizeScanDate(report.date, report.updatedAt || report.generatedAt || Date.now());
  const parts = getTaipeiParts(report.updatedAt || report.generatedAt || Date.now());
  return `strategy2-${scanDate.replace(/\D/g, "")}-${parts.hour}${parts.minute}${parts.second}`;
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function secondsOfDay(value) {
  const match = String(value || "").match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
  if (!match) return -1;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}

function validateFullWindowReplayReport(report) {
  const issues = [];
  const source = String(report?.source || "");
  const dataContractSource = String(report?.dataContractSource || "");
  const schemaVersion = String(report?.schemaVersion || "");
  const records = Array.isArray(report?.records) ? report.records : [];
  const events = Array.isArray(report?.events) ? report.events : [];
  const replay = report?.replay && typeof report.replay === "object" ? report.replay : {};
  const coverage = cleanNumber(report?.realtime?.coverage);
  const firstRecordAt = String(report?.scanWindow?.firstRecordAt || "");
  const lastRecordAt = String(report?.scanWindow?.lastRecordAt || "");
  if (source !== "strategy2-0845-1200-supabase-1m-full-replay") issues.push(`source=${source || "missing"}`);
  if (dataContractSource !== "supabase:intraday_1m_full_replay") issues.push(`dataContractSource=${dataContractSource || "missing"}`);
  if (schemaVersion !== "strategy2-run-id-complete-v1") issues.push(`schemaVersion=${schemaVersion || "missing"}`);
  if (report?.complete !== true) issues.push("complete!=true");
  if (report?.ok === false) issues.push("ok=false");
  if (records.length <= 0) issues.push("records=0");
  if (events.length <= 0) issues.push("events=0");
  if (replay.ok !== true) issues.push("replay.ok!=true");
  if (cleanNumber(replay.candleCodes) <= 0) issues.push("replay.candleCodes=0");
  if (coverage < 0.95) issues.push(`realtime.coverage ${coverage.toFixed(4)} < 0.95`);
  if (secondsOfDay(firstRecordAt) < secondsOfDay("08:45:00")) issues.push(`firstRecordAt=${firstRecordAt || "missing"}`);
  if (secondsOfDay(lastRecordAt) < secondsOfDay("09:00:00") || secondsOfDay(lastRecordAt) > secondsOfDay("12:00:00")) {
    issues.push(`lastRecordAt=${lastRecordAt || "missing"}`);
  }
  return {
    ok: issues.length === 0,
    issues,
    detail: {
      source,
      dataContractSource,
      schemaVersion,
      records: records.length,
      events: events.length,
      coverage,
      replay,
      firstRecordAt,
      lastRecordAt,
    },
  };
}

function readValidatedFullWindowReplayReport() {
  const report = readJsonFile(LOCAL_COMPLETE_RUN_FILE);
  if (!report) return { ok: false, reason: `missing local complete-run file ${LOCAL_COMPLETE_RUN_FILE}` };
  const validation = validateFullWindowReplayReport(report);
  return {
    ...validation,
    sourceFile: LOCAL_COMPLETE_RUN_FILE,
    payload: report,
    reason: validation.ok ? "full-window replay source gate ok" : validation.issues.join("; "),
  };
}

function supabaseConfig() {
  const supabaseUrl = String(
    process.env.SUPABASE_URL
    || process.env.FUMAN_SUPABASE_URL
    || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-url.txt"))
    || readSecretText(path.join(ROOT, "secrets", "supabase-url.txt"))
    || "https://cpmpfhbzutkiecccekfr.supabase.co"
  ).replace(/\/+$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
    || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-service-role-key.txt"))
    || readSecretText(path.join(ROOT, "secrets", "supabase-service-role-key.txt"));
  const anonKey = process.env.SUPABASE_ANON_KEY
    || process.env.FUMAN_SUPABASE_ANON_KEY
    || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-anon-key.txt"))
    || readSecretText(path.join(ROOT, "secrets", "supabase-anon-key.txt"));
  return { supabaseUrl, serviceKey, publishKey: serviceKey || anonKey };
}

async function fetchSupabaseJson(url, key) {
  const timeoutMs = Math.max(15000, Number(process.env.STRATEGY2_COMPLETE_RUN_PUBLISH_TIMEOUT_MS || 90000));
  const response = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${text.slice(0, 180)}`.trim());
  }
  return response.json();
}

async function readLatestReportFromSupabase(config) {
  const rows = await fetchSupabaseJson(
    `${config.supabaseUrl}/rest/v1/strategy2_latest?id=eq.latest&select=payload,updated_at,date,entry_count`,
    config.publishKey
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : null;
  if (!payload) throw new Error("missing Supabase strategy2_latest payload");
  return {
    source: "supabase:strategy2_latest",
    payload: {
      ...payload,
      updatedAt: payload.updatedAt || row.updated_at,
      date: payload.date || row.date,
      entryCount: payload.entryCount || row.entry_count,
    },
  };
}

async function postJson(url, key, body, prefer) {
  const timeoutMs = Math.max(15000, Number(process.env.STRATEGY2_COMPLETE_RUN_PUBLISH_TIMEOUT_MS || 90000));
  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${text.slice(0, 180)}`);
  }
}

function writeStrategy2Receipt(report, runId, scanDate, source) {
  const receiptDir = path.join(DATA_DIR, "scan-receipts");
  fs.mkdirSync(receiptDir, { recursive: true });
  const matches = cleanNumber(report.entryCount || report.aCount || (Array.isArray(report.events) ? report.events.length : 0) || (Array.isArray(report.records) ? report.records.length : 0));
  const now = new Date().toISOString();
  const receipt = {
    strategy: "strategy2",
    label: "strategy2 intraday complete-run publisher",
    tier: "critical",
    startedAt: report.startedAt || report.generatedAt || report.updatedAt || now,
    finishedAt: now,
    status: report.ok === false ? "failed" : "complete",
    exitCode: report.ok === false ? 1 : 0,
    scanned: Array.isArray(report.records) ? report.records.length : 0,
    total: Array.isArray(report.records) ? report.records.length : 0,
    matches,
    complete: report.ok !== false,
    qualityStatus: report.qualityStatus || "complete",
    fallback: false,
    preservedLatest: false,
    publishBlocked: false,
    runId,
    marketDate: String(scanDate || "").replace(/\D/g, ""),
    updatedAt: report.updatedAt || report.generatedAt || now,
    payloadPath: "supabase:strategy2_latest",
    source: source || "supabase:strategy2_latest",
    warnings: [],
    blockingReason: "",
    log: "run_id=" + runId + "; source=" + (source || "supabase:strategy2_latest"),
  };
  fs.writeFileSync(path.join(receiptDir, "strategy2.json"), JSON.stringify(receipt, null, 2) + "\n", "utf8");
  return receipt;
}

function writeStrategy2BlockedReceipt(gate, error) {
  const receiptDir = path.join(DATA_DIR, "scan-receipts");
  fs.mkdirSync(receiptDir, { recursive: true });
  const now = new Date().toISOString();
  const latestRunId = gate?.latestRunId || gate?.sourceCoverage?.payload?.latest_run_id || "";
  const receipt = {
    strategy: "strategy2",
    label: "strategy2 intraday complete-run publisher",
    tier: "critical",
    startedAt: now,
    finishedAt: now,
    status: "blocked",
    exitCode: 3,
    scanned: 0,
    total: 0,
    matches: 0,
    complete: false,
    qualityStatus: "blocked",
    fallback: false,
    preservedLatest: true,
    publishBlocked: true,
    publishBlockedReason: error?.message || gate?.issues?.join("; ") || "source gate blocked",
    runId: latestRunId,
    marketDate: "",
    updatedAt: now,
    payloadPath: "preserve-latest",
    source: "supabase-publish-hard-gate",
    warnings: Array.isArray(gate?.warnings) ? gate.warnings : [],
    blockingReason: error?.message || gate?.issues?.join("; ") || "source gate blocked",
    sourceGate: gate || null,
    log: "publish blocked before write; preserved previous complete run",
  };
  fs.writeFileSync(path.join(receiptDir, "strategy2.json"), JSON.stringify(receipt, null, 2) + "\n", "utf8");
  return receipt;
}

function sendStrategy2SourceGateAlert(gate, error) {
  const text = [
    "Strategy2 complete-run publish was blocked before write.",
    "Action: preserved previous complete run; did not write latest; did not overwrite complete run.",
    "",
    `reason=${error?.message || ""}`,
    `latestRunId=${gate?.latestRunId || ""}`,
    `fallbackUsed=${gate?.fallbackUsed === true}`,
    `staleSeconds=${gate?.staleSeconds ?? ""}`,
    "",
    JSON.stringify({
      sourceCoverage: gate?.sourceCoverage || {},
      issues: gate?.issues || [],
      warnings: gate?.warnings || [],
      thresholds: gate?.thresholds || {},
    }, null, 2),
  ].join("\n");
  const result = spawnSync(process.execPath, [
    "--use-system-ca",
    path.join(ROOT, "scripts", "send-workflow-alert.js"),
    "--kind=strategy2-source-publish-gate",
    `--receipt=${STRATEGY2_SOURCE_GATE_ALERT_RECEIPT}`,
    "--subject=Fuman Strategy2 publish blocked by Supabase source gate",
  ], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      FUMAN_ALERT_KIND: "strategy2-source-publish-gate",
      FUMAN_ALERT_SOURCE: "publish-strategy2-complete-run.js",
      FUMAN_ALERT_RECEIPT_FILE: STRATEGY2_SOURCE_GATE_ALERT_RECEIPT,
      FUMAN_ALERT_SUBJECT: "Fuman Strategy2 publish blocked by Supabase source gate",
      FUMAN_ALERT_TEXT: text,
    },
  });
  return {
    ok: result.status === 0,
    exitCode: result.status,
    receiptFile: STRATEGY2_SOURCE_GATE_ALERT_RECEIPT,
    stdout: String(result.stdout || "").slice(0, 1000),
    stderr: String(result.stderr || "").slice(0, 1000),
  };
}

async function strategy2CompleteRunAlreadyPublished(config, runId) {
  const rows = await fetchSupabaseJson(
    config.supabaseUrl + "/rest/v1/v_strategy2_latest_complete_run?select=run_id&run_id=eq." + encodeURIComponent(runId) + "&limit=1",
    config.publishKey
  );
  return Array.isArray(rows) && rows.some((row) => String(row.run_id || "") === runId);
}

async function fetchStrategy2LiveApiPayload() {
  const baseUrl = String(process.env.FUMAN_VERIFY_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
  const response = await fetch(baseUrl + "/api/strategy2-latest?top=1&compact=1&limit=80&live=1&receiptRepair=1&ts=" + Date.now(), {
    headers: { Accept: "application/json", "Cache-Control": "no-store" },
    cache: "no-store",
    signal: AbortSignal.timeout ? AbortSignal.timeout(45000) : undefined,
  });
  if (!response.ok) throw new Error("strategy2 live API HTTP " + response.status);
  return response.json();
}

async function publishStrategy2Snapshot(report, runId, scanDate) {
  const updatedAt = report.updatedAt || report.generatedAt || new Date().toISOString();
  const payload = {
    ...report,
    ok: report.ok !== false,
    complete: true,
    runId,
    date: scanDate,
    updatedAt,
    cacheSource: "supabase:strategy2_latest_snapshot",
    snapshotFirst: true,
    snapshotLabel: "最近快照，前端需背景 live 刷新",
    transport: {
      ...(report.transport || {}),
      source: "strategy2_complete_run_snapshot",
      snapshotKey: STRATEGY2_SNAPSHOT_KEY,
      runId,
      via: "scripts/publish-strategy2-complete-run.js",
      fetchedAt: new Date().toISOString(),
    },
  };
  return upsertSnapshot(STRATEGY2_SNAPSHOT_KEY, payload, {
    source: "strategy2_complete_run_snapshot",
    reason: "strategy2-snapshot-first-cache",
    tradeDate: scanDate.replace(/\D/g, ""),
    timeoutMs: Number(process.env.STRATEGY2_SNAPSHOT_WRITE_TIMEOUT_MS || 20000),
  });
}

async function main() {
  const config = supabaseConfig();
  let source = "";
  let payload = null;
  try {
    await assertStrategy2SourcePublishGate(config, { stage: "complete-run-publish" });
  } catch (error) {
    const replayGate = readValidatedFullWindowReplayReport();
    if (replayGate.ok) {
      source = "local:strategy2-full-window-1m-replay";
      payload = {
        ...replayGate.payload,
        sourceGate: {
          mode: "full-window-replay",
          sourceFile: replayGate.sourceFile,
          validation: replayGate.detail,
          blockedLiveGate: {
            issues: error.gate?.issues || [],
            warnings: error.gate?.warnings || [],
            staleSeconds: error.gate?.staleSeconds,
            fallbackUsed: error.gate?.fallbackUsed,
          },
        },
      };
      console.log(`[strategy2-complete-run] source gate using validated full-window replay records=${payload.records.length} events=${payload.events.length}`);
    } else {
      const receipt = writeStrategy2BlockedReceipt(error.gate, error);
      const alert = sendStrategy2SourceGateAlert(error.gate, error);
      console.log(`[strategy2-complete-run] blocked source gate preservedLatest=true receipt=${receipt.runId || "none"} alert=${alert.ok ? "ok" : "failed"} replayGate=${replayGate.reason || "failed"}`);
      process.exitCode = 3;
      return;
    }
  }
  if (!payload) {
    const latest = await readLatestReportFromSupabase(config);
    source = latest.source;
    payload = latest.payload;
  }
  const report = buildCompleteRunPayload(payload);
  if (report.records.length <= 0 && report.events.length <= 0) {
    throw new Error("strategy2 complete run publish blocked: empty report has no records/events");
  }
  const scanDate = normalizeScanDate(report.date, report.updatedAt || report.generatedAt || Date.now());
  const runId = buildCompleteRunId(report);
  const { supabaseUrl, serviceKey, publishKey } = config;
  if (!supabaseUrl || !publishKey) throw new Error("missing Supabase publish credentials");
  if (!serviceKey) throw new Error("missing Supabase service role key for complete-run RPC");

  await postJson(`${supabaseUrl}/rest/v1/strategy2_latest?on_conflict=id`, publishKey, [{
    id: "latest",
    date: scanDate,
    updated_at: report.updatedAt || new Date().toISOString(),
    entry_count: cleanNumber(report.entryCount || report.aCount),
    record_count: report.records.length,
    event_count: report.events.length,
    payload: report,
  }], "resolution=merge-duplicates");

  let rpcStatus = "published";
  try {
    await postJson(`${supabaseUrl}/rest/v1/rpc/publish_strategy2_complete_run`, serviceKey, {
      p_run_id: runId,
      p_scan_date: scanDate,
      p_payload: report,
    });
  } catch (error) {
    const message = error?.message || String(error);
    if (/duplicate constrained values|ON CONFLICT|21000/i.test(message) && await strategy2CompleteRunAlreadyPublished(config, runId)) {
      rpcStatus = "already_published";
    } else if (/duplicate constrained values|ON CONFLICT|21000/i.test(message)) {
      const apiPayload = await fetchStrategy2LiveApiPayload();
      const apiRunId = String(apiPayload?.runId || apiPayload?.transport?.runId || "");
      if (!apiPayload?.ok || !apiRunId) throw error;
      const apiScanDate = normalizeScanDate(apiPayload.date || apiPayload.usedDate || apiPayload.sourceDate || apiPayload.marketSession?.marketDataDate || report.date, apiPayload.updatedAt || report.updatedAt || Date.now());
      const apiReport = {
        ...report,
        updatedAt: apiPayload.updatedAt || report.updatedAt,
        qualityStatus: apiPayload.qualityStatus || report.qualityStatus || "complete",
        entryCount: cleanNumber(apiPayload.count || report.entryCount || report.aCount),
        records: Array.isArray(apiPayload.rows) ? apiPayload.rows : report.records,
        events: Array.isArray(apiPayload.events) ? apiPayload.events : report.events,
      };
      const receipt = writeStrategy2Receipt(apiReport, apiRunId, apiScanDate, "api/strategy2-latest");
      console.log(`[strategy2-complete-run] repaired receipt from live API run=${apiRunId} date=${apiScanDate} originalRun=${runId} receipt=${receipt.runId}`);
      return;
    } else {
      throw error;
    }
  }
  const snapshot = await publishStrategy2Snapshot(report, runId, scanDate);

  await publishStrategyCacheStatus("strategy2", "策略2-盤中即時", report, {
    used_date: scanDate,
    updated_at: report.updatedAt,
    scan_status: report.ok === false ? "failed" : report.complete === false ? "incomplete" : "complete",
    scanned: report.records.length,
    total: report.records.length,
    match_count: cleanNumber(report.entryCount || report.aCount || report.events.length),
    source: "strategy2_complete_run_supabase",
    log: `run_id=${runId}; events=${report.events.length}; source=${source}`,
  });

  const receipt = writeStrategy2Receipt(report, runId, scanDate, source);
  console.log(`[strategy2-complete-run] ok run=${runId} date=${scanDate} records=${report.records.length} events=${report.events.length} rpc=${rpcStatus} snapshot=${snapshot.ok ? "ok" : snapshot.reason || snapshot.error || "failed"} receipt=${receipt.runId}`);
}

main().catch((error) => {
  console.error(`[strategy2-complete-run] failed: ${error.message}`);
  process.exit(1);
});
