#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const URL = String(process.env.SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const RECOVER_TRIAL_ONLY = process.argv.includes("--recover-trial-only");

function secret(name) {
  for (const file of [path.join(RUNTIME, "secrets", name), path.join(ROOT, "secrets", name)]) {
    try { const value = fs.readFileSync(file, "utf8").trim(); if (value) return value; } catch {}
  }
  return "";
}
function iso(value) { const time = Date.parse(String(value || "")); return Number.isFinite(time) ? new Date(time).toISOString() : ""; }
function taipeiDate(value) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)); }
function taipeiMinutes(value) { const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(value)); const item = Object.fromEntries(parts.map((part) => [part.type, part.value])); return Number(item.hour) * 60 + Number(item.minute); }
async function upsert(table, rows, conflict) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || secret("supabase-service-role-key.txt");
  if (!key) throw new Error("service_role_key_missing");
  for (let offset = 0; offset < rows.length; offset += 100) {
    const response = await fetch(`${URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(offset, offset + 100)), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`${table}_HTTP_${response.status}:${(await response.text()).slice(0, 400)}`);
  }
}

async function main() {
  const cacheFile = path.join(RUNTIME, "cache", "intraday", "fugle-daytrade-ws-quotes-v2.json");
  const cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  const now = new Date();
  const today = taipeiDate(now);
  const inWindow = taipeiMinutes(now) >= 525 && taipeiMinutes(now) < 540;
  if (!inWindow && !RECOVER_TRIAL_ONLY) throw new Error("outside_preopen_capture_window");
  const snapshotRows = [];
  const historyRows = [];
  for (const quote of cache.quotes || []) {
    const symbol = String(quote.code || quote.symbol || "");
    const observedAt = iso(quote.trialEventAt);
    if (!/^\d{4}$/.test(symbol) || !observedAt || taipeiDate(observedAt) !== today) continue;
    const observedMinutes = taipeiMinutes(observedAt);
    if (observedMinutes < 525 || observedMinutes >= 540 || !(Number(quote.trialPrice) > 0) || !(Number(quote.referencePrice) > 0)) continue;
    const orderBookUsable = inWindow && quote.isTrial === true;
    const bids = orderBookUsable && Array.isArray(quote.bidLevels) ? quote.bidLevels : [];
    const asks = orderBookUsable && Array.isArray(quote.askLevels) ? quote.askLevels : [];
    const common = {
      trade_date: today, symbol, name: quote.name || symbol, market: quote.market || null, session: "preopen", updated_at: observedAt,
      reference_price: Number(quote.referencePrice), trial_price: Number(quote.trialPrice), is_trial: true, is_limit_up_bid: quote.isLimitUpBid === true,
      best_bid_price: bids[0]?.price ?? null, best_ask_price: asks[0]?.price ?? null, bid_volume: bids[0]?.size ?? null, ask_volume: asks[0]?.size ?? null,
      bid1_price: bids[0]?.price ?? null, bid1_volume: bids[0]?.size ?? null, ask1_price: asks[0]?.price ?? null, ask1_volume: asks[0]?.size ?? null,
      payload: { source: "fugle-websocket-cache:trial-event", writer_contract: "preopen-websocket-lightweight-v1", trade_date: today, observed_at: observedAt, order_book_status: orderBookUsable ? "same_event_current" : "DATA_GAP_UNRECOVERABLE", recovery_mode: RECOVER_TRIAL_ONLY, formal_candidate: false, order_allowed: false },
    };
    snapshotRows.push(common);
    historyRows.push({ ...common, observed_at: observedAt });
  }
  if (!historyRows.length) throw new Error("same_day_trial_rows_missing");
  await upsert("fugle_preopen_snapshot", snapshotRows, "symbol");
  await upsert("fugle_preopen_snapshot_history", historyRows, "trade_date,symbol,observed_at");
  console.log(JSON.stringify({ ok: true, complete: true, contract: "preopen-websocket-lightweight-v1", trade_date: today, snapshot_rows: snapshotRows.length, history_rows: historyRows.length, order_book_ready_rows: historyRows.filter((row) => row.payload.order_book_status === "same_event_current").length, order_book_data_gap_rows: historyRows.filter((row) => row.payload.order_book_status !== "same_event_current").length, recovery_mode: RECOVER_TRIAL_ONLY }, null, 2));
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, complete: false, first_blocker: error.message }, null, 2)); process.exitCode = 1; });
