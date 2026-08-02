/*
 * Read-only verifier for the Supabase daytrade near-one/preopen source
 * contract. It deliberately fails closed when natural evidence is missing.
 */

const path = require("path");

const SUPABASE_URL = (process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SYMBOLS = ["3105", "2455", "2303", "2327"];
const SLOTS = ["0845", "0850", "0855", "0859"];
const READ_TIMEOUT_MS = Math.max(3000, Number(process.env.DAYTRADE_SUPABASE_READ_TIMEOUT_MS || 8000));

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function readText(file) {
  try { return require("fs").readFileSync(file, "utf8").trim(); } catch { return ""; }
}

function readSecret(name) {
  return readText(path.join(RUNTIME_DIR, "secrets", name))
    || readText(path.join(process.cwd(), "secrets", name))
    || readText(path.join("C:", "fuman-terminal", "secrets", name));
}

const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecret("supabase-service-role-key.txt")
  || readSecret("supabase-anon-key.txt");

function headers() {
  return { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: "application/json" };
}

function normalizeDate(value) {
  const text = String(value || "").replace(/\D/g, "");
  return text.length === 8 ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : String(value || "");
}

function taipeiDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function readView(view, select, filters = {}) {
  if (!KEY) throw new Error("missing Supabase read key");
  const params = new URLSearchParams({ select, ...filters });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${view}?${params}`, {
    headers: headers(),
    signal: AbortSignal.timeout ? AbortSignal.timeout(READ_TIMEOUT_MS) : undefined,
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${view} HTTP ${response.status}: ${body.slice(0, 240)}`);
  return body ? JSON.parse(body) : [];
}

function bySymbol(rows, key = "symbol") {
  const map = new Map();
  for (const row of rows || []) {
    const symbol = String(row?.[key] || row?.underlying_symbol || "").trim();
    if (symbol && !map.has(symbol)) map.set(symbol, row);
  }
  return map;
}

function addFailure(list, code, detail = null) {
  list.push(detail ? { code, detail } : code);
}

async function main() {
  const expectedDate = normalizeDate(argValue("expected-date", taipeiDate()));
  const result = {
    ok: false,
    expectedDate,
    symbols: SYMBOLS,
    requiredSlots: SLOTS,
    failedChecks: [],
    sourceStatus: "unknown",
    cases: {},
    naturalScheduleEvidence: false,
    auditStatus: "INCOMPLETE",
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)) addFailure(result.failedChecks, "invalid_expected_date");
  try {
    const dateFilter = `trade_date=eq.${encodeURIComponent(expectedDate)}`;
    const symbolFilter = `&symbol=in.(${SYMBOLS.join(",")})`;
    const underlyingFilter = `&underlying_symbol=in.(${SYMBOLS.join(",")})`;
    const [canonical, snapshots, inverse, appRows] = await Promise.all([
      readView("v_fugle_daytrade_near_one_contract", "trade_date,symbol,fut_contract,contract_month,expiry_date,is_near_one,resolved_at,source", { trade_date: `eq.${expectedDate}`, symbol: `in.(${SYMBOLS.join(",")})` }),
      readView("v_fugle_daytrade_preopen_snapshot_contract", "trade_date,capture_slot,underlying_symbol,fut_contract,expiry_date,captured_at,fut_price,fut_change_pct,fut_volume,trial_price,trial_change_pct,best_bid,best_ask,bid_ask_ratio,natural_schedule_evidence,source", { trade_date: `eq.${expectedDate}`, underlying_symbol: `in.(${SYMBOLS.join(",")})` }),
      readView("v_fugle_daytrade_inverse_convergence", "trade_date,underlying_symbol,snapshot_count,natural_schedule_evidence,basis_status,inverse_convergence,basis_0845,basis_0859", { trade_date: `eq.${expectedDate}`, underlying_symbol: `in.(${SYMBOLS.join(",")})` }),
      readView("v_stock_future_live_contract", "trade_date,symbol,future_symbol,source_status", { trade_date: `eq.${expectedDate}`, symbol: `in.(${SYMBOLS.join(",")})` }).catch(() => []),
    ]);
    result.rowCounts = { canonical: canonical.length, snapshots: snapshots.length, inverse: inverse.length, app: appRows.length };
    const canonicalMap = bySymbol(canonical);
    const snapshotMap = new Map();
    for (const row of snapshots) {
      const symbol = String(row?.underlying_symbol || "");
      if (!snapshotMap.has(symbol)) snapshotMap.set(symbol, new Map());
      snapshotMap.get(symbol).set(String(row.capture_slot || ""), row);
    }
    const inverseMap = bySymbol(inverse, "underlying_symbol");
    const appMap = bySymbol(appRows);
    for (const symbol of SYMBOLS) {
      const row = canonicalMap.get(symbol);
      const slots = snapshotMap.get(symbol) || new Map();
      const inv = inverseMap.get(symbol);
      const app = appMap.get(symbol);
      const missingSlots = SLOTS.filter((slot) => !slots.has(slot));
      const invalidSlots = SLOTS.filter((slot) => {
        const item = slots.get(slot);
        return !item || item.natural_schedule_evidence !== true;
      });
      const missingFields = SLOTS.flatMap((slot) => {
        const item = slots.get(slot);
        return ["fut_price", "trial_price", "best_bid", "best_ask"].filter((field) => item?.[field] === null || item?.[field] === undefined).map((field) => `${slot}.${field}`);
      });
      const caseResult = {
        canonical: row || null,
        app: app || null,
        slots: Object.fromEntries(SLOTS.map((slot) => [slot, slots.get(slot) || null])),
        inverse: inv || null,
        missingSlots,
        invalidSlots,
        missingFields,
        appSourceMatches: !app || !row || String(app.future_symbol || "") === String(row.fut_contract || ""),
      };
      result.cases[symbol] = caseResult;
      if (!row) addFailure(result.failedChecks, "canonical_near_one_missing", symbol);
      else {
        if (row.is_near_one !== true) addFailure(result.failedChecks, "canonical_near_one_flag_invalid", symbol);
        if (!row.fut_contract || !row.expiry_date) addFailure(result.failedChecks, "canonical_near_one_contract_incomplete", symbol);
      }
      for (const slot of missingSlots) addFailure(result.failedChecks, "natural_preopen_slot_missing", `${symbol}:${slot}`);
      for (const slot of invalidSlots) addFailure(result.failedChecks, "natural_schedule_evidence_false", `${symbol}:${slot}`);
      for (const field of missingFields) addFailure(result.failedChecks, "preopen_field_missing", `${symbol}:${field}`);
      if (inv?.basis_status !== "READY" || typeof inv?.inverse_convergence !== "boolean") addFailure(result.failedChecks, "inverse_convergence_incomplete", symbol);
      if (inv?.natural_schedule_evidence !== true) addFailure(result.failedChecks, "inverse_natural_evidence_incomplete", symbol);
      if (app && row && String(app.future_symbol || "") !== String(row.fut_contract || "")) addFailure(result.failedChecks, "app_source_near_one_mismatch", symbol);
    }
    result.naturalScheduleEvidence = result.failedChecks.length === 0;
    result.sourceStatus = result.failedChecks.length ? "degraded" : "ready";
    result.auditStatus = result.failedChecks.length ? "INCOMPLETE" : "READY";
    result.ok = result.failedChecks.length === 0;
  } catch (error) {
    addFailure(result.failedChecks, "readback_failed", error?.message || String(error));
    result.sourceStatus = "not_connected";
    result.auditStatus = "INCOMPLETE";
  }
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, auditStatus: "INCOMPLETE", failedChecks: [error?.message || String(error)] }, null, 2));
  process.exitCode = 1;
});
