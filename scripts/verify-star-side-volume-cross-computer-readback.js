"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const URL_ROOT = String(process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_ANON_KEY || process.env.FUMAN_SUPABASE_ANON_KEY || (() => { try { return fs.readFileSync(path.join(RUNTIME, "secrets", "supabase-anon-key.txt"), "utf8").trim(); } catch { return ""; } })();
const tradeDate = process.argv.find((value) => value.startsWith("--trade-date="))?.split("=")[1]
  || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const compact = tradeDate.replace(/\D/g, "");

async function readLatest(view, canonicalRunId) {
  const url = new URL(`${URL_ROOT}/rest/v1/${view}`);
  for (const [name, value] of Object.entries({ select: "*", trade_date: `eq.${tradeDate}`, canonical_run_id: `eq.${canonicalRunId}`, order: "verified_at.desc", limit: "1" })) url.searchParams.set(name, value);
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
      const text = await response.text();
      if (!response.ok) throw new Error(`${view}_HTTP_${response.status}:${text.slice(0, 240)}`);
      return { http_status: response.status, row: (JSON.parse(text) || [])[0] || null, attempts: attempt };
    } catch (error) { lastError = error; if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500)); }
  }
  throw lastError;
}

async function main() {
  if (!KEY) throw new Error("SUPABASE_ANON_KEY_MISSING");
  const targets = [
    ["star", "v_fugle_daytrade_star_verification_readback", `star_preopen:${compact}:canonical`],
    ["side_volume", "v_fugle_daytrade_side_volume_verification_readback", `fugle_daytrade_source:${compact}:canonical`],
  ];
  const results = {};
  const failed = [];
  for (const [name, view, runId] of targets) {
    try {
      const result = await readLatest(view, runId);
      results[name] = { view, expected_canonical_run_id: runId, ...result };
      if (!result.row) failed.push(`${name.toUpperCase()}_CANONICAL_RECEIPT_MISSING`);
      else if (result.row.complete !== true || result.row.status !== "complete" || Number(result.row.exit_code) !== 0) failed.push(`${name.toUpperCase()}_CANONICAL_RECEIPT_INCOMPLETE:${result.row.first_blocker || "UNKNOWN"}`);
    } catch (error) { results[name] = { view, expected_canonical_run_id: runId, error: error.message }; failed.push(`${name.toUpperCase()}_ANON_READ_FAILED`); }
  }
  const output = { contract: "star_side_volume_cross_computer_readback_v1", trade_date: tradeDate, credential_role: "anon_read_only", bounded_retry_max: 3, batch_mixing_allowed: false, writes_supabase: false, status: failed.length ? "failed" : "complete", complete: failed.length === 0, exitCode: failed.length ? 1 : 0, results, failed_checks: failed, first_blocker: failed[0] || null, checked_at: new Date().toISOString() };
  console.log(JSON.stringify(output, null, 2));
  if (!output.complete) process.exitCode = 1;
}

main().catch((error) => { console.error(JSON.stringify({ contract: "star_side_volume_cross_computer_readback_v1", status: "failed", complete: false, exitCode: 1, failed_checks: [error.message], first_blocker: error.message }, null, 2)); process.exitCode = 1; });
