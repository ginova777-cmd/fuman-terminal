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
  try { return fs.readFileSync(path.join(RUNTIME_DIR, "secrets", name), "utf8").trim(); } catch { return ""; }
}

async function fetchRows(table, query) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    return { ok: false, status: response.status, text };
  }
  try { return { ok: true, rows: JSON.parse(text) }; } catch { return { ok: false, status: response.status, text: "invalid json" }; }
}

function normalizeDate(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.slice(0, 8);
}

function todayTaipei() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}`;
}

const expectedDate = process.env.RUN_GATE_DATE || todayTaipei();
const allGateStrategies = "strategy2,strategy3,strategy4,strategy5,institution,warrant_flow";
const strictStrategies = new Set(String(process.env.RUN_GATE_STRICT || "strategy2").split(",").map((item) => item.trim()).filter(Boolean));
const optionalStrategies = new Set(String(process.env.RUN_GATE_OPTIONAL || "").split(",").map((item) => item.trim()).filter(Boolean));
// Only live routes should require same-day data by default. Complete-scan routes
// are allowed to show the latest completed scan until their scheduled scan runs.
const dateStrictStrategies = new Set(String(process.env.RUN_GATE_DATE_STRICT || "strategy2").split(",").map((item) => item.trim()).filter(Boolean));

const gates = [
  { key: "strategy2", view: "v_strategy2_latest_complete_run" },
  { key: "strategy3", view: "v_strategy3_latest_complete_run" },
  { key: "strategy4", table: "strategy4_scan_runs" },
  { key: "strategy5", view: "v_strategy5_latest_complete_run" },
  { key: "institution", view: "v_institution_latest_complete_run" },
  { key: "warrant_flow", view: "v_warrant_flow_latest_complete_run" },
];

async function checkGate(gate) {
  const select = "run_id,scan_date,finished_at,status,complete,result_count";
  const target = gate.view || gate.table;
  const query = gate.view
    ? `select=${select}&strategy=eq.${gate.key}&status=eq.complete&complete=eq.true&limit=1`
    : `select=${select}&strategy=eq.${gate.key}&status=eq.complete&complete=eq.true&order=finished_at.desc&limit=1`;
  const result = await fetchRows(target, query);
  if (!result.ok) return { ...gate, ok: false, issue: `${target} unreadable HTTP ${result.status}: ${String(result.text || "").slice(0, 160)}` };
  const row = Array.isArray(result.rows) ? result.rows[0] : null;
  if (!row?.run_id) return { ...gate, ok: false, issue: `${target} missing latest complete run` };
  const rowDate = normalizeDate(row.scan_date || row.finished_at);
  if (dateStrictStrategies.has(gate.key) && expectedDate && rowDate && rowDate !== expectedDate) {
    return { ...gate, ok: false, row, issue: `${target} date-strict scan_date=${rowDate} expected=${expectedDate}` };
  }
  if (Number(row.result_count || 0) <= 0 && gate.key !== "strategy2") {
    return { ...gate, ok: false, row, issue: `${target} complete run has zero result_count` };
  }
  return { ...gate, ok: true, row };
}

(async () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("missing Supabase credentials");
  const results = await Promise.all(gates.map(checkGate));
  const issues = [];
  for (const result of results) {
    const level = strictStrategies.has(result.key) ? "strict" : optionalStrategies.has(result.key) ? "optional" : "info";
    const row = result.row || {};
    const summary = result.ok
      ? `${result.key}: ok run=${row.run_id} count=${row.result_count || 0} date=${normalizeDate(row.scan_date || row.finished_at)} datePolicy=${dateStrictStrategies.has(result.key) ? "same-day" : "latest-complete"}`
      : `${result.key}: ${level} ${result.issue}`;
    console.log(`[run-gate] ${summary}`);
    if (!result.ok && level === "strict") issues.push(result.issue);
  }
  if (issues.length) {
    console.error("[run-gate] failed");
    for (const issue of issues) console.error("- " + issue);
    process.exit(1);
  }
  console.log("[run-gate] ok");
})().catch((error) => {
  console.error(`[run-gate] failed: ${error.message}`);
  process.exit(1);
});
