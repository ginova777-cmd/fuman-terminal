const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const checks = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function add(ok, code, detail = "") {
  checks.push({ ok, code, detail });
}

const scorecardPage = read("88.html");
add(!/keyOrder\s*=\s*\[[^\]]*(strategy1|realtime-radar)/i.test(scorecardPage), "scorecard_key_order_retired_removed");
add(!/normalized\.includes\("策略1"\)/.test(scorecardPage), "scorecard_strategy1_alias_removed");

const syncSource = read(path.join("scripts", "sync-main-deploy-source.js"));
for (const retired of [
  "api/open-buy-latest.js",
  "scripts/scan-open-buy-cache.js",
  "run-open-buy.ps1",
  "data/scorecard-latest.json",
]) {
  add(!syncSource.includes(`"${retired}"`), "sync_source_retired_removed", retired);
}

for (const retiredProtectedCache of [
  'path.join("data", "institution-mobile-top.json")',
  'path.join("data", "strategy5-page-1.json")',
  'path.join("data", "warrant-flow-mobile-top.json")',
]) {
  add(syncSource.includes(retiredProtectedCache), "sync_source_retired_protected_cache_listed", retiredProtectedCache);
}

const sw = read("fuman-sw.js");
add(!sw.includes("terminal-realtime-radar.css"), "sw_realtime_radar_precache_removed");
add(!sw.includes("terminal-theme-css-snapshot-first"), "sw_old_theme_snapshot_marker_removed");

const terminalFast = read(path.join("api", "terminal-fast-bundle.js"));
add(/RETIRED_TERMINAL_ENDPOINTS/.test(terminalFast) && /open-buy/.test(terminalFast) && /realtime-radar/.test(terminalFast) && /heatmap/.test(terminalFast), "terminal_fast_bundle_strips_retired_endpoints");

const terminalApp = read("terminal-app.js");
for (const retiredStaticRefresh of [
  "strategy5-page-1.json",
  "institution-mobile-top.json",
  "warrant-flow-mobile-top.json",
]) {
  add(!terminalApp.includes(`\"${retiredStaticRefresh}\":async`), "terminal_app_formal_static_refreshers_removed", retiredStaticRefresh);
}

const scorecardApi = read(path.join("api", "scorecard.js"));
add(scorecardApi.includes("json-snapshot-disabled"), "scorecard_static_json_fallback_disabled_by_default");

const failed = checks.filter((item) => !item.ok);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks }, null, 2));
