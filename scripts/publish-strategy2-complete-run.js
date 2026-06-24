const fs = require("fs");
const path = require("path");
const { publishStrategyCacheStatus } = require("../lib/strategy-cache-status");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";

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
  return {
    ...report,
    events: Array.isArray(report.events) ? report.events : [],
    records: Array.isArray(report.records) ? report.records : [],
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

async function main() {
  const config = supabaseConfig();
  const { source, payload } = await readLatestReportFromSupabase(config);
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

  await postJson(`${supabaseUrl}/rest/v1/rpc/publish_strategy2_complete_run`, serviceKey, {
    p_run_id: runId,
    p_scan_date: scanDate,
    p_payload: report,
  });

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

  console.log(`[strategy2-complete-run] ok run=${runId} date=${scanDate} records=${report.records.length} events=${report.events.length}`);
}

main().catch((error) => {
  console.error(`[strategy2-complete-run] failed: ${error.message}`);
  process.exit(1);
});
