const fs = require("fs");
const path = require("path");
const { expectedMinuteLabels } = require("../lib/daytrade-intraday-1m-timeline");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const valueArg = (name, fallback = "") => { const item = process.argv.find((arg) => arg.startsWith(`${name}=`)); return item ? item.slice(name.length + 1) : fallback; };
const tradeDate = valueArg("--trade-date", "");
function readSecret(file) { try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; } }
const key = process.env.SUPABASE_ANON_KEY || readSecret(path.join(RUNTIME_DIR, "secrets", "supabase-anon-key.txt"));
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
async function main() {
  const date = tradeDate || today;
  if (!key) throw new Error("missing Supabase anon key");
  const url = `${SUPABASE_URL}/rest/v1/v_fugle_daytrade_intraday_1m_timeline_audit?select=*&trade_date=eq.${encodeURIComponent(date)}&order=symbol.asc`;
  const response = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const text = await response.text();
  if (!response.ok) throw new Error(`timeline audit HTTP ${response.status}: ${text.slice(0, 300)}`);
  const rows = text ? JSON.parse(text) : [];
  const failures = rows.filter((row) => !row.replay_allowed || (Array.isArray(row.missing_minutes) && row.missing_minutes.length));
  const result = { ok: rows.length > 0 && failures.length === 0, contract: "daytrade-intraday-1m-timeline-v1", tradeDate: date, auditedSymbols: rows.length, expectedMinutes: expectedMinuteLabels().length, replayAllowedSymbols: rows.filter((row) => row.replay_allowed).length, failures: failures.slice(0, 20).map((row) => ({ symbol: row.symbol, missingMinutes: row.missing_minutes, replayAllowed: row.replay_allowed })), source: "supabase-read-only" };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message || String(error) }, null, 2)); process.exitCode = 1; });
