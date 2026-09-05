"use strict";

const fs = require("fs");
const path = require("path");

const CONTRACT = "preopen-snapshot-history-canonical-verifier-v2";
const WRITER_CONTRACT = "preopen_snapshot_history_v2";
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");

function arg(name, fallback = "") {
  const prefix = `${name}=`;
  const hit = process.argv.find((item) => item === name || item.startsWith(prefix));
  return hit === name ? "1" : hit ? hit.slice(prefix.length) : fallback;
}
function readText(file) { try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; } }
function readKey() {
  return process.env.SUPABASE_ANON_KEY
    || process.env.FUMAN_SUPABASE_ANON_KEY
    || readText("C:/fuman-runtime/secrets/supabase-anon-key.txt")
    || readText(path.resolve(__dirname, "..", "secrets", "supabase-anon-key.txt"));
}
function taipeiDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}
function taipeiClock(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(parsed));
}
function payloadOf(row) {
  if (row?.payload && typeof row.payload === "object") return row.payload;
  try { return JSON.parse(row?.payload || "{}"); } catch { return {}; }
}
async function getAll(table, query, key) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const joiner = query ? "&" : "";
    const url = `${SUPABASE_URL}/rest/v1/${table}?${query}${joiner}limit=1000&offset=${offset}`;
    const response = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" } });
    const text = await response.text();
    if (!response.ok) throw new Error(`${table} HTTP ${response.status}: ${text.slice(0, 300)}`);
    const rows = text ? JSON.parse(text) : [];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
function add(checks, name, ok, detail = null) { checks.push({ name, ok: Boolean(ok), detail }); }

async function main() {
  const tradeDate = arg("--date", taipeiDate());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) throw new Error("--date must be YYYY-MM-DD");
  const key = readKey();
  if (!key) throw new Error("missing Supabase readonly key");
  const select = "trade_date,symbol,observed_at,updated_at,reference_price,trial_price,is_trial,payload";
  const snapshotSelect = "trade_date,symbol,updated_at,reference_price,trial_price,is_trial,payload";
  const [snapshot, history] = await Promise.all([
    getAll("fugle_preopen_snapshot", `select=${snapshotSelect}&trade_date=eq.${encodeURIComponent(tradeDate)}&order=symbol.asc&`, key),
    getAll("fugle_preopen_snapshot_history", `select=${select}&trade_date=eq.${encodeURIComponent(tradeDate)}&order=observed_at.asc&`, key),
  ]);
  const snapshotSymbols = new Set(snapshot.map((row) => String(row.symbol || "").trim()).filter(Boolean));
  const historySymbols = new Set(history.map((row) => String(row.symbol || "").trim()).filter(Boolean));
  const clocks = history.map((row) => taipeiClock(row.observed_at));
  const inWindow = (clock) => clock >= "08:45:00" && clock <= "08:59:59";
  const checkpoints = Object.fromEntries(["08:55", "08:58", "08:59"].map((minute) => [minute, clocks.filter((clock) => clock.startsWith(minute)).length]));
  const badPriceSnapshot = snapshot.filter((row) => !(Number(row.trial_price) > 0 && Number(row.reference_price) > 0)).length;
  const badPriceHistory = history.filter((row) => !(Number(row.trial_price) > 0 && Number(row.reference_price) > 0)).length;
  const allRows = [...snapshot, ...history];
  const badContract = allRows.filter((row) => payloadOf(row).writer_contract !== WRITER_CONTRACT).length;
  const unsafeRows = allRows.filter((row) => {
    const payload = payloadOf(row);
    return payload.formal_candidate !== false || payload.order_allowed !== false || payload.formal_entry_allowed !== false || payload.safety_scope !== "PREOPEN_OBSERVATION_ONLY";
  }).length;
  const checks = [];
  add(checks, "trade_date_valid", snapshot.every((row) => row.trade_date === tradeDate) && history.every((row) => row.trade_date === tradeDate));
  add(checks, "snapshot_today_rows", snapshot.length > 0, snapshot.length);
  add(checks, "history_today_rows", history.length > 0, history.length);
  add(checks, "history_all_in_0845_0859", history.length > 0 && clocks.every(inWindow), clocks.filter((clock) => !inWindow(clock)));
  add(checks, "snapshot_latest_is_today", snapshot.length > 0 && snapshot.every((row) => taipeiDate(new Date(row.updated_at)) === tradeDate));
  add(checks, "no_0900_or_later_history", history.length > 0 && clocks.every((clock) => clock < "09:00:00"));
  add(checks, "symbols_nonempty", allRows.length > 0 && allRows.every((row) => String(row.symbol || "").trim()));
  add(checks, "trial_reference_complete", badPriceSnapshot === 0 && badPriceHistory === 0, { snapshot_missing: badPriceSnapshot, history_missing: badPriceHistory });
  add(checks, "snapshot_history_symbol_coverage", snapshotSymbols.size > 0 && historySymbols.size > 0 && [...snapshotSymbols].every((symbol) => historySymbols.has(symbol)), { snapshot_symbols: snapshotSymbols.size, history_symbols: historySymbols.size });
  for (const minute of ["08:55", "08:58", "08:59"]) add(checks, `checkpoint_${minute.replace(":", "")}`, checkpoints[minute] > 0, checkpoints[minute]);
  add(checks, "writer_contract", allRows.length > 0 && badContract === 0, badContract);
  add(checks, "safety_flags", allRows.length > 0 && unsafeRows === 0, unsafeRows);
  const failed = checks.filter((check) => !check.ok);
  const receipt = {
    contract: CONTRACT,
    status: failed.length ? "failed" : "complete",
    ok: failed.length === 0,
    trade_date: tradeDate,
    checked_at: new Date().toISOString(),
    snapshot_rows: snapshot.length,
    history_rows: history.length,
    snapshot_symbols: snapshotSymbols.size,
    history_symbols: historySymbols.size,
    history_latest_observed_at: history.at(-1)?.observed_at || null,
    trial_price_missing_rate: allRows.length ? (badPriceSnapshot + badPriceHistory) / allRows.length : 1,
    reference_price_missing_rate: allRows.length ? allRows.filter((row) => !(Number(row.reference_price) > 0)).length / allRows.length : 1,
    checkpoint_coverage: checkpoints,
    checks,
    first_blocker: failed[0]?.name || null,
    writes_supabase: false,
    calls_fugle: false,
  };
  const compact = tradeDate.replace(/-/g, "");
  const outputPath = path.resolve(arg("--receipt", `C:/fuman-runtime/data/scan-receipts/preopen-snapshot-history-canonical-verifier-receipt-${compact}.json`));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...receipt, receipt_path: outputPath }, null, 2));
  process.exitCode = receipt.ok ? 0 : 1;
}

main().catch((error) => { console.error(JSON.stringify({ contract: CONTRACT, status: "failed", ok: false, error: error.message }, null, 2)); process.exitCode = 1; });
