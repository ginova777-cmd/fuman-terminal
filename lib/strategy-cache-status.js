const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const STATUS_TABLE = process.env.SUPABASE_STRATEGY_CACHE_STATUS_TABLE || "strategy_cache_status";

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

function supabaseUrl() {
  return String(
    process.env.SUPABASE_URL
    || process.env.FUMAN_SUPABASE_URL
    || readSecretText(path.join(ROOT, "secrets", "supabase-url.txt"))
    || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-url.txt"))
  ).replace(/\/+$/, "");
}

function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_KEY
    || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
    || process.env.FUMAN_SUPABASE_SERVICE_KEY
    || readSecretText(path.join(ROOT, "secrets", "supabase-service-role-key.txt"))
    || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-service-role-key.txt"));
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function normalizeDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function payloadRows(payload = {}) {
  if (Array.isArray(payload.matches)) return payload.matches;
  if (Array.isArray(payload.events)) return payload.events;
  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.rows)) return payload.rows;
  return [];
}

function buildStrategyStatusRow(strategyKey, label, payload = {}, overrides = {}) {
  const rows = payloadRows(payload);
  const matchCount = cleanNumber(
    overrides.match_count
    ?? overrides.matchCount
    ?? payload.count
    ?? payload.matchCount
    ?? payload.entryCount
    ?? rows.length
  );
  const scanned = cleanNumber(
    overrides.scanned
    ?? overrides.scanned_count
    ?? overrides.scannedCount
    ?? (Array.isArray(payload.scannedCodes) ? payload.scannedCodes.length : 0)
    ?? payload.scanned
  );
  const total = cleanNumber(
    overrides.total
    ?? overrides.total_count
    ?? overrides.totalCount
    ?? payload.total
    ?? scanned
  );
  return {
    strategy_key: strategyKey,
    label,
    used_date: String(overrides.used_date || overrides.usedDate || normalizeDate(payload.usedDate || payload.date || payload.scanStamp || payload.generatedDate || payload.sourceDate) || ""),
    updated_at: overrides.updated_at || overrides.updatedAt || payload.updatedAt || payload.generatedAt || new Date().toISOString(),
    scan_status: String(overrides.scan_status || overrides.scanStatus || (payload.ok === false ? "failed" : payload.complete === false ? "incomplete" : "complete")),
    scanned,
    total,
    match_count: matchCount,
    source: String(overrides.source || payload.source || ""),
    log: String(overrides.log || ""),
    error: String(overrides.error || ""),
  };
}

async function upsertStrategyCacheStatus(row, options = {}) {
  const url = supabaseUrl();
  const key = serviceKey();
  if (!url || !key) return { ok: false, skipped: true, reason: "missing Supabase service credentials" };
  try {
    const response = await fetch(`${url}/rest/v1/${options.table || STATUS_TABLE}?on_conflict=strategy_key`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify([row]),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { ok: false, status: response.status, error: text.slice(0, 240) };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function publishStrategyCacheStatus(strategyKey, label, payload = {}, overrides = {}) {
  const row = buildStrategyStatusRow(strategyKey, label, payload, overrides);
  const result = await upsertStrategyCacheStatus(row);
  if (!result.ok && process.env.STRATEGY_CACHE_STATUS_WARN !== "0") {
    console.warn(`strategy_cache_status upsert skipped ${strategyKey}: ${result.reason || result.error || result.status || "unknown"}`);
  }
  return { ...result, row };
}

module.exports = {
  buildStrategyStatusRow,
  publishStrategyCacheStatus,
  upsertStrategyCacheStatus,
};
