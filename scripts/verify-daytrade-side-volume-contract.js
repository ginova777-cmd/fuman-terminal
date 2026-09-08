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
const CONTRACT = "daytrade_side_volume_2000_canonical_verifier_v1";
const MOTHER_POOL_VIEW = "v_fugle_daytrade_mother_pool";
const QUOTE_TABLE = "fugle_daytrade_quotes_live";
const STATIC_ONLY = process.argv.includes("--static-only");
const WRITE_RECEIPT = process.argv.includes("--write-receipt");

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
    failed_checks: failures,
    ok: failures.length === 0,
  };
}

function staticContractCheck() {
  const writer = readText(path.join(ROOT, "scripts", "run-daytrade-source-writer.js"));
  const reader = readText(path.join(ROOT, "lib", "daytrade-canonical-water-reader.js"));
  const collector = readText(path.join(ROOT, "scripts", "fugle-websocket-collector.js"));
  const sharedSource = readText(path.join(ROOT, "ops", "public-slot", "Run-PublicSlotSharedSource.ps1"));
  const issues = [];
  for (const marker of [
    "deriveDaytradeSideVolumeContract",
    "sideVolumeUnit",
    "sideVolumeSourceEventAt",
    "sideVolumeTradeDate",
    "sideVolumeCanonicalRunId",
    "sideVolumeGe2000Lots",
    "outsideVolume >= insideVolume * 2",
  ]) if (!writer.includes(marker)) issues.push(`writer_marker_missing:${marker}`);
  if (writer.includes("outsideVolume > insideVolume * 2")) issues.push("strict_greater_than_two_times_rule_still_present");
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
  if (!(ratioBoundary.outsideVolume >= ratioBoundary.insideVolume * 2)) issues.push("outside_inside_two_times_boundary_failed");
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
      threshold_status: derived.sideVolumeGe2000Lots ? "SIDE_VOLUME_GE_2000_LOTS" : "SIDE_VOLUME_BELOW_2000_LOTS",
      failed_checks: [],
      ok: derived.sideVolumeAvailable === true,
    };
    if (!sample3030.ok) sample3030.failed_checks.push("SYMBOL_3030_SAME_DAY_SIDE_VOLUME_EVIDENCE_MISSING");
  }
  if (!sample3030) failures.push("SYMBOL_3030_ANON_READBACK_MISSING");
  else if (!sample3030.ok) failures.push(...sample3030.failed_checks);

  thresholdSample = poolEvidence.find((row) => row?.symbol !== "3030" && row?.ok && row?.side_volume_ge_2000_lots === true) || null;
  if (!thresholdSample) failures.push("SECOND_SAME_DAY_2000_LOTS_SAMPLE_MISSING");
  if (sample3030 && thresholdSample) {
    if (sample3030.side_volume_trade_date !== thresholdSample.side_volume_trade_date) failures.push("SAMPLE_TRADE_DATE_NOT_SAME_BATCH");
    if (sample3030.side_volume_canonical_run_id !== thresholdSample.side_volume_canonical_run_id) failures.push("SAMPLE_CANONICAL_RUN_NOT_SAME_BATCH");
  }

  const uniqueFailures = [...new Set(failures)];
  const receipt = {
    contract: CONTRACT,
    status: uniqueFailures.length ? "failed" : "complete",
    complete: uniqueFailures.length === 0,
    exitCode: uniqueFailures.length ? 1 : 0,
    checked_at: checkedAt,
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
    contract_complete_rows: poolEvidence.length - invalidRows.length,
    contract_incomplete_rows: invalidRows.length,
    threshold_met_rows: poolEvidence.filter((row) => row?.ok && row?.side_volume_ge_2000_lots === true).length,
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
