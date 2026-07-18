#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/$/, "");
const REQUIRE_READY = process.argv.includes("--require-ready");
const CHECKPOINTS = ["08:55", "08:58", "08:59"];

function readFirstExisting(paths) {
  for (const p of paths) {
    try {
      const value = fs.readFileSync(p, "utf8").trim();
      if (value) return value;
    } catch (_) {}
  }
  return "";
}

function getAnonKey() {
  return process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || readFirstExisting([
    path.join("C:\\fuman-runtime", "secrets", "supabase-anon-key.txt"),
    path.join("C:\\fuman-terminal", "secrets", "supabase-anon-key.txt"),
    path.join(process.cwd(), "secrets", "supabase-anon-key.txt")
  ]);
}

async function rest(pathAndQuery) {
  const key = getAnonKey();
  if (!key) throw new Error("missing SUPABASE_ANON_KEY / supabase-anon-key.txt");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
      signal: controller.signal,
      headers: { apikey: key, authorization: `Bearer ${key}`, accept: "application/json" }
    });
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${typeof body === "string" ? body : JSON.stringify(body)}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function taipeiTradeDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function utcRangeForTaipeiMinute(tradeDate, hhmm) {
  const start = new Date(`${tradeDate}T${hhmm}:00+08:00`);
  const end = new Date(start.getTime() + 60_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function payloadOf(row) {
  if (!row || !row.payload) return {};
  if (typeof row.payload === "object") return row.payload;
  try { return JSON.parse(row.payload); } catch (_) { return {}; }
}

async function rowsForCheckpoint(tradeDate, checkpoint) {
  const { start, end } = utcRangeForTaipeiMinute(tradeDate, checkpoint);
  const query = [
    "fugle_preopen_snapshot_history?select=symbol,observed_at,updated_at,session,trade_date,payload",
    `observed_at=gte.${encodeURIComponent(start)}`,
    `observed_at=lt.${encodeURIComponent(end)}`,
    "order=observed_at.desc",
    "limit=5"
  ].join("&");
  const rows = await rest(query);
  return { checkpoint, start, end, rows: Array.isArray(rows) ? rows : [] };
}

async function main() {
  const tradeDate = process.env.FUMAN_PREOPEN_CHECKPOINT_DATE || taipeiTradeDate();
  const [latestRows, ...checkpointResults] = await Promise.all([
    rest("fugle_preopen_snapshot_history?select=symbol,observed_at,updated_at,session,trade_date,payload&order=observed_at.desc&limit=5"),
    ...CHECKPOINTS.map((checkpoint) => rowsForCheckpoint(tradeDate, checkpoint))
  ]);

  const checkpointDetails = checkpointResults.map((result) => ({
    checkpoint_key: result.checkpoint,
    status: result.rows.length > 0 ? "present" : "missing",
    rows: result.rows.length,
    symbols_sampled: result.rows.map((row) => row.symbol),
    first_observed_at: result.rows.length ? result.rows[result.rows.length - 1].observed_at : null,
    latest_observed_at: result.rows.length ? result.rows[0].observed_at : null,
    window_start_utc: result.start,
    window_end_utc: result.end
  }));
  const readyCount = checkpointDetails.filter((row) => row.status === "present").length;
  const missing = checkpointDetails.filter((row) => row.status !== "present").map((row) => row.checkpoint_key);

  const latestHistoryRows = (Array.isArray(latestRows) ? latestRows : []).map((row) => {
    const payload = payloadOf(row);
    return {
      symbol: row.symbol,
      observed_at: row.observed_at,
      updated_at: row.updated_at,
      session: row.session,
      trade_date: row.trade_date,
      preopen_checkpoint_contract: payload.preopen_checkpoint_contract || null,
      preopen_checkpoint_key: payload.preopen_checkpoint_key || null,
      preopen_checkpoint_present: payload.preopen_checkpoint_present === true,
      writer_observed_at: payload.writer_observed_at || null
    };
  });

  const summary = {
    trade_date: tradeDate,
    required_checkpoint_count: CHECKPOINTS.length,
    ready_checkpoint_count: readyCount,
    all_required_checkpoints_present: missing.length === 0,
    contract_status: missing.length === 0 ? "ready" : "not_ready",
    contract_reason: missing.length === 0 ? "all required preopen checkpoints present" : `missing required preopen checkpoints: ${missing.join(" / ")}`,
    checkpoint_details: checkpointDetails
  };
  const issues = missing.length ? [summary.contract_reason] : [];
  const output = {
    ok: !REQUIRE_READY || issues.length === 0,
    checkedAt: new Date().toISOString(),
    mode: "diagnostic_not_source_gate",
    meaning: "Missing 08:55/08:58/08:59 checkpoints blocks STAR/preopen replay proof only; it must not downgrade the main daytrade quote/1m source gate by itself.",
    requireReady: REQUIRE_READY,
    summary,
    latestHistoryRows,
    issues
  };
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exit(1);
}
main().catch((err) => {
  console.error(JSON.stringify({ ok: false, mode: "diagnostic_not_source_gate", error: err.message }, null, 2));
  process.exit(1);
});