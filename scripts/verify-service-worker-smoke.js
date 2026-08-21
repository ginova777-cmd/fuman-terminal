const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const swPath = path.join(ROOT, "fuman-sw.js");
const corePath = path.join(ROOT, "terminal-core.js");
const indexPath = path.join(ROOT, "index.html");
const modulesPath = path.join(ROOT, "terminal-modules.js");
const sw = fs.readFileSync(swPath, "utf8");
const core = fs.readFileSync(corePath, "utf8");
const index = fs.readFileSync(indexPath, "utf8");
const modules = fs.readFileSync(modulesPath, "utf8");
const issues = [];
const lazyStaticAssets = [
  "terminal-chip-snapshot-module.js",
  "terminal-watchlist-module.js",
];

function requireText(needle, message) {
  if (!sw.includes(needle)) issues.push(message);
}

requireText("self.addEventListener(\"install\"", "missing install listener");
requireText("self.addEventListener(\"activate\"", "missing activate listener");
requireText("self.addEventListener(\"fetch\"", "missing fetch listener");
requireText("self.skipWaiting()", "missing skipWaiting");
requireText("self.clients.claim()", "missing clients.claim");
requireText("networkFirstStatic(request)", "script/style must use networkFirstStatic");
requireText('url.pathname === "/terminal-app.js"', "terminal-app.js must be explicitly handled");
requireText("event.respondWith(networkFirst(request));", "data requests must be network-first");
requireText('request.mode === "navigate"', "navigation requests must be handled separately");
requireText('fetch(request, { cache: "no-store" })', "navigation/service worker/static network-first must use no-store");
requireText('/\\/api\\/version/i', "api_version_must_bypass_service_worker");
if (!core.includes("fetch(`/api/version?fresh=${fresh}`") || core.indexOf("fetch(`/api/version?fresh=${fresh}`") > core.indexOf("fetch(`/version.json?fresh=${fresh}`")) issues.push("terminal_core_remote_version_must_use_api_version_first");

const version = core.match(/const\s+version\s*=\s*"([^"]+)"/)?.[1] || "";
if (!version) {
  issues.push("terminal-core.js version was not detected");
}
const swCacheVersion = sw.match(/CACHE_VERSION\s*=\s*"fuman-terminal-sw-([^"]+)"/)?.[1] || "";
if (version && swCacheVersion !== version) {
  issues.push(`fuman-sw.js CACHE_VERSION ${swCacheVersion || "(missing)"} must exactly match terminal-core.js version ${version}`);
}
for (const asset of ["styles.css", "terminal-core.js", "terminal-market-ai-live-watchdog.js"]) {
  if (version && !index.includes(`${asset}?v=${version}`)) {
    issues.push(`index.html must load ${asset} with ?v=${version}`);
  }
}

for (const marker of [
  'chipSnapshot: { loaded: false, src: "terminal-chip-snapshot-module.js" }',
  'chipFlow: { loaded: false, src: "terminal-chip-snapshot-module.js" }',
]) {
  if (!modules.includes(marker)) {
    issues.push(`terminal-modules.js missing current chip snapshot marker: ${marker}`);
  }}
if (modules.includes("warrantFlow:")) {
  issues.push("terminal-modules.js must not register retired warrantFlow");
}

for (const asset of lazyStaticAssets) {
  if (version && !sw.includes(`/${asset}?v=${version}`)) {
    issues.push(`${asset} must be listed in STATIC_ASSETS with the current version`);
  }
}
for (const asset of ["styles.css", "terminal-core.js", "terminal.js", "terminal-app.js", "terminal-market-ai-live-watchdog.js"]) {
  if (version && !sw.includes(`/${asset}?v=${version}`)) {
    issues.push(`${asset} must be listed in STATIC_ASSETS with the current version`);
  }
}

try {
  new vm.Script(sw, { filename: swPath });
} catch (error) {
  issues.push(`syntax parse failed: ${error.message}`);
}

if (issues.length) {
  console.error("[sw-smoke] failed");
  for (const issue of issues) console.error("- " + issue);
  process.exit(1);
}

console.log("[sw-smoke] ok");

