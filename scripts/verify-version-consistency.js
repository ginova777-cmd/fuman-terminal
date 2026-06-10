const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
}

function detectVersion() {
  if (process.env.FUMAN_EXPECTED_VERSION) return process.env.FUMAN_EXPECTED_VERSION;
  const core = read("terminal-core.js");
  const coreMatch = core.match(/const\s+version\s*=\s*["']([^"']+)["']/);
  if (coreMatch) return coreMatch[1];
  const index = read("index.html");
  const indexMatch = index.match(/terminal-core\.js\?v=([^"'&<>]+)/);
  if (indexMatch) return indexMatch[1];
  throw new Error("Unable to detect frontend version from terminal-core.js or index.html");
}

const VERSION = detectVersion();
const issues = [];
function requireIncludes(file, needle) {
  if (!read(file).includes(needle)) issues.push(`${file}: missing ${needle}`);
}

requireIncludes("index.html", `styles.css?v=${VERSION}`);
requireIncludes("index.html", `terminal-core.js?v=${VERSION}`);
requireIncludes("terminal-core.js", `const version = "${VERSION}"`);
requireIncludes("terminal-modules.js", `const VERSION = "${VERSION}"`);
requireIncludes("fuman-sw.js", `?v=${VERSION}`);
requireIncludes("fuman-sw.js", `/terminal-app.js?v=${VERSION}`);
requireIncludes("scripts/verify-deployment.js", "detectVersion");
requireIncludes("scripts/e2e-smoke.js", "detectVersion");

const staleLiteral = "strategy4-remove-zone-card-20260601-05";
for (const file of ["index.html", "terminal-core.js", "terminal-modules.js", "terminal.js", "terminal-app.js", "fuman-sw.js", "scripts/verify-deployment.js", "scripts/e2e-smoke.js"]) {
  if (read(file).includes(staleLiteral)) issues.push(`${file}: stale literal ${staleLiteral}`);
}

const sw = read("fuman-sw.js");
if (sw.includes('"/",') || sw.includes('"/index.html",')) {
  issues.push("fuman-sw.js: must not precache / or /index.html");
}
if (!sw.includes('request.mode === "navigate"') || !sw.includes('fetch(request, { cache: "no-store" })')) {
  issues.push("fuman-sw.js: navigate requests must be network/no-store first");
}
if (!sw.includes("async function networkFirstStatic") || !sw.includes('["script", "style"].includes(request.destination)')) {
  issues.push("fuman-sw.js: script/style assets must be network-first");
}
if (!sw.includes('url.pathname === "/terminal-app.js"')) {
  issues.push("fuman-sw.js: terminal-app.js must be explicitly network-first");
}
if (!sw.includes("if (isDataRequest(url)) {\n    event.respondWith(networkFirst(request));")) {
  issues.push("fuman-sw.js: data requests must be network-first");
}

const vercel = JSON.parse(read("vercel.json"));
const headerFor = (source) => (vercel.headers || []).find((item) => item.source === source);
for (const source of ["/", "/index.html", "/fuman-sw.js"]) {
  const item = headerFor(source);
  const cache = item && item.headers && item.headers.find((header) => String(header.key).toLowerCase() === "cache-control");
  const value = cache ? cache.value : "";
  if (!/no-store/i.test(value)) issues.push(`vercel.json: ${source} must be no-store`);
}

if (issues.length) {
  console.error("[version] failed");
  for (const issue of issues) console.error("- " + issue);
  process.exit(1);
}
console.log("[version] ok " + VERSION);
