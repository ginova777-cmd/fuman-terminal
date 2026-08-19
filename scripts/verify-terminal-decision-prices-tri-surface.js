"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const issues = [];
function read(relativePath) { return fs.readFileSync(path.join(ROOT, relativePath), "utf8"); }
function check(ok, issue) { if (!ok) issues.push(issue); }

const apiFiles = [
  "api/strategy2-latest.js",
  "api/strategy3-latest.shared-probe-legacy.js",
  "api/strategy4-latest.js",
  "api/strategy5-latest.js",
  "api/institution-latest.js",
];

const gateLib = read("lib/terminal-three-gate-prices.js");
const mainForceLib = read("lib/terminal-main-force-costs.js");
const desktop = read("terminal-desktop-fast-shell.js");
const mobile = read("api/mobile-fragment.js");
const fastBundle = read("api/terminal-fast-bundle.js");
const sw = read("fuman-sw.js");
const pkg = read("package.json");
const snapshotCache = read("lib/desktop-route-snapshot-cache.js");
const snapshotBuilder = read("lib/desktop-route-snapshot-builder.js");

check(gateLib.includes("previous_formal_daily_ohlcv_only; reference_date_must_be_before_as_of_date"), "api_gate_freshness_rule_missing");
check(gateLib.includes("row.terminalThreeGate = byCode.get(code) || null"), "api_three_gate_row_field_missing");
check(mainForceLib.includes("const MAX_CODES = 300;"), "api_main_force_batch_coverage_below_300");
check(gateLib.includes("trade_date.desc,symbol.asc"), "api_three_gate_latest_daily_order_missing");
for (const file of apiFiles) {
  const source = read(file);
  check(source.includes("terminal-three-gate-prices"), `api_import_missing:${file}`);
  check(source.includes("attachThreeGatePricesToPayload"), `api_enrichment_missing:${file}`);
  check(source.includes("attachMainForceCostsToPayload"), `api_main_force_enrichment_missing:${file}`);
}
check(desktop.includes('return isStrategy2Route(route) || isStrategy3Route(route) || isStrategy4Route(route) || isStrategy5Route(route) || isChipTradeRoute(route);'), "desktop_three_gate_not_all_terminal_routes");
check(desktop.includes("mainForceCostHtml(code, asOfDate)") && desktop.includes("threeGatePriceHtml(code, asOfDate)"), "desktop_decision_price_cards_missing");
check(desktop.includes("hydrateThreeGatePrices(route, rows") && desktop.includes("hydrateMainForceCosts(route, rows"), "desktop_decision_price_hydration_missing");
check(mobile.includes('const { fetchThreeGatePrices } = require("../lib/terminal-three-gate-prices");'), "mobile_three_gate_import_missing");
check(mobile.includes("async function attachThreeGatePrices(tab, payload = {})") && mobile.includes("function mobileThreeGateHtml(row)"), "mobile_three_gate_contract_missing");
check(mobile.includes("payload = await attachThreeGatePrices(tab, payload)") && mobile.includes("${mobileThreeGateHtml(row)}"), "mobile_three_gate_not_rendered");
check(mobile.includes("mobileMainForceHtml(row)"), "mobile_main_force_not_rendered");
check(mobile.includes('const forceLivePayload = tab === "strategy2" || requestedLiveFragment;') && mobile.includes('allowStale: tab !== "strategy2",'), "mobile_prior_formal_snapshot_or_strategy2_live_rule_missing");
check(fastBundle.includes("allowStale: true,") && fastBundle.includes('requestedStrategyRoute(request) === "strategy2"') && fastBundle.includes("attachSnapshotMainForcePlaceholders(endpoints);"), "desktop_prior_formal_snapshot_or_strategy2_live_rule_missing");
check(fastBundle.includes('source: "snapshot:client-hydration-pending"') && fastBundle.includes('status: "data_insufficient"'), "desktop_snapshot_main_force_placeholder_missing");
check(snapshotCache.includes("async function readDesktopRouteSnapshotForRoute(route, options = {})") && snapshotCache.includes("supabase:desktop_route_snapshot:route"), "route_snapshot_reader_contract_missing");
check(snapshotBuilder.includes("function buildRouteSnapshotPayload(route, payload = {})") && snapshotBuilder.includes("writeDesktopRouteSnapshotForRoute(route, routePayload"), "route_snapshot_materialization_contract_missing");
check(fastBundle.includes("readDesktopRouteSnapshotForRoute(requestedRoute") && fastBundle.includes("isRouteSnapshot ? \"supabase:desktop_route_snapshot:route\""), "desktop_route_snapshot_fast_path_missing");
check(sw.includes("/\\/api\\/three-gate-prices/i") && sw.includes("/\\/api\\/main-force-costs/i"), "service_worker_decision_price_api_not_live");
check(pkg.includes('"verify:terminal-decision-prices": "node scripts/verify-terminal-decision-prices-tri-surface.js"'), "package_decision_price_verifier_missing");

const payload = {
  ok: issues.length === 0,
  contract: "terminal_decision_prices_tri_surface_v1",
  checked_at: new Date().toISOString(),
  surfaces: {
    api: apiFiles.map((file) => path.basename(file)),
    desktop: ["strategy2", "strategy3", "strategy4", "strategy5", "chip"],
    mobile: ["strategy2", "strategy3", "strategy4", "strategy5", "chip"],
  },
  fields: ["terminalThreeGate.upperGate", "terminalThreeGate.middleGate", "terminalThreeGate.lowerGate", "terminalMainForce.mainForceCostPrice", "terminalMainForce.overnight", "terminalMainForce.shortSwing", "terminalMainForce.daytrade"],
  failed_checks: issues,
  first_blocker: issues[0] || null,
};
console.log(JSON.stringify(payload, null, 2));
if (issues.length) process.exit(1);