"use strict";

const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");
const { readBurstReadback, VIEW } = require("../lib/daytrade-intraday-burst-reader");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
function arg(name, fallback = "") { const prefix = `--${name}=`; const value = process.argv.find((item) => item.startsWith(prefix)); return value ? value.slice(prefix.length) : fallback; }
function taipeiDate() { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const values = Object.fromEntries(parts.map((part) => [part.type, part.value])); return `${values.year}-${values.month}-${values.day}`; }
async function readRows(source, table, params) {
  const response = await fetch(`${source.url}/rest/v1/${table}?${new URLSearchParams(params)}`, { headers: { apikey: source.key, Authorization: `Bearer ${source.key}`, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${table} HTTP ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : [];
}
async function main() {
  const tradeDate = arg("trade-date", taipeiDate());
  const symbol = String(arg("symbol", "")).replace(/\D/g, "").slice(0, 4);
  const source = { url: terminalSupabaseUrl({ root: ROOT, runtimeDir: RUNTIME_DIR }).replace(/\/+$/, ""), key: terminalSupabaseKey({ root: ROOT, runtimeDir: RUNTIME_DIR }) };
  const readback = source.key ? await readBurstReadback(source, tradeDate, readRows) : { available: false, reasonCode: "burst_readback_credentials_missing", rows: [], bySymbol: new Map() };
  const row = symbol ? readback.bySymbol.get(symbol) || null : null;
  const failedChecks = [];
  if (!readback.available) failedChecks.push(readback.reasonCode || "burst_readback_missing");
  console.log(JSON.stringify({ ok: failedChecks.length === 0, contract: "daytrade_intraday_burst_readback_readonly_v1", view: VIEW, trade_date: tradeDate, symbol: symbol || null, rows: readback.rows.length, burst: row, failed_checks: failedChecks, first_blocker: failedChecks[0] || null, read_only: true }, null, 2));
  process.exitCode = failedChecks.length ? 1 : 0;
}
main().catch((error) => { console.log(JSON.stringify({ ok: false, contract: "daytrade_intraday_burst_readback_readonly_v1", failed_checks: ["burst_readback_unavailable"], first_blocker: "burst_readback_unavailable", error: error?.message || String(error), read_only: true }, null, 2)); process.exitCode = 1; });
