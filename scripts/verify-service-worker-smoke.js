const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const swPath = path.join(ROOT, "fuman-sw.js");
const corePath = path.join(ROOT, "terminal-core.js");
const modulesPath = path.join(ROOT, "terminal-modules.js");
const sw = fs.readFileSync(swPath, "utf8");
const core = fs.readFileSync(corePath, "utf8");
const modules = fs.readFileSync(modulesPath, "utf8");
const issues = [];
const lazyStaticAssets = [
  "terminal-chip-flow.js",
  "terminal-warrant-flow.js",
  "terminal-watchlist-module.js",
];
const moduleMapAssets = [
  "terminal-chip-flow.js",
  "terminal-warrant-flow.js",
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

const version = core.match(/const\s+version\s*=\s*"([^"]+)"/)?.[1] || "";
if (!version) {
  issues.push("terminal-core.js version was not detected");
}

for (const asset of moduleMapAssets) {
  if (!modules.includes(`src: "${asset}"`)) {
    issues.push(`${asset} must be registered in terminal-modules.js`);
  }
}

for (const asset of lazyStaticAssets) {
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
