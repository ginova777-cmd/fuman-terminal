"use strict";

const assert = require("assert");

const base = String(process.env.FUMAN_TERMINAL_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const timeoutMs = Number(process.env.FUMAN_OPENING_REPORT_BRIEFING_TIMEOUT_MS || 12000);

async function main() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${base}/api/market-ai-live?briefingOnly=1`, {
      cache: "no-store",
      signal: controller.signal,
    });
    assert.equal(response.status, 200, `briefing-only HTTP ${response.status}`);
    const payload = await response.json();
    const report = payload?.openingMorningReport;
    assert.equal(payload?.ok, true, `briefing-only unavailable: ${payload?.reason_code || "unknown"}`);
    assert.equal(report?.ok, true, `briefing invalid: ${report?.reason_code || "unknown"}`);
    assert(report?.run_id, "briefing run_id missing");
    assert(Number(report?.industry_bias?.count || 0) >= 19, "industry bias receipt incomplete");
    console.log(JSON.stringify({
      ok: true,
      contract: "opening_report_0830_briefing_only_live_v1",
      endpoint: "/api/market-ai-live?briefingOnly=1",
      elapsed_ms: Date.now() - startedAt,
      run_id: report.run_id,
      industry_bias_files: report.industry_bias.count,
      priority_industries: Array.isArray(report.priority_industries) ? report.priority_industries.length : 0,
      recommended_symbols: Array.isArray(report.recommended_symbols) ? report.recommended_symbols.length : 0,
      failed_checks: [],
      first_blocker: null,
      read_only: true,
    }, null, 2));
  } finally {
    clearTimeout(timer);
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
