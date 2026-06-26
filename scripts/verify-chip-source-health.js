const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = String(
  process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || readSecret("supabase-url.txt")
  || "https://cpmpfhbzutkiecccekfr.supabase.co"
).replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecret("supabase-service-role-key.txt")
  || readSecret("supabase-anon-key.txt");

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
  const direct = text.replace(/\D/g, "");
  if (direct.length >= 8) return direct.slice(0, 8);
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return taipeiDateKey(new Date(parsed));
  return "";
}

function dateAgeDays(dateKey) {
  if (!/^\d{8}$/.test(String(dateKey || ""))) return null;
  const today = taipeiDateKey();
  const toUtc = (value) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)));
  return Math.floor((toUtc(today) - toUtc(dateKey)) / 86400000);
}

async function fetchRows(table, select, query = "") {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("missing Supabase credentials");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}${query ? `&${query}` : ""}`;
    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${table} HTTP ${response.status}: ${text.slice(0, 240)}`);
    const rows = JSON.parse(text || "[]");
    return Array.isArray(rows) ? rows : [];
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const maxAgeDays = Math.max(1, Number(process.env.CHIP_SOURCE_HEALTH_MAX_AGE_DAYS || 3));
  const healthRows = await fetchRows(
    "v_institution_source_health",
    [
      "checked_trade_date",
      "latest_trade_date",
      "institutional_latest_trade_date",
      "margin_latest_trade_date",
      "unified_latest_trade_date",
      "institutional_rows",
      "margin_rows",
      "unified_rows",
      "valid_after_exclusion_rows",
      "coverage_status",
      "reason",
    ].join(","),
    "order=checked_trade_date.desc&limit=1"
  );
  const chipRows = await fetchRows(
    "v_chip_flows_latest",
    "trade_date,source",
    "order=trade_date.desc&limit=5"
  );
  const health = healthRows[0] || {};
  const latestTradeDate = compactDate(health.latest_trade_date || chipRows[0]?.trade_date);
  const latestAgeDays = dateAgeDays(latestTradeDate);
  const coverageStatus = String(health.coverage_status || "").toLowerCase();
  const issues = [];
  if (!["ready", "ok", "healthy", "complete"].includes(coverageStatus)) {
    issues.push(`coverage_status=${health.coverage_status || "missing"}`);
  }
  if (latestAgeDays == null) issues.push("latest_trade_date missing");
  else if (latestAgeDays > maxAgeDays) issues.push(`latest_trade_date=${latestTradeDate} age=${latestAgeDays}d>${maxAgeDays}d`);
  if (Number(health.institutional_rows || 0) <= 0) issues.push("institutional_rows<=0");
  if (Number(health.margin_rows || 0) <= 0) issues.push("margin_rows<=0");
  if (!chipRows.length) issues.push("v_chip_flows_latest empty");

  const payload = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    maxAgeDays,
    latestTradeDate,
    latestAgeDays,
    coverageStatus: health.coverage_status || "",
    health,
    chipLatest: chipRows,
    issues,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (issues.length) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exit(1);
});
