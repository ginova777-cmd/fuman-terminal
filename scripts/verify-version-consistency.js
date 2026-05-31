const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const VERSION = process.env.FUMAN_EXPECTED_VERSION || "speed-modules-20260531-32";
const files = [
  "index.html",
  "terminal-core.js",
  "terminal-modules.js",
  "terminal.js",
  "terminal-app.js",
  "fuman-sw.js",
  "scripts/verify-deployment.js",
  "scripts/e2e-smoke.js",
];

const oldVersionPattern = /speed-modules-20260530-(?!29\b)\d+/g;
const issues = [];
for (const file of files) {
  const full = path.join(ROOT, file);
  const text = fs.readFileSync(full, "utf8");
  const old = [...new Set(text.match(oldVersionPattern) || [])];
  if (old.length) issues.push(file + ": stale versions " + old.join(", "));
  if (!text.includes(VERSION)) issues.push(file + ": missing " + VERSION);
}

const sw = fs.readFileSync(path.join(ROOT, "fuman-sw.js"), "utf8");
if (sw.includes('"/",') || sw.includes('"/index.html",')) {
  issues.push("fuman-sw.js: must not precache / or /index.html");
}
if (!sw.includes('request.mode === "navigate"') || !sw.includes('fetch(request, { cache: "no-store" })')) {
  issues.push("fuman-sw.js: navigate requests must be network/no-store first");
}

const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
const headerFor = (source) => (vercel.headers || []).find((item) => item.source === source);
for (const source of ["/", "/index.html", "/fuman-sw.js"]) {
  const item = headerFor(source);
  const cache = item && item.headers && item.headers.find((header) => String(header.key).toLowerCase() === "cache-control");
  const value = cache ? cache.value : "";
  if (!/no-store/i.test(value)) issues.push("vercel.json: " + source + " must be no-store");
}

if (issues.length) {
  console.error("[version] failed");
  for (const issue of issues) console.error("- " + issue);
  process.exit(1);
}
console.log("[version] ok " + VERSION);
