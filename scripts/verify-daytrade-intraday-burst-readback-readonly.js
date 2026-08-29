"use strict";

const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");
const { readBurstReadback, VIEW } = require("../lib/daytrade-intraday-burst-reader");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const HEALTH_VIEW = "v_fugle_daytrade_source_health_readback";
function arg(name, fallback = "") { const prefix = `--${name}=`; const value = process.argv.find((item) => item.startsWith(prefix)); return value ? value.slice(prefix.length) : fallback; }
function taipeiDate() { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const values = Object.fromEntries(parts.map((part) => [part.type, part.value])); return `${values.year}-${values.month}-${values.day}`; }
function taipeiMinute() { const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()); const values = Object.fromEntries(parts.map((part) => [part.type, part.value])); return Number(values.hour) * 60 + Number(values.minute); }
function taipeiWeekday() { return new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", weekday: "short" }).format(new Date()); }
function secondsSince(value) { const parsed = Date.parse(String(value || "")); return Number.isFinite(parsed) ? Math.max(0, Math.floor((Date.now() - parsed) / 1000)) : 999999; }
function latestTimestamp(rows, fields) { return rows.flatMap((row) => fields.map((field) => row?.[field])).filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null; }
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
  let healthRows = [];
  let healthAvailable = false;
  let healthReadError = null;
  if (source.key) {
    try {
      healthRows = await readRows(source, HEALTH_VIEW, {
        select: "trade_date,symbol,source_name,quote_seen_at,received_at,aggregate_last_updated,latest_candle_time,first_candle_time,last_candle_time,candle_count,data_gap,data_gap_reason,quote_age_seconds,intraday_1m_stale_seconds",
        trade_date: `eq.${tradeDate}`,
        ...(symbol ? { symbol: `eq.${symbol}` } : {}),
        order: "latest_candle_time.desc.nullslast",
        limit: symbol ? "1" : "5000",
      });
      healthAvailable = true;
    } catch (error) {
      healthReadError = error?.message || String(error);
    }
  }
  const weekday = taipeiWeekday();
  const weekdaySession = !["Sat", "Sun"].includes(weekday);
  const marketSession = tradeDate === taipeiDate() && weekdaySession && taipeiMinute() >= 9 * 60 + 2 && taipeiMinute() <= 13 * 60 + 30;
  const latestCandleTime = latestTimestamp(healthRows, ["latest_candle_time", "last_candle_time"]);
  const latestWriterEvidence = latestTimestamp(healthRows, ["received_at", "aggregate_last_updated", "quote_seen_at", "latest_candle_time"]);
  const latestCandleAgeSeconds = secondsSince(latestCandleTime);
  const writerEvidenceAgeSeconds = secondsSince(latestWriterEvidence);
  const healthyRows = healthRows.filter((item) => item?.data_gap !== true);
  const writerAlive = marketSession ? healthAvailable && healthRows.length > 0 && latestCandleAgeSeconds <= 180 && writerEvidenceAgeSeconds <= 180 : null;
  const dataGap = marketSession && (!healthAvailable || healthRows.length === 0 || healthyRows.length === 0 || !writerAlive);
  const noMatch = marketSession && readback.available && readback.rows.length === 0 && !dataGap;
  const failedChecks = [];
  if (!readback.available) failedChecks.push(readback.reasonCode || "burst_readback_missing");
  if (marketSession && !healthAvailable) failedChecks.push("burst_writer_health_readback_unavailable");
  else if (marketSession && healthRows.length === 0) failedChecks.push(symbol ? "burst_symbol_health_missing" : "burst_writer_health_missing");
  else if (marketSession && healthyRows.length === 0) failedChecks.push(`burst_source_data_gap:${healthRows[0]?.data_gap_reason || "unspecified"}`);
  else if (marketSession && !writerAlive) failedChecks.push("burst_writer_or_intraday_1m_stale");
  const burstStatus = !marketSession ? "OFF_SESSION" : (dataGap ? "DATA_GAP" : (noMatch ? "NO_MATCH" : "MATCHED"));
  console.log(JSON.stringify({
    ok: failedChecks.length === 0,
    contract: "daytrade_intraday_burst_readback_readonly_v1",
    view: VIEW,
    health_view: HEALTH_VIEW,
    trade_date: tradeDate,
    symbol: symbol || null,
    rows: readback.rows.length,
    burst: row,
    burst_status: burstStatus,
    no_match: noMatch,
    market_session: marketSession,
    writer_health: { available: healthAvailable, rows: healthRows.length, healthy_rows: healthyRows.length, writer_alive: writerAlive, latest_writer_evidence: latestWriterEvidence, writer_evidence_age_seconds: writerEvidenceAgeSeconds, latest_candle_time: latestCandleTime, latest_candle_age_seconds: latestCandleAgeSeconds, stale: dataGap, read_error: healthReadError },
    failed_checks: failedChecks,
    first_blocker: failedChecks[0] || null,
    read_only: true,
  }, null, 2));
  process.exitCode = failedChecks.length ? 1 : 0;
}
main().catch((error) => { console.log(JSON.stringify({ ok: false, contract: "daytrade_intraday_burst_readback_readonly_v1", failed_checks: ["burst_readback_unavailable"], first_blocker: "burst_readback_unavailable", error: error?.message || String(error), read_only: true }, null, 2)); process.exitCode = 1; });
