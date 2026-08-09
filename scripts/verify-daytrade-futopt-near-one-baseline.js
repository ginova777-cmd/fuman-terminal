const fs = require("fs");
const path = require("path");

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const runtimeRoot = "C:/fuman-runtime";

function readText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const key = process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readText(path.join(runtimeRoot, "secrets", "supabase-anon-key.txt"))
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || readText(path.join(runtimeRoot, "secrets", "supabase-service-role-key.txt"));

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function read(resource, query) {
  if (!key) throw new Error("missing_supabase_read_key");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${resource}_HTTP_${response.status}:${text.slice(0, 180)}`);
  return text ? JSON.parse(text) : [];
}

function uniqueCount(rows, field) {
  return new Set(rows.map((row) => String(row?.[field] || "")).filter(Boolean)).size;
}

async function main() {
  const expectedDate = taipeiDate();
  const out = {
    ok: false,
    expectedDate,
    contract: "daytrade_futopt_near_one_baseline_v20260729",
    nearOne: {},
    baseline: {},
    convergence: {},
    failures: [],
  };
  try {
    const [nearRows, baselineRows, basisRows] = await Promise.all([
      read("v_fugle_daytrade_stock_future_near_one_contract", "select=trade_date,underlying_symbol,future_symbol,contract_end_date,near_contract_status,updated_at,quote_age_seconds&limit=2000"),
      read("v_fugle_daytrade_futopt_preopen_baseline", "select=trade_date,underlying_symbol,future_symbol,baseline_status,natural_0845_baseline_ready,baseline_observed_at,captured_at&limit=2000"),
      read("v_fugle_daytrade_futopt_basis_current", "select=trade_date,underlying_symbol,future_symbol,convergence_status,basis_percent,convergence_from_0845_percent&limit=2000"),
    ]);
    const nearCurrent = nearRows.filter((row) => row.trade_date === expectedDate);
    const baselineCurrent = baselineRows.filter((row) => row.trade_date === expectedDate);
    const basisCurrent = basisRows.filter((row) => row.trade_date === expectedDate);
    const expired = nearCurrent.filter((row) => row.near_contract_status === "expired");
    const unknownExpiry = nearCurrent.filter((row) => row.near_contract_status === "current_live_expiry_unknown");
    const baselineReady = baselineCurrent.filter((row) => row.natural_0845_baseline_ready === true && row.baseline_status === "ready");
    const convergenceReady = basisCurrent.filter((row) => row.convergence_status === "ready");
    out.nearOne = {
      rows: nearRows.length,
      currentDateRows: nearCurrent.length,
      uniqueUnderlyings: uniqueCount(nearCurrent, "underlying_symbol"),
      duplicateUnderlyings: Math.max(0, nearCurrent.length - uniqueCount(nearCurrent, "underlying_symbol")),
      expiredRows: expired.length,
      unknownExpiryRows: unknownExpiry.length,
      futureSymbols: uniqueCount(nearCurrent, "future_symbol"),
    };
    out.baseline = {
      rows: baselineRows.length,
      currentDateRows: baselineCurrent.length,
      natural0845ReadyRows: baselineReady.length,
      latestCapturedAt: baselineCurrent.map((row) => row.captured_at).filter(Boolean).sort().at(-1) || "",
    };
    out.convergence = {
      currentDateRows: basisCurrent.length,
      readyRows: convergenceReady.length,
      baselineMissingRows: basisCurrent.filter((row) => row.convergence_status === "baseline_missing").length,
    };
    if (!nearCurrent.length) out.failures.push("near_one_current_date_rows_missing");
    if (out.nearOne.duplicateUnderlyings > 0) out.failures.push("near_one_underlying_not_unique");
    if (out.nearOne.expiredRows > 0) out.failures.push("near_one_expired_rows_present");
    if (!baselineReady.length) out.failures.push("natural_0845_baseline_missing");
    out.ok = out.failures.length === 0;
  } catch (error) {
    out.failures.push(error?.message || String(error));
  }
  console.log(JSON.stringify(out, null, 2));
  process.exitCode = out.ok ? 0 : 1;
}

main();
