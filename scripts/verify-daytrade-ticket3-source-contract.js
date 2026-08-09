"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const PROJECT_URL = process.env.SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co";
const LIVE = process.argv.includes("--live") || process.argv.includes("--require-live");
const REQUIRE_LIVE = process.argv.includes("--require-live");

function readSecret(name) {
  for (const file of [path.join(RUNTIME_DIR, "secrets", name), path.join(__dirname, "..", "secrets", name)]) {
    try { const value = fs.readFileSync(file, "utf8").trim(); if (value) return value; } catch {}
  }
  return "";
}

function readText(file) { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } }

async function readLive(key) {
  const base = PROJECT_URL.endsWith("/") ? PROJECT_URL.slice(0, -1) : PROJECT_URL;
  const response = await fetch(base + "/rest/v1/source_status?select=source_name,status,updated_at,payload&source_name=eq.fugle_daytrade_source&limit=1", {
    headers: { apikey: key, Authorization: "Bearer " + key, Accept: "application/json" },
    signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error("source_status HTTP " + response.status + ": " + text.slice(0, 240));
  const rows = text ? JSON.parse(text) : [];
  return Array.isArray(rows) ? rows[0] || {} : {};
}

async function main() {
  const root = path.join(__dirname, "..");
  const collector = readText(path.join(root, "scripts", "fugle-websocket-collector.js"));
  const writer = readText(path.join(root, "scripts", "run-daytrade-source-writer.js"));
  const writerWrapper = readText(path.join(root, "ops", "public-slot", "Run-DaytradeSourceWriter.ps1"));
  const issues = [];
  const staticChecks = {
    fullMarketUniverse: writer.includes("full_market_active_common_stock"),
    dynamicMotherPool: writer.includes("MOTHER_POOL_MIN_SYMBOLS") && writer.includes("buildPriorityPool"),
    websocketRotation: collector.includes("STREAMING_ROTATION_INTERVAL_MS") && collector.includes("rotationCycle") && collector.includes("rotatingSelectedCount"),
    websocketFreshnessEvidence: collector.includes("websocketLastMessageAt") && collector.includes("freshSymbols120s") && collector.includes("messageAgeSeconds <= 300"),
    dedicated0901Evidence: writer.includes("ensureOpening0901CandleEvidence") && writer.includes("opening_0901_candle_not_ready") && writer.includes("fugle_daytrade_intraday_1m"),
    writerEnsuresWebSocketCollector: writerWrapper.includes("Ensure-FugleWebSocketCollector") && writerWrapper.includes("Get-CimInstance Win32_Process") && writerWrapper.includes("FUGLE_STREAMING_CHANNELS") && writerWrapper.includes("FUGLE_STREAMING_MAX_TOTAL_SUBSCRIPTIONS"),
    noFormalSharedFallback: writer.includes("formal_source_alignment_ok") && writer.includes("opening0901Ready"),
  };
  for (const [name, ok] of Object.entries(staticChecks)) if (!ok) issues.push("static_" + name + "_missing");
  let live = null;
  if (LIVE) {
    const key = process.env.SUPABASE_ANON_KEY || readSecret("supabase-anon-key.txt");
    if (!key) issues.push("missing_supabase_anon_key");
    else {
      try {
        const row = await readLive(key);
        const payload = row.payload || {};
        const requiredFields = [
          "websocket_status_ok", "websocket_connected", "websocket_authenticated", "websocket_mode",
          "websocket_streaming_channels", "websocket_formal_ready", "websocket_last_message_at",
          "websocket_symbol_count", "websocket_fresh_symbols_120s", "opening_0901_candle_required",
          "opening_0901_candle_ready", "opening_0901_candle_trade_date", "opening_0901_candle_schema",
        ];
        const missingFields = requiredFields.filter((field) => !Object.prototype.hasOwnProperty.call(payload, field));
        if (REQUIRE_LIVE && missingFields.length) issues.push("live_missing_fields:" + missingFields.join(","));
        live = {
          sourceStatus: row.status || "",
          updatedAt: row.updated_at || "",
          missingFields,
          websocketFormalReady: payload.websocket_formal_ready,
          websocketLastMessageAt: payload.websocket_last_message_at,
          websocketSymbolCount: payload.websocket_symbol_count,
          websocketFreshSymbols120s: payload.websocket_fresh_symbols_120s,
          opening0901Required: payload.opening_0901_candle_required,
          opening0901Ready: payload.opening_0901_candle_ready,
          opening0901Source: payload.opening_0901_candle_source,
        };
      } catch (error) { issues.push("live_read_failed:" + (error.message || String(error))); }
    }
  }
  const result = { ok: issues.length === 0, mode: REQUIRE_LIVE ? "static_and_live_required" : LIVE ? "static_and_live" : "static", checkedAt: new Date().toISOString(), staticChecks, live, issues };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => { console.error("[daytrade-ticket3-source] " + (error.message || String(error))); process.exitCode = 2; });
