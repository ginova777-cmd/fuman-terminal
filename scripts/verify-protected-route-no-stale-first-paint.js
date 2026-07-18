const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const shellPath = path.join(ROOT, "terminal-desktop-fast-shell.js");
const indexPath = path.join(ROOT, "index.html");
const swPath = path.join(ROOT, "fuman-sw.js");
const shell = fs.readFileSync(shellPath, "utf8");
const indexHtml = fs.readFileSync(indexPath, "utf8");
const sw = fs.readFileSync(swPath, "utf8");

const issues = [];

function mustInclude(text, code) {
  if (!shell.includes(text)) issues.push(code);
}

function mustIncludeIn(source, text, code) {
  if (!source.includes(text)) issues.push(code);
}

function mustMatch(pattern, code) {
  if (!pattern.test(shell)) issues.push(code);
}

function mustNotMatch(pattern, code) {
  if (pattern.test(shell)) issues.push(code);
}

mustInclude('PROTECTED_ROUTE_SNAPSHOT_RETIREMENT_KEY = "FUMAN_PROTECTED_ROUTE_SNAPSHOT_RETIREMENT_20260717_01"', "missing_protected_snapshot_retirement_key");
mustInclude("function isProtectedDataRoute(route)", "missing_protected_route_classifier");
mustInclude("function installProtectedRouteSnapshotRetirement20260717()", "missing_protected_snapshot_retirement_installer");
mustInclude("installProtectedRouteSnapshotRetirement20260717();", "protected_snapshot_retirement_not_installed");
mustInclude('sessionStorage.removeItem("fuman-strategy2-snapshot-first")', "strategy2_snapshot_first_flag_not_cleared");
mustMatch(/function\s+strategy2SnapshotFirstEnabled\s*\(\)\s*\{\s*return\s+false\s*;\s*\}/, "strategy2_snapshot_first_not_hard_disabled");
mustInclude('const url = `/api/terminal-fast-bundle?canvas=1&compact=1&shell=1&t=${now}`;', "fast_bundle_missing_cache_buster");
mustInclude('fetch(url, { cache: "no-store"', "fast_bundle_not_no_store");
mustInclude('fetch(url, { cache: isProtectedDataRoute(route) || force ? "no-store" : "default"', "protected_canvas_fetch_not_no_store");
mustInclude("if (isProtectedDataRoute(route)) {", "protected_rows_for_route_gate_missing");
mustInclude("return [];", "protected_rows_must_not_snapshot_fallback");

mustNotMatch(/if\s*\(strategy2SnapshotFirst\)\s*query\.set\("snapshot",\s*"1"\)/, "strategy2_snapshot_query_still_enabled");
mustNotMatch(/if\s*\(!force\s*&&\s*cached\?\.rows\?\.length[^)]*Date\.now\(\)[^)]*ttl\)\s*\{\s*return Promise\.resolve\(cached\.rows\)/s, "protected_route_may_return_memory_cache_before_api");

mustIncludeIn(indexHtml, "protected-no-stale-first-paint=20260717-01", "index_shell_cache_buster_not_bumped");
mustIncludeIn(sw, 'PROTECTED_NO_STALE_SW_EPOCH = "protected-no-stale-first-paint-20260717-01"', "sw_no_stale_epoch_missing");
for (const [pattern, code] of [
  [/\/\\\/api\\\/terminal-fast-bundle\/i/, "sw_terminal_fast_bundle_not_live"],
  [/\/\\\/api\\\/desktop-route-snapshot\/i/, "sw_desktop_route_snapshot_not_live"],
  [/\/\\\/api\\\/scorecard\/i/, "sw_scorecard_not_live"],
  [/\/\\\/api\\\/source-reports\/i/, "sw_source_reports_not_live"],
]) {
  if (!pattern.test(sw)) issues.push(code);
}

if (/PREFETCH_CORE_DATA_ASSETS\s*=\s*\[[\s\S]*?\/api\/terminal-fast-bundle/i.test(sw)) {
  issues.push("sw_still_prefetches_terminal_fast_bundle");
}
if (/LEGACY_STATIC_DATA_PATTERNS\s*=\s*\[[\s\S]*?\/api\/terminal-fast-bundle/i.test(sw)) {
  issues.push("sw_still_caches_terminal_fast_bundle_as_data");
}

const result = {
  ok: issues.length === 0,
  checkedAt: new Date().toISOString(),
  files: [shellPath, indexPath, swPath],
  issues,
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
