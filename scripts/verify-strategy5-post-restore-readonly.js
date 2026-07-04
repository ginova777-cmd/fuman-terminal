"use strict";

const assert = require("assert");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");
const strategy5Api = require("../api/strategy5-latest");
const { adaptStrategy5Payload } = require("./strategy5-prewater-payload-adapter");
const { verifyCanonical } = require("./verify-strategy5-prewater-fixtures");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });
const RUN_VIEW = process.env.STRATEGY5_SUPABASE_LATEST_RUN_VIEW || "v_strategy5_latest_complete_run";
const RESULTS_TABLE = process.env.STRATEGY5_SUPABASE_RESULTS_TABLE || "strategy5_scan_results";

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function requireConfirmedReadonly() {
  if (!process.argv.includes("--confirm-readonly-supabase")) {
    throw new Error("refusing_to_touch_supabase_without_--confirm-readonly-supabase");
  }
}

async function fetchJson(tableOrView, query, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${tableOrView}?${query}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
      ...(options.count ? { Prefer: "count=exact" } : {}),
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${tableOrView} HTTP ${response.status} ${text.slice(0, 200)}`.trim());
  }
  const rows = await response.json();
  const countHeader = response.headers.get("content-range") || "";
  const exactCount = Number(countHeader.split("/").pop());
  return {
    rows: Array.isArray(rows) ? rows : [],
    exactCount: Number.isFinite(exactCount) ? exactCount : null,
  };
}

function assertNoBusinessBlanks(payload) {
  const blankCounts = payload.run_quality_at_publish?.blankCounts || payload.blankCounts || {};
  const offenders = Object.entries(blankCounts).filter(([, value]) => cleanNumber(value) > 0);
  assert.strictEqual(offenders.length, 0, `business field blanks: ${JSON.stringify(offenders)}`);
}

async function main() {
  requireConfirmedReadonly();
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("supabase_url_or_key_missing");

  const health = (await fetchJson(
    "v_institution_source_health",
    "select=coverage_status,latest_trade_date,institutional_rows,margin_rows,unified_rows,valid_after_exclusion_rows,min_required_rows,stale_days,reason,unified_latest_updated_at,margin_latest_updated_at,institutional_latest_updated_at,suggested_scanner_behavior&limit=1"
  )).rows[0] || null;

  const run = (await fetchJson(
    RUN_VIEW,
    "select=*&strategy=eq.strategy5&status=eq.complete&complete=eq.true&limit=1"
  )).rows[0] || null;
  if (!run?.run_id) throw new Error("strategy5_latest_complete_run_missing");

  const result = await fetchJson(
    RESULTS_TABLE,
    [
      "select=run_id,scan_date,code,name,price,close,change_percent,volume,trade_volume,trade_value,score,rank,reason,signals,payload,complete,quality_status,schema_version,data_contract_source,generated_at,updated_at",
      "strategy=eq.strategy5",
      `run_id=eq.${encodeURIComponent(run.run_id)}`,
      "complete=eq.true",
      "order=rank.asc",
      "limit=2000",
    ].join("&"),
    { count: true }
  );
  const readbackCount = result.exactCount ?? result.rows.length;
  const runWithReadback = { ...run, readback_count: readbackCount };
  const payload = strategy5Api._test.buildPayload(result.rows, runWithReadback, {
    canvas: true,
    chipSourceHealth: health,
  });
  payload.latestPointerUpdated = payload.publishGate?.latestOverwriteAllowed === true;
  payload.blockedReceiptWritten = payload.publishGate?.publishAllowed === true ? false : true;

  const canonical = verifyCanonical("strategy5-post-restore-readonly", adaptStrategy5Payload(payload, { type: "api" }));
  assert.strictEqual(canonical.ok, true, canonical.issues.join(","));
  assertNoBusinessBlanks(payload);
  assert.strictEqual(readbackCount, cleanNumber(run.result_count), `readback mismatch ${readbackCount}/${run.result_count}`);

  console.log(JSON.stringify({
    ok: true,
    mode: "readonly-supabase-post-restore",
    runId: run.run_id,
    sourceHealth: health?.coverage_status || "",
    resultCount: cleanNumber(run.result_count),
    readbackCount,
    evidenceStatus: payload.evidenceStatus,
    unattendedStatus: payload.unattendedStatus,
    tablesRead: ["v_institution_source_health", RUN_VIEW, RESULTS_TABLE],
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exit(1);
  });
}
