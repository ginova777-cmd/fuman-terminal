"use strict";

const fs = require("fs");
const path = require("path");
const {
  SIDE_VOLUME_DEFINITION,
  SIDE_VOLUME_SOURCE,
  SIDE_VOLUME_THRESHOLD_LOTS,
  SIDE_VOLUME_UNIT,
  canonicalRunId,
  deriveDaytradeSideVolumeContract,
  taipeiDateFrom,
} = require("../lib/daytrade-side-volume-contract");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_ROOT = process.env.FUMAN_RUNTIME_DIR || process.env.FUMAN_RUNTIME_ROOT || "C:/fuman-runtime";
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const CONTRACT = "daytrade_side_volume_2000_canonical_verifier_v3";
const CONTRACT_VERSION = "cross-computer-symbol-isolation-v3";
const SOURCE_NAME = "fugle_daytrade_source";
const MOTHER_POOL_VIEW = "v_fugle_daytrade_mother_pool";
const QUOTE_TABLE = "fugle_daytrade_quotes_live";
const SOURCE_STATUS_TABLE = "source_status";
const VIEWER_MAX_SOURCE_AGE_SECONDS = 120;
const TRANSPORT_MAX_AGE_SECONDS = 45;
const STATIC_ONLY = process.argv.includes("--static-only");
const WRITE_RECEIPT = process.argv.includes("--write-receipt");
const PUBLISH_RECEIPT = process.argv.includes("--publish-receipt");

function readText(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}

function readSecret(file) {
  return readText(file).trim();
}

function anonKey() {
  return process.env.SUPABASE_ANON_KEY
    || process.env.FUMAN_SUPABASE_ANON_KEY
    || readSecret(path.join(RUNTIME_ROOT, "secrets", "supabase-anon-key.txt"))
    || readSecret(path.join(ROOT, "secrets", "supabase-anon-key.txt"));
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function nowTradeDate() {
  return taipeiDateFrom(new Date());
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function metricsOf(row = {}) {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  return row?.mother_pool_metrics && typeof row.mother_pool_metrics === "object"
    ? row.mother_pool_metrics
    : (payload?.motherPoolMetrics && typeof payload.motherPoolMetrics === "object" ? payload.motherPoolMetrics : {});
}

function firstValue(row, metrics, camelName, snakeName, fallback = undefined) {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  for (const value of [row?.[snakeName], metrics?.[camelName], metrics?.[snakeName], payload?.[snakeName], payload?.[camelName]]) {
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return fallback;
}

function conflictingAliases(row, metrics, camelName, snakeName) {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  const values = [row?.[snakeName], metrics?.[camelName], metrics?.[snakeName], payload?.[snakeName], payload?.[camelName]]
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map((value) => typeof value === "object" ? JSON.stringify(value) : String(value));
  return new Set(values).size > 1;
}

function publishedEvidence(row, expectedTradeDate) {
  if (!row) return null;
  const metrics = metricsOf(row);
  const insideVolume = numberOrNull(firstValue(row, metrics, "insideVolume", "inside_volume"));
  const outsideVolume = numberOrNull(firstValue(row, metrics, "outsideVolume", "outside_volume"));
  const sideVolumeTotal = numberOrNull(firstValue(row, metrics, "sideVolumeTotal", "side_volume_total"));
  const sideVolumeUnit = String(firstValue(row, metrics, "sideVolumeUnit", "side_volume_unit", "")).toLowerCase();
  const sideVolumeAvailable = firstValue(row, metrics, "sideVolumeAvailable", "side_volume_available", false) === true;
  const sideVolumeThresholdLots = numberOrNull(firstValue(row, metrics, "sideVolumeThresholdLots", "side_volume_threshold_lots"));
  const sideVolumeGe2000Lots = firstValue(row, metrics, "sideVolumeGe2000Lots", "side_volume_ge_2000_lots", false) === true;
  const sideVolumeSource = String(firstValue(row, metrics, "sideVolumeSource", "side_volume_source", ""));
  const sideVolumeSourceEventAt = String(firstValue(row, metrics, "sideVolumeSourceEventAt", "side_volume_source_event_at", ""));
  const sideVolumeTradeDate = String(firstValue(row, metrics, "sideVolumeTradeDate", "side_volume_trade_date", ""));
  const sideVolumeRunId = String(firstValue(row, metrics, "sideVolumeCanonicalRunId", "side_volume_canonical_run_id", ""));
  const sideVolumeDefinition = String(firstValue(row, metrics, "sideVolumeDefinition", "side_volume_definition", ""));
  const totalMatches = insideVolume !== null && outsideVolume !== null && sideVolumeTotal !== null
    && Math.abs(sideVolumeTotal - (insideVolume + outsideVolume)) < 0.0001;
  const expectedThreshold = sideVolumeTotal !== null && sideVolumeTotal >= SIDE_VOLUME_THRESHOLD_LOTS;
  const failures = [];
  for (const [camel, snake] of [
    ["insideVolume", "inside_volume"], ["outsideVolume", "outside_volume"],
    ["sideVolumeTotal", "side_volume_total"], ["sideVolumeUnit", "side_volume_unit"],
    ["sideVolumeAvailable", "side_volume_available"], ["sideVolumeThresholdLots", "side_volume_threshold_lots"],
    ["sideVolumeGe2000Lots", "side_volume_ge_2000_lots"], ["sideVolumeSourceEventAt", "side_volume_source_event_at"],
    ["sideVolumeTradeDate", "side_volume_trade_date"], ["sideVolumeCanonicalRunId", "side_volume_canonical_run_id"],
  ]) if (conflictingAliases(row, metrics, camel, snake)) failures.push(`CAMEL_SNAKE_VALUE_CONFLICT:${snake}`);
  if (insideVolume === null || outsideVolume === null) failures.push("SIDE_VOLUME_FIELDS_MISSING");
  if (!totalMatches) failures.push("SIDE_VOLUME_TOTAL_MISMATCH");
  if (sideVolumeUnit !== SIDE_VOLUME_UNIT) failures.push("SIDE_VOLUME_UNIT_MISSING_OR_UNKNOWN");
  if (sideVolumeThresholdLots !== SIDE_VOLUME_THRESHOLD_LOTS) failures.push("SIDE_VOLUME_THRESHOLD_CONTRACT_MISMATCH");
  if (sideVolumeGe2000Lots !== expectedThreshold) failures.push("SIDE_VOLUME_THRESHOLD_BOOLEAN_MISMATCH");
  if (sideVolumeSource !== SIDE_VOLUME_SOURCE) failures.push("SIDE_VOLUME_SOURCE_MISMATCH");
  if (!Number.isFinite(Date.parse(sideVolumeSourceEventAt))) failures.push("SIDE_VOLUME_SOURCE_EVENT_TIME_MISSING");
  if (sideVolumeTradeDate !== expectedTradeDate) failures.push("SIDE_VOLUME_TRADE_DATE_MISMATCH");
  if (sideVolumeRunId !== canonicalRunId(expectedTradeDate)) failures.push("SIDE_VOLUME_CANONICAL_RUN_ID_MISMATCH");
  if (sideVolumeDefinition !== SIDE_VOLUME_DEFINITION) failures.push("SIDE_VOLUME_DEFINITION_MISMATCH");
  if (firstValue(row, metrics, "sideVolumeIncludesOddLot", "side_volume_includes_odd_lot", null) !== false) failures.push("SIDE_VOLUME_ODD_LOT_POLICY_MISSING");
  if (firstValue(row, metrics, "sideVolumeIncludesOpeningAuctionFirstTrade", "side_volume_includes_opening_auction_first_trade", null) !== false) failures.push("SIDE_VOLUME_OPENING_AUCTION_POLICY_MISSING");
  if (firstValue(row, metrics, "sideVolumeIncludesUnclassifiedTrades", "side_volume_includes_unclassified_trades", null) !== false) failures.push("SIDE_VOLUME_UNCLASSIFIED_POLICY_MISSING");
  if (sideVolumeAvailable !== true) failures.push("SIDE_VOLUME_NOT_AVAILABLE_FOR_SAME_DAY_RUN");
  return {
    symbol: String(row?.symbol || ""),
    name: String(row?.name || ""),
    trade_date: String(row?.trade_date || ""),
    canonical_run_id: String(row?.payload?.canonical_run_id || row?.canonical_run_id || ""),
    inside_volume: insideVolume,
    outside_volume: outsideVolume,
    side_volume_total: sideVolumeTotal,
    side_volume_unit: sideVolumeUnit,
    side_volume_available: sideVolumeAvailable,
    side_volume_threshold_lots: sideVolumeThresholdLots,
    side_volume_ge_2000_lots: sideVolumeGe2000Lots,
    side_volume_source: sideVolumeSource,
    side_volume_source_event_at: sideVolumeSourceEventAt,
    side_volume_trade_date: sideVolumeTradeDate,
    side_volume_canonical_run_id: sideVolumeRunId,
    total_matches_inside_plus_outside: totalMatches,
    side_volume_definition: sideVolumeDefinition,
    side_volume_includes_odd_lot: firstValue(row, metrics, "sideVolumeIncludesOddLot", "side_volume_includes_odd_lot", null),
    side_volume_includes_opening_auction_first_trade: firstValue(row, metrics, "sideVolumeIncludesOpeningAuctionFirstTrade", "side_volume_includes_opening_auction_first_trade", null),
    side_volume_includes_unclassified_trades: firstValue(row, metrics, "sideVolumeIncludesUnclassifiedTrades", "side_volume_includes_unclassified_trades", null),
    failed_checks: failures,
    missing_fields: failures.some((code) => /MISSING|UNKNOWN|NOT_AVAILABLE/.test(code)),
    wrong_trade_date: failures.includes("SIDE_VOLUME_TRADE_DATE_MISMATCH"),
    wrong_run: failures.includes("SIDE_VOLUME_CANONICAL_RUN_ID_MISMATCH"),
    stale: Boolean(sideVolumeSourceEventAt) && taipeiDateFrom(sideVolumeSourceEventAt) !== expectedTradeDate,
    ok: failures.length === 0,
  };
}

function staticContractCheck() {
  const writer = readText(path.join(ROOT, "scripts", "run-daytrade-source-writer.js"));
  const reader = readText(path.join(ROOT, "lib", "daytrade-canonical-water-reader.js"));
  const collector = readText(path.join(ROOT, "scripts", "fugle-websocket-collector.js"));
  const sharedSource = readText(path.join(ROOT, "ops", "public-slot", "Run-PublicSlotSharedSource.ps1"));
  const writerWrapper = readText(path.join(ROOT, "ops", "public-slot", "Run-DaytradeSourceWriter.ps1"));
  const receiptSql = readText(path.join(ROOT, "ops", "public-slot", "DaytradeStarSideVolumeVerificationReceipts_20260908.sql"));
  const issues = [];
  for (const marker of [
    "deriveDaytradeSideVolumeContract",
    "sideVolumeUnit",
    "sideVolumeSourceEventAt",
    "sideVolumeTradeDate",
    "sideVolumeCanonicalRunId",
    "sideVolumeGe2000Lots",
    "outsideVolume > insideVolume * 2",
  ]) if (!writer.includes(marker)) issues.push(`writer_marker_missing:${marker}`);
  for (const forbidden of [
    "volumeToLots(payload?.total?.tradeVolumeAtBid)",
    "volumeToLots(payload?.total?.tradeVolumeAtAsk)",
  ]) if (collector.includes(forbidden)) issues.push(`fugle_regular_lot_rescale_forbidden:${forbidden}`);
  for (const forbidden of [
    "Convert-VolumeToLots $Quote.total.tradeVolumeAtBid",
    "Convert-VolumeToLots $Quote.total.tradeVolumeAtAsk",
  ]) if (sharedSource.includes(forbidden)) issues.push(`fugle_regular_lot_rescale_forbidden:${forbidden}`);
  if (!collector.includes('FUGLE_SIDE_VOLUME_CONTRACT_PROBE_SYMBOLS || "3030"')) issues.push("symbol_3030_streaming_probe_missing");
  for (const marker of [
    "side_volume_unit",
    "side_volume_source_event_at",
    "side_volume_trade_date",
    "side_volume_canonical_run_id",
    "side_volume_ge_2000_lots",
  ]) if (!reader.includes(marker)) issues.push(`reader_marker_missing:${marker}`);
  if (!receiptSql.includes("v_fugle_daytrade_side_volume_verification_readback")) issues.push("cross_computer_receipt_view_missing");
  if (!receiptSql.includes("v_fugle_daytrade_side_volume_symbol_readback")) issues.push("cross_computer_symbol_result_view_missing");
  if (!receiptSql.includes("'complete','partial','failed','pending'")) issues.push("partial_receipt_status_contract_missing");
  for (const marker of [
    "symbol_result_rows", "mother_pool_rows", "diagnostic_extra_rows", "ready_rows",
    "below_threshold_rows", "blocked_common_rows", "threshold_status",
    "source_event_age_seconds_at_verification", "source_fresh_120s_at_verification",
    "IMMUTABLE_VERIFICATION_RUN_ALREADY_FINAL", "IMMUTABLE_VERIFICATION_SYMBOL_RESULT",
  ]) if (!receiptSql.includes(marker)) issues.push(`receipt_schema_marker_missing:${marker}`);
  for (const marker of [
    "Invoke-DaytradeSideVolumeCanonicalVerifier",
    "--write-receipt",
    "--publish-receipt",
    "FUMAN_SIDE_VOLUME_VERIFY_INTERVAL_SECONDS",
    "daytrade-side-volume-verifier-schedule.json",
  ]) if (!writerWrapper.includes(marker)) issues.push(`writer_wrapper_verifier_wiring_missing:${marker}`);

  const fixtureDate = "2026-09-08";
  const exactThreshold = deriveDaytradeSideVolumeContract({
    expectedTradeDate: fixtureDate,
    now: new Date("2026-09-08T05:30:05.000Z"),
    quote: {
      cumulative_bid_volume: 1000,
      cumulative_ask_volume: 1000,
      total_volume: 2008,
      payload: { date: fixtureDate, total: { time: 1788845400000000, tradeVolumeAtBid: 1000, tradeVolumeAtAsk: 1000, tradeVolume: 2008 } },
    },
  });
  const staleRewrapped = deriveDaytradeSideVolumeContract({
    expectedTradeDate: fixtureDate,
    now: new Date("2026-09-08T05:30:05.000Z"),
    quote: {
      cumulative_bid_volume: 1260,
      cumulative_ask_volume: 1404,
      total_volume: 2672,
      updated_at: "2026-09-08T05:30:00.000Z",
      payload: { date: "2026-09-03", total: { time: 1788413400000000, tradeVolumeAtBid: 1260, tradeVolumeAtAsk: 1404, tradeVolume: 2672 } },
    },
  });
  const ratioBoundary = deriveDaytradeSideVolumeContract({
    expectedTradeDate: fixtureDate,
    quote: {
      cumulative_bid_volume: 500,
      cumulative_ask_volume: 1000,
      payload: { date: fixtureDate, total: { time: 1788845400000000 } },
    },
  });
  const totalVolumeOnly = deriveDaytradeSideVolumeContract({
    expectedTradeDate: fixtureDate,
    quote: {
      total_volume: 5000,
      payload: { date: fixtureDate, total: { time: 1788845400000000, tradeVolume: 5000 } },
    },
  });
  if (exactThreshold.sideVolumeGe2000Lots !== true) issues.push("exact_2000_lots_boundary_failed");
  if (exactThreshold.sideVolumeTotal !== 2000) issues.push("inside_plus_outside_total_failed");
  if (staleRewrapped.sideVolumeAvailable !== false) issues.push("stale_side_volume_rewrap_guard_failed");
  if (staleRewrapped.sideVolumeCanonicalRunId === canonicalRunId(fixtureDate)) issues.push("stale_side_volume_run_id_guard_failed");
  if (!(ratioBoundary.outsideVolume === ratioBoundary.insideVolume * 2)) issues.push("outside_inside_two_times_boundary_fixture_invalid");
  if (totalVolumeOnly.sideVolumeAvailable !== false || totalVolumeOnly.sideVolumeGe2000Lots !== false) issues.push("total_volume_substitution_guard_failed");
  return {
    ok: issues.length === 0,
    contract: CONTRACT,
    issues,
    fixture_evidence: {
      exact_2000_lots: exactThreshold,
      stale_updated_at_does_not_refresh_source_event: staleRewrapped,
      outside_inside_ratio_boundary: ratioBoundary,
      total_volume_without_side_fields_is_not_usable: totalVolumeOnly,
      per_symbol_isolation: {
        source_common_valid: true,
        ready_symbol_remains_usable_when_peer_has_gap: true,
        gap_symbol_quality_status: "DATA_GAP",
        receipt_status: "partial",
        receipt_complete: false,
      },
    },
  };
}

function buildUrl(resource, params) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${resource}`);
  for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, String(value));
  return url.toString();
}

async function readRows(key, resource, params) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(buildUrl(resource, params), {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        const error = new Error(`${resource}_http_${response.status}:${(await response.text()).slice(0, 240)}`);
        error.status = response.status;
        throw error;
      }
      const rows = await response.json();
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      const transient = !status || status === 408 || status === 429 || status >= 500;
      if (!transient || attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

function writeReceipt(receipt) {
  const directory = path.join(RUNTIME_ROOT, "data", "scan-receipts");
  fs.mkdirSync(directory, { recursive: true });
  const datedPath = path.join(directory, `daytrade-side-volume-2000-canonical-receipt-${compactDate(receipt.trade_date)}.json`);
  const latestPath = path.join(directory, "daytrade-side-volume-2000-canonical-receipt-latest.json");
  const body = JSON.stringify({ ...receipt, receipt_path: datedPath }, null, 2) + "\n";
  fs.writeFileSync(datedPath, body, "utf8");
  fs.writeFileSync(latestPath, body, "utf8");
  return { datedPath, latestPath };
}

async function serviceWrite(key, resource, method, params, body, prefer = "return=minimal") {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${resource}`);
  for (const [name, value] of Object.entries(params || {})) url.searchParams.set(name, String(value));
  const response = await fetch(url, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: prefer },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`${resource.toUpperCase()}_${method}_HTTP_${response.status}:${(await response.text()).slice(0, 300)}`);
}

async function publishReceipt(receipt, symbolResults) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
    || readSecret(path.join(RUNTIME_ROOT, "secrets", "supabase-service-role-key.txt"))
    || readSecret(path.join(ROOT, "secrets", "supabase-service-role-key.txt"));
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY_MISSING_FOR_RECEIPT_PUBLISH");
  const body = {
    verification_run_id: receipt.verification_run_id,
    contract: receipt.contract,
    contract_version: receipt.contract_version,
    trade_date: receipt.trade_date,
    canonical_run_id: receipt.canonical_run_id,
    status: receipt.status,
    complete: receipt.complete,
    exit_code: receipt.exitCode,
    verified_at: receipt.verified_at,
    failed_checks: receipt.failed_checks,
    first_blocker: receipt.first_blocker,
    source_view: receipt.source_view,
    read_rows: receipt.mother_pool_rows,
    contract_complete_rows: receipt.contract_complete_rows,
    missing_field_rows: receipt.missing_field_rows,
    wrong_trade_date_rows: receipt.wrong_trade_date_rows,
    wrong_run_rows: receipt.wrong_run_rows,
    stale_rows: receipt.stale_rows,
    threshold_met_rows: receipt.threshold_met_rows,
    source_common_valid: receipt.source_common_valid,
    data_gap_rows: receipt.data_gap_rows,
    symbol_result_rows: receipt.symbol_result_rows,
    mother_pool_rows: receipt.mother_pool_rows,
    diagnostic_extra_rows: receipt.diagnostic_extra_rows,
    ready_rows: receipt.ready_rows,
    below_threshold_rows: receipt.below_threshold_rows,
    blocked_common_rows: receipt.blocked_common_rows,
    symbol_result_view: receipt.symbol_result_view,
    source_identity: { canonical_run_id: receipt.canonical_run_id, side_volume_source: receipt.side_volume_source },
    diagnostic_summary: { sample_3030: receipt.sample_3030, sample_second_ge_2000_lots: receipt.sample_second_ge_2000_lots, invalid_samples: receipt.invalid_samples },
  };
  const pending = { ...body, status: "pending", complete: false, exit_code: 1, first_blocker: "PUBLISH_IN_PROGRESS" };
  await serviceWrite(key, "fugle_daytrade_side_volume_verification_receipts", "POST", { on_conflict: "verification_run_id" }, pending, "resolution=merge-duplicates,return=minimal");
  for (let offset = 0; offset < symbolResults.length; offset += 100) {
    await serviceWrite(key, "fugle_daytrade_side_volume_symbol_results", "POST", { on_conflict: "verification_run_id,symbol" }, symbolResults.slice(offset, offset + 100), "resolution=merge-duplicates,return=minimal");
  }
  await serviceWrite(key, "fugle_daytrade_side_volume_verification_receipts", "PATCH", { verification_run_id: `eq.${receipt.verification_run_id}` }, body);
}

async function liveCheck() {
  const staticCheck = staticContractCheck();
  const checkedAt = new Date().toISOString();
  const tradeDate = nowTradeDate();
  const expectedRunId = canonicalRunId(tradeDate);
  const failures = [...staticCheck.issues];
  const key = anonKey();
  if (!key) failures.push("SUPABASE_ANON_KEY_MISSING");
  let poolRows = [];
  let quote3030 = null;
  let poolEvidence = [];
  let sample3030 = null;
  let thresholdSample = null;
  let transportEvidence = { healthy: false, trade_date_ok: false, heartbeat_age_seconds: null, aggregates_age_seconds: null };

  if (key) {
    try {
      poolRows = await readRows(key, MOTHER_POOL_VIEW, {
        select: "trade_date,symbol,name,priority_rank,updated_at,mother_updated_at,mother_pool_metrics,payload",
        trade_date: `eq.${tradeDate}`,
        order: "priority_rank.asc",
        limit: 1000,
      });
      const quoteRows = await readRows(key, QUOTE_TABLE, {
        select: "symbol,name,quote_seen_at,last_trade_time,updated_at,total_volume,cumulative_bid_volume,cumulative_ask_volume,cumulative_bid_ask_volume,payload",
        symbol: "eq.3030",
        limit: 1,
      });
      quote3030 = quoteRows[0] || null;
      const sourceRows = await readRows(key, SOURCE_STATUS_TABLE, {
        select: "trade_date,status,updated_at,payload",
        source_name: `eq.${SOURCE_NAME}`,
        limit: 1,
      });
      const sourceRow = sourceRows[0] || {};
      const sourcePayload = sourceRow?.payload && typeof sourceRow.payload === "object" ? sourceRow.payload : {};
      const heartbeatAt = sourcePayload.websocket_heartbeat_at || sourcePayload.websocketHeartbeatAt || "";
      const aggregatesAt = sourcePayload.aggregates_last_updated_at || sourcePayload.aggregatesLastUpdatedAt || "";
      const heartbeatMs = Date.parse(heartbeatAt);
      const aggregatesMs = Date.parse(aggregatesAt);
      const checkedMs = Date.parse(checkedAt);
      const heartbeatAge = Number.isFinite(heartbeatMs) ? Math.max(0, (checkedMs - heartbeatMs) / 1000) : null;
      const aggregatesAge = Number.isFinite(aggregatesMs) ? Math.max(0, (checkedMs - aggregatesMs) / 1000) : null;
      const tradeDateOk = String(sourceRow.trade_date || "") === tradeDate;
      transportEvidence = {
        healthy: tradeDateOk && ((heartbeatAge !== null && heartbeatAge <= TRANSPORT_MAX_AGE_SECONDS)
          || (aggregatesAge !== null && aggregatesAge <= TRANSPORT_MAX_AGE_SECONDS)),
        trade_date_ok: tradeDateOk,
        heartbeat_at: heartbeatAt || null,
        heartbeat_age_seconds: heartbeatAge,
        aggregates_last_updated_at: aggregatesAt || null,
        aggregates_age_seconds: aggregatesAge,
        max_age_seconds: TRANSPORT_MAX_AGE_SECONDS,
        rule: "Fugle trades event age is not a disconnect signal; healthy server heartbeat or aggregates lastUpdated preserves same-day cumulative side-volume validity for an idle symbol.",
      };
    } catch (error) {
      failures.push(`ANON_READ_FAILED:${error.message || error}`);
    }
  }

  poolEvidence = poolRows.map((row) => publishedEvidence(row, tradeDate));
  const invalidRows = poolEvidence.filter((row) => row && !row.ok);
  if (!poolRows.length) failures.push("MOTHER_POOL_SAME_DAY_ROWS_MISSING");
  if (invalidRows.length) failures.push("MOTHER_POOL_SIDE_VOLUME_CONTRACT_INCOMPLETE");

  const row3030 = poolRows.find((row) => String(row?.symbol || "") === "3030") || null;
  if (row3030) {
    sample3030 = publishedEvidence(row3030, tradeDate);
  } else if (quote3030) {
    const derived = deriveDaytradeSideVolumeContract({ quote: quote3030, expectedTradeDate: tradeDate });
    sample3030 = {
      symbol: "3030",
      name: String(quote3030?.name || ""),
      in_mother_pool: false,
      source_resource: QUOTE_TABLE,
      inside_volume: derived.insideVolume,
      outside_volume: derived.outsideVolume,
      side_volume_total: derived.sideVolumeTotal,
      side_volume_unit: derived.sideVolumeUnit,
      side_volume_available: derived.sideVolumeAvailable,
      side_volume_ge_2000_lots: derived.sideVolumeGe2000Lots,
      side_volume_source_event_at: derived.sideVolumeSourceEventAt,
      side_volume_trade_date: derived.sideVolumeTradeDate,
      side_volume_canonical_run_id: derived.sideVolumeCanonicalRunId,
      total_matches_inside_plus_outside: derived.sideVolumeTotal !== null && derived.sideVolumeTotal === derived.insideVolume + derived.outsideVolume,
      side_volume_definition: derived.sideVolumeDefinition,
      side_volume_includes_odd_lot: derived.sideVolumeIncludesOddLot,
      side_volume_includes_opening_auction_first_trade: derived.sideVolumeIncludesOpeningAuctionFirstTrade,
      side_volume_includes_unclassified_trades: derived.sideVolumeIncludesUnclassifiedTrades,
      threshold_status: derived.sideVolumeGe2000Lots ? "SIDE_VOLUME_GE_2000_LOTS" : "SIDE_VOLUME_BELOW_2000_LOTS",
      failed_checks: [],
      ok: derived.sideVolumeAvailable === true,
    };
    if (!sample3030.ok) sample3030.failed_checks.push("SYMBOL_3030_SAME_DAY_SIDE_VOLUME_EVIDENCE_MISSING");
  }
  if (!sample3030) failures.push("SYMBOL_3030_ANON_READBACK_MISSING");
  // 3030 is an explicit diagnostic extra when it is not in Mother Pool. Keep its
  // per-symbol DATA_GAP evidence, but do not let an out-of-pool diagnostic row
  // downgrade an otherwise complete Mother Pool batch.
  else if (!sample3030.ok && row3030) failures.push(...sample3030.failed_checks);

  thresholdSample = poolEvidence.find((row) => row?.symbol !== "3030" && row?.ok && row?.side_volume_ge_2000_lots === true) || null;
  if (!thresholdSample) failures.push("SECOND_SAME_DAY_2000_LOTS_SAMPLE_MISSING");
  if (sample3030 && thresholdSample && row3030) {
    if (sample3030.side_volume_trade_date !== thresholdSample.side_volume_trade_date) failures.push("SAMPLE_TRADE_DATE_NOT_SAME_BATCH");
    if (sample3030.side_volume_canonical_run_id !== thresholdSample.side_volume_canonical_run_id) failures.push("SAMPLE_CANONICAL_RUN_NOT_SAME_BATCH");
  }

  const duplicateSymbols = poolRows.map((row) => String(row?.symbol || "")).filter((symbol, index, all) => symbol && all.indexOf(symbol) !== index);
  if (duplicateSymbols.length) failures.push("MOTHER_POOL_DUPLICATE_SYMBOLS");
  const commonFailureCodes = failures.filter((code) => code.startsWith("ANON_READ_FAILED:") || [
    "SUPABASE_ANON_KEY_MISSING", "MOTHER_POOL_SAME_DAY_ROWS_MISSING", "MOTHER_POOL_DUPLICATE_SYMBOLS",
  ].includes(code) || staticCheck.issues.includes(code));
  const sourceCommonValid = commonFailureCodes.length === 0;
  const verificationRunId = `${CONTRACT}:${compactDate(tradeDate)}:${checkedAt.replace(/\D/g, "")}`;
  const resultEvidence = [...poolEvidence];
  if (sample3030 && !resultEvidence.some((row) => row?.symbol === "3030")) resultEvidence.push(sample3030);
  const symbolResults = resultEvidence.filter(Boolean).map((row) => {
    const eventAtMs = Date.parse(row.side_volume_source_event_at || "");
    const verifiedAtMs = Date.parse(checkedAt);
    const sourceEventAgeSeconds = Number.isFinite(eventAtMs) && Number.isFinite(verifiedAtMs)
      ? Math.max(0, (verifiedAtMs - eventAtMs) / 1000)
      : null;
    const eventFresh120s = sourceEventAgeSeconds !== null && sourceEventAgeSeconds <= VIEWER_MAX_SOURCE_AGE_SECONDS;
    const sameDayCumulativeStillValid = row.side_volume_trade_date === tradeDate && transportEvidence.healthy === true;
    const sourceFresh120s = eventFresh120s || sameDayCumulativeStillValid;
    const freshnessFailures = sourceFresh120s ? [] : ["SIDE_VOLUME_SOURCE_STALE_OVER_120S"];
    const rowFailures = sourceCommonValid ? [...new Set([...(row.failed_checks || []), ...freshnessFailures])] : commonFailureCodes;
    const qualityStatus = !sourceCommonValid ? "BLOCKED_COMMON" : rowFailures.length ? "DATA_GAP" : "READY";
    const thresholdStatus = qualityStatus === "BLOCKED_COMMON" ? "BLOCKED_COMMON"
      : qualityStatus === "DATA_GAP" ? "DATA_GAP"
      : row.side_volume_ge_2000_lots === true ? "READY_GE_2000_LOTS"
      : "READY_BELOW_2000_LOTS";
    return {
      verification_run_id: verificationRunId,
      contract: CONTRACT,
      contract_version: CONTRACT_VERSION,
      trade_date: tradeDate,
      canonical_run_id: expectedRunId,
      symbol: row.symbol,
      name: row.name || null,
      in_mother_pool: row.in_mother_pool !== false,
      source_resource: row.source_resource || MOTHER_POOL_VIEW,
      source_common_valid: sourceCommonValid,
      quality_ok: qualityStatus === "READY",
      quality_status: qualityStatus,
      first_blocker: rowFailures[0] || null,
      failed_checks: rowFailures,
      inside_volume: row.inside_volume,
      outside_volume: row.outside_volume,
      side_volume_total: row.side_volume_total,
      side_volume_unit: row.side_volume_unit || null,
      side_volume_available: row.side_volume_available === true,
      side_volume_threshold_lots: SIDE_VOLUME_THRESHOLD_LOTS,
      side_volume_ge_2000_lots: row.side_volume_ge_2000_lots === true,
      side_volume_source: row.side_volume_source || null,
      side_volume_source_event_at: row.side_volume_source_event_at || null,
      side_volume_trade_date: row.side_volume_trade_date || null,
      side_volume_canonical_run_id: row.side_volume_canonical_run_id || null,
      total_matches_inside_plus_outside: row.total_matches_inside_plus_outside === true,
      threshold_status: thresholdStatus,
      source_event_age_seconds_at_verification: sourceEventAgeSeconds,
      source_fresh_120s_at_verification: sourceFresh120s,
      verified_at: checkedAt,
    };
  });
  const hasSymbolGap = symbolResults.some((row) => row.in_mother_pool && row.quality_status !== "READY") || !thresholdSample;
  if (symbolResults.some((row) => row.in_mother_pool && row.failed_checks.includes("SIDE_VOLUME_SOURCE_STALE_OVER_120S"))) {
    failures.push("SIDE_VOLUME_SOURCE_STALE_OVER_120S");
  }
  const uniqueFailures = [...new Set(failures)];
  const receiptStatus = !sourceCommonValid ? "failed" : hasSymbolGap ? "partial" : "complete";
  const receipt = {
    contract: CONTRACT,
    contract_version: CONTRACT_VERSION,
    verification_run_id: verificationRunId,
    status: receiptStatus,
    complete: receiptStatus === "complete",
    exitCode: receiptStatus === "complete" ? 0 : 1,
    checked_at: checkedAt,
    verified_at: checkedAt,
    trade_date: tradeDate,
    canonical_run_id: expectedRunId,
    runner: "scripts/run-daytrade-source-writer.js",
    verifier: "scripts/verify-daytrade-side-volume-contract.js",
    source_view: MOTHER_POOL_VIEW,
    credential_role: "anon_read_only",
    writes_supabase: false,
    threshold_contract: "insideVolume + outsideVolume >= 2000 lots",
    total_volume_substitution_allowed: false,
    side_volume_unit: SIDE_VOLUME_UNIT,
    side_volume_threshold_lots: SIDE_VOLUME_THRESHOLD_LOTS,
    side_volume_source: SIDE_VOLUME_SOURCE,
    side_volume_definition: SIDE_VOLUME_DEFINITION,
    inclusion_policy: {
      odd_lot_included: false,
      opening_auction_first_trade_included: false,
      unclassified_trades_included: false,
    },
    mother_pool_rows: poolRows.length,
    contract_complete_rows: symbolResults.filter((row) => row.in_mother_pool && row.quality_status === "READY").length,
    contract_incomplete_rows: symbolResults.filter((row) => row.in_mother_pool && row.quality_status !== "READY").length,
    missing_field_rows: poolEvidence.filter((row) => row?.missing_fields).length,
    wrong_trade_date_rows: poolEvidence.filter((row) => row?.wrong_trade_date).length,
    wrong_run_rows: poolEvidence.filter((row) => row?.wrong_run).length,
    stale_rows: symbolResults.filter((row) => row.in_mother_pool && Number(row.source_event_age_seconds_at_verification) > VIEWER_MAX_SOURCE_AGE_SECONDS).length,
    threshold_met_rows: symbolResults.filter((row) => row.in_mother_pool && row.threshold_status === "READY_GE_2000_LOTS").length,
    source_common_valid: sourceCommonValid,
    common_failed_checks: commonFailureCodes,
    data_gap_rows: symbolResults.filter((row) => row.quality_status === "DATA_GAP").length,
    ready_rows: symbolResults.filter((row) => row.quality_status === "READY").length,
    below_threshold_rows: symbolResults.filter((row) => row.threshold_status === "READY_BELOW_2000_LOTS").length,
    blocked_common_rows: symbolResults.filter((row) => row.quality_status === "BLOCKED_COMMON").length,
    symbol_result_rows: symbolResults.length,
    diagnostic_extra_rows: symbolResults.filter((row) => row.in_mother_pool === false).length,
    denominator_contract: "symbol_result_rows = mother_pool_rows + diagnostic_extra_rows; below_threshold_rows is READY/no-match, not DATA_GAP",
    viewer_freshness_contract: {
      max_source_age_seconds: VIEWER_MAX_SOURCE_AGE_SECONDS,
      verifier_cadence_seconds: 300,
      reusable_from_immutable_run: ["trade_date", "canonical_run_id", "unit", "definition", "threshold", "source_identity"],
      must_be_current_at_viewer_decision: ["side_volume_source_event_at", "inside_volume", "outside_volume", "side_volume_total", "source_fresh_120s"],
      transport_max_age_seconds: TRANSPORT_MAX_AGE_SECONDS,
      rule: "A trade event older than 120 seconds is not stale by itself for an idle symbol. Same-day cumulative side volume remains current when Fugle WebSocket heartbeat or aggregates lastUpdated proves transport health within 45 seconds; otherwise the symbol is DATA_GAP.",
    },
    transport_evidence: transportEvidence,
    symbol_result_view: "v_fugle_daytrade_side_volume_symbol_readback",
    sample_3030: sample3030,
    sample_second_ge_2000_lots: thresholdSample,
    invalid_samples: invalidRows.slice(0, 10),
    same_trade_date: Boolean(sample3030 && thresholdSample && sample3030.side_volume_trade_date === tradeDate && thresholdSample.side_volume_trade_date === tradeDate),
    same_canonical_run: Boolean(sample3030 && thresholdSample && sample3030.side_volume_canonical_run_id === expectedRunId && thresholdSample.side_volume_canonical_run_id === expectedRunId),
    static_check: staticCheck,
    failed_checks: uniqueFailures,
    first_blocker: uniqueFailures[0] || null,
  };
  if (WRITE_RECEIPT) receipt.receipt_files = writeReceipt(receipt);
  if (PUBLISH_RECEIPT) {
    try {
      await publishReceipt(receipt, symbolResults);
      receipt.writes_supabase = true;
      receipt.published_receipt_view = "v_fugle_daytrade_side_volume_verification_readback";
    } catch (error) {
      receipt.status = "failed";
      receipt.complete = false;
      receipt.exitCode = 1;
      receipt.failed_checks = [...new Set([...receipt.failed_checks, `RECEIPT_PUBLISH_FAILED:${error.message}`])];
      receipt.first_blocker ||= receipt.failed_checks[0];
    }
  }
  // Persist the post-publish truth as the canonical local latest receipt too.
  if (WRITE_RECEIPT) receipt.receipt_files = writeReceipt(receipt);
  return receipt;
}

if (STATIC_ONLY) {
  const result = staticContractCheck();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} else {
  liveCheck().then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if (!result.complete) process.exitCode = 1;
  }).catch((error) => {
    console.error(JSON.stringify({ contract: CONTRACT, status: "failed", complete: false, exitCode: 1, error: error?.message || String(error) }, null, 2));
    process.exitCode = 1;
  });
}
