"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");

function readSecret(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function normalizeDate(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : "";
}

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseCount(header) {
  const match = String(header || "").match(/\/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

async function main() {
  const targetDate = normalizeDate(argValue("--target-date", process.env.FUMAN_SCANNER_TARGET_DATE || process.env.FUMAN_SCANNER_TARGET_TRADE_DATE || process.env.FUMAN_TERMINAL_TARGET_TRADE_DATE || taipeiDate()));
  const minCount = Math.max(1, Number(argValue("--min-count", process.env.FINMIND_DAILY_MIN_COVERAGE || 1500)) || 1500);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
    || readSecret(path.join(RUNTIME_DIR, "secrets", "supabase-service-role-key.txt"));
  if (!targetDate) throw new Error("invalid target date");
  if (!key) throw new Error("missing Supabase service role key");

  const url = new URL(`${SUPABASE_URL}/rest/v1/finmind_daily_ohlcv`);
  url.searchParams.set("select", "symbol,trade_date,source");
  url.searchParams.set("trade_date", `eq.${targetDate}`);
  url.searchParams.set("limit", "1");
  const response = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "count=exact",
      Range: "0-0",
    },
    signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
  });
  const body = response.ok ? await response.json() : [];
  const rowCount = parseCount(response.headers.get("content-range"));
  const source = String(body?.[0]?.source || "");
  const issues = [];
  if (!response.ok) issues.push(`supabase_http_${response.status}`);
  if (rowCount < minCount) issues.push(`coverage_below_minimum:${rowCount}:${minCount}`);
  if (body?.[0]?.trade_date && normalizeDate(body[0].trade_date) !== targetDate) issues.push("target_date_mismatch");
  if (source && !source.startsWith("finmind:")) issues.push(`source_mismatch:${source}`);

  const report = {
    ok: issues.length === 0,
    contract: "finmind-daily-ohlcv-source-health-v1",
    checkedAt: new Date().toISOString(),
    targetDate,
    rowCount,
    minCount,
    source,
    issues,
    readOnly: true,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, contract: "finmind-daily-ohlcv-source-health-v1", error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
