"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const lib = fs.readFileSync(path.join(ROOT, "lib", "terminal-main-force-costs.js"), "utf8");
const api = fs.readFileSync(path.join(ROOT, "api", "main-force-costs.js"), "utf8");
const fastBundle = fs.readFileSync(path.join(ROOT, "api", "terminal-fast-bundle.js"), "utf8");
const desktop = fs.readFileSync(path.join(ROOT, "terminal-desktop-fast-shell.js"), "utf8");
const strategy2 = fs.readFileSync(path.join(ROOT, "api", "strategy2-latest.js"), "utf8");
const strategy3 = fs.readFileSync(path.join(ROOT, "api", "strategy3-latest.shared-probe-legacy.js"), "utf8");
const strategy4 = fs.readFileSync(path.join(ROOT, "api", "strategy4-latest.js"), "utf8");
const strategy5 = fs.readFileSync(path.join(ROOT, "api", "strategy5-latest.js"), "utf8");
const institution = fs.readFileSync(path.join(ROOT, "api", "institution-latest.js"), "utf8");
const issues = [];

function check(condition, issue) {
  if (!condition) issues.push(issue);
}

function argValue(name, fallback) {
  const item = process.argv.find((value) => value.startsWith(`${name}=`));
  return item ? item.slice(name.length + 1) : fallback;
}

check(lib.includes('const VIEW = "v_terminal_main_force_latest";'), "main_force_view_contract_missing");
check(lib.includes('const MAIN_FORCE_FETCH_TIMEOUT_MS = 3000;'), 'main_force_timeout_budget_missing');
check(lib.includes('setTimeout(() => controller.abort(), Math.max(250, Number(timeoutMs) || MAIN_FORCE_FETCH_TIMEOUT_MS));'), 'main_force_timeout_abort_missing');
check(lib.includes('url.searchParams.set("trade_date", `eq.${asOfDate}`)'), "exact_trade_date_filter_missing");
check(lib.includes('if (!code || tradeDate !== asOfDate) return null;'), "stale_main_force_row_not_rejected");
check(lib.includes('if (/^\\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;'), "compact_trade_date_normalization_missing");
check(lib.includes('status: !ready ? "data_insufficient" : matched ? "matched" : matchedAnyStyle ? "not_matched" : "unclassified"'), "unclassified_style_state_missing");
check(api.includes('contract: "terminal-main-force-costs-v1"'), "main_force_api_contract_missing");
check(api.includes('freshnessRule: "exact_as_of_trade_date_only; missing_or_unclassified_never_uses_stale_data"'), "main_force_api_freshness_rule_missing");
check(fastBundle.includes('require("../lib/terminal-main-force-costs")'), "fast_bundle_main_force_import_missing");
check(fastBundle.includes('const MAIN_FORCE_ENDPOINTS = new Set(['), "fast_bundle_main_force_endpoint_scope_missing");
check(fastBundle.includes('async function attachMainForceCostsToEndpoints'), "fast_bundle_main_force_enrichment_missing");
check(fastBundle.includes("await attachMainForceCostsToEndpoints(endpoints);") && fastBundle.includes("attachSnapshotMainForcePlaceholders(endpoints);"), "fast_bundle_main_force_snapshot_or_live_attach_missing");
check(fastBundle.includes('source: "snapshot:client-hydration-pending"') && fastBundle.includes('status: "data_insufficient"'), "fast_bundle_main_force_snapshot_placeholder_missing");
check(fastBundle.includes('row.terminalMainForce = byCode.get(code) || null;'), "fast_bundle_main_force_row_contract_missing");
check(desktop.includes('function mainForceCostHtml(code, asOfDate)'), "desktop_main_force_card_missing");
check(desktop.includes("sunlight-decision-metrics-20260816") && desktop.includes("body.fuman-light-theme .three-gate-prices") && desktop.includes("font-size: 13px !important;") && desktop.includes("font-weight: 900 !important;"), "sunlight_decision_metrics_missing");
check(desktop.includes('fetch(`/api/main-force-costs?${query.toString()}`'), "desktop_main_force_batch_api_missing");
check(desktop.includes('須有同日正式分點資料'), "desktop_main_force_same_day_message_missing");
check(desktop.includes('style.status === "unclassified"') && desktop.includes('return `${label} 未分類`'), "desktop_main_force_unclassified_state_missing");
check(/\$\{threeGatePrices\}\r?\n\s+\$\{mainForceCosts\}/.test(desktop), "desktop_main_force_card_not_inserted");
check(desktop.includes('if (supportsMainForceCosts(route)) hydrateMainForceCosts(route, rows, previousGoodTradeDate || routeDataDate)'), "desktop_main_force_render_hydration_missing");
check(lib.includes('async function attachMainForceCostsToPayload'), "shared_main_force_payload_enrichment_missing");
check(lib.includes('payload.mainForceCostContract = {'), "shared_main_force_contract_missing");
check(strategy2.includes('await attachMainForceCostsToPayload(responsePayload);'), "strategy2_main_force_direct_api_missing");
check(strategy3.includes('await attachMainForceCostsToPayload(await applyStrategy3Entry1mGate'), "strategy3_main_force_direct_api_missing");
check(strategy4.includes('await attachMainForceCostsToPayload(cached);') && strategy4.includes('await attachMainForceCostsToPayload(payload);'), "strategy4_main_force_direct_or_snapshot_api_missing");
check(strategy5.includes('await attachMainForceCostsToPayload(cached);') && strategy5.includes('await attachMainForceCostsToPayload(payload);'), "strategy5_main_force_direct_or_snapshot_api_missing");
check(institution.includes('await attachMainForceCostsToPayload(cached);') && institution.includes('await attachMainForceCostsToPayload(payload);'), "institution_main_force_direct_or_snapshot_api_missing");

async function main() {
  if (process.argv.includes("--live")) {
    const { attachMainForceCostsToPayload, fetchMainForceCosts } = require("../lib/terminal-main-force-costs");
    const asOf = argValue("--date", "");
    const codes = argValue("--codes", "").split(",").filter(Boolean);
    if (!asOf || !codes.length) throw new Error("live_requires_date_and_codes");
    const result = await fetchMainForceCosts({ asOf, codes });
    check(result.asOfDate === asOf, "live_as_of_date_mismatch");
    const compactPayload = { tradeDate: asOf.replace(/-/g, ""), rows: codes.map((code) => ({ code })) };
    await attachMainForceCostsToPayload(compactPayload);
    check(compactPayload.mainForceCostContract?.asOfDate === asOf, "live_compact_trade_date_normalization_failed");
    for (const item of result.items) {
      const attached = compactPayload.rows.find((row) => row.code === item.code)?.terminalMainForce;
      check(attached?.tradeDate === asOf, `live_payload_attach_missing:${item.code}`);
    }

    for (const item of result.items) {
      check(item.tradeDate === asOf, `live_stale_item:${item.code}:${item.tradeDate}`);
      check(item.status === "ready", `live_item_not_ready:${item.code}:${item.status}`);
      check(Number(item.mainForceCostPrice) > 0, `live_cost_missing:${item.code}`);
      check(["unclassified", "matched", "not_matched"].includes(item.overnight?.status), `live_style_status_invalid:${item.code}`);
    }
    console.log(JSON.stringify({
      ok: issues.length === 0,
      status: issues.length === 0 ? "YES" : "NO",
      contract: "terminal-main-force-costs-v1",
      asOf,
      requestedCount: result.requestedCount,
      count: result.count,
      missingCodes: result.missingCodes,
      issues,
    }, null, 2));
  } else {
    console.log(JSON.stringify({
      ok: issues.length === 0,
      status: issues.length === 0 ? "YES" : "NO",
      contract: "terminal-main-force-costs-v1",
      checkedAt: new Date().toISOString(),
      issues,
    }, null, 2));
  }
  process.exit(issues.length ? 1 : 0);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, status: "NO", contract: "terminal-main-force-costs-v1", error: error?.message || String(error), issues }, null, 2));
  process.exit(1);
});