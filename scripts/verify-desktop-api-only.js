const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const requiredRuntimeApis = [
  "/api/strategy2-latest",
  "/api/strategy3-latest",
  "/api/strategy4-latest",
  "/api/strategy5-latest",
  "/api/institution-latest",
  "/api/warrant-flow-latest",
  "/api/cb-detect-latest",
];

const forbiddenStaticPatterns = [
  /(?:\/data\/|data[\\/])open-buy[^"'\s)]*\.json/g,
  /(?:\/data\/|data[\\/])strategy2-intraday[^"'\s)]*\.json/g,
  /(?:\/data\/|data[\\/])strategy3[^"'\s)]*\.json/g,
  /(?:\/data\/|data[\\/])strategy4[^"'\s)]*\.json/g,
  /(?:\/data\/|data[\\/])strategy5[^"'\s)]*\.json/g,
  /(?:\/data\/|data[\\/])institution[^"'\s)]*\.json/g,
  /(?:\/data\/|data[\\/])warrant-flow[^"'\s)]*\.json/g,
  /(?:\/data\/|data[\\/])warrant-priority[^"'\s)]*\.json/g,
  /(?:\/data\/|data[\\/])warrant-single-signal[^"'\s)]*\.json/g,
  /(?:\/data\/|data[\\/])cb-detect[^"'\s)]*\.json/g,
];

const runtimeFiles = [
  "terminal-runtime-config.js",
  "terminal-live-check.js",
  "terminal-app.js",
];

const apiFiles = [
  "api/strategy2-latest.js",
  "api/strategy3-latest.js",
  "api/strategy4-latest.js",
  "api/strategy5-latest.js",
  "api/institution-latest.js",
  "api/warrant-flow-latest.js",
  "api/cb-detect-latest.js",
];

const scannerMarkers = [
  ["scripts/scan-intraday-signals.js", "STRATEGY2_API_ONLY = true"],
  ["scripts/scan-strategy3-cache.js", "STRATEGY3_API_ONLY = true"],
  ["scripts/scan-strategy4-cache.js", "STRATEGY4_API_ONLY = true"],
  ["scripts/scan-strategy5-cache.js", "STRATEGY5_API_ONLY = true"],
  ["scripts/scan-institution-cache.js", "INSTITUTION_API_ONLY = true"],
  ["scripts/scan-warrant-flow-cache.js", "WARRANT_FLOW_API_ONLY = true"],
  ["scripts/generate-slim-cache.js", "DESKTOP_API_ONLY_STATIC_OUTPUT = true"],
];

const publishSourceFiles = [
  "scripts/sync-main-deploy-source.js",
];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function fail(message) {
  console.error(`[desktop-api-only] ${message}`);
  process.exitCode = 1;
}

function findForbiddenStatic(text) {
  const hits = [];
  for (const pattern of forbiddenStaticPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) hits.push(match[0]);
  }
  return [...new Set(hits)]
    .filter((hit) => !/mobile|tdcc-breakout/i.test(hit))
    .sort();
}

for (const file of runtimeFiles) {
  const text = read(file);
  const hits = findForbiddenStatic(text);
  if (hits.length) fail(`${file} still references desktop static JSON: ${hits.join(", ")}`);
}

const runtimeConfig = read("terminal-runtime-config.js");
for (const endpoint of requiredRuntimeApis) {
  if (!runtimeConfig.includes(endpoint)) fail(`terminal-runtime-config.js missing ${endpoint}`);
}

const retiredRuntimeMarkers = [
  'openBuyCache: ""',
  'scanOpenBuy: ""',
  'realtimeRadarLatestApi: ""',
  'realtimeRadarCache: ""',
  'realtimeRadarStaticCache: ""',
];
for (const marker of retiredRuntimeMarkers) {
  if (!runtimeConfig.includes(marker)) fail(`terminal-runtime-config.js missing retired endpoint marker ${marker}`);
}

for (const file of apiFiles) {
  const text = read(file);
  const staticFallback = [
    "staticFallback",
    "static-fallback",
    "static-json",
    "readFileSync(path.join(process.cwd(), \"data\"",
    "readFileSync(path.join(process.cwd(), 'data'",
  ].filter((needle) => text.includes(needle));
  if (staticFallback.length) fail(`${file} contains static fallback markers: ${staticFallback.join(", ")}`);
  if (!text.includes("no-store")) fail(`${file} is missing no-store cache control`);
}

for (const [file, marker] of scannerMarkers) {
  const text = read(file);
  if (!text.includes(marker)) fail(`${file} missing ${marker}`);
}

const strategy2Publisher = read("scripts/publish-strategy2-complete-run.js");
if (/strategy2-intraday-latest\.json|FUMAN_RUNTIME_DIR.*data|path\.join\(ROOT,\s*"data"/.test(strategy2Publisher)) {
  fail("scripts/publish-strategy2-complete-run.js still depends on strategy2 static JSON");
}
if (!strategy2Publisher.includes("supabase:strategy2_latest")) {
  fail("scripts/publish-strategy2-complete-run.js is not Supabase latest sourced");
}

const cbGenerator = read("scripts/generate-cb-detect.js");
for (const marker of ["runId", "complete: true", "qualityStatus", "upsertSnapshot(\"cb_detect_latest\""]) {
  if (!cbGenerator.includes(marker)) fail(`scripts/generate-cb-detect.js missing CB contract marker ${marker}`);
}

const sw = read("fuman-sw.js");
if (!sw.includes("desktop_static_disabled") || !sw.includes("isDesktopApiOnlyStaticDataRequest")) {
  fail("fuman-sw.js missing desktop static JSON 410 guard");
}

const vercel = read("vercel.json");
if (!vercel.includes("desktop-static-disabled") || !vercel.includes("/data/(open-buy|strategy2-intraday|strategy3|strategy4|strategy5|institution|warrant-flow")) {
  fail("vercel.json missing desktop static JSON 410 rewrite");
}

for (const file of publishSourceFiles) {
  const text = read(file);
  const hits = findForbiddenStatic(text);
  if (hits.length) fail(`${file} still publishes or repairs desktop static JSON: ${hits.join(", ")}`);
}

const cacheSync = read("run-cache-sync.ps1");
for (const marker of ["DESKTOP_API_ONLY_STATIC_FILTER", "Test-DesktopApiOnlyStaticDataFile", "desktop-api-only-static-disabled"]) {
  if (!cacheSync.includes(marker)) fail(`run-cache-sync.ps1 missing desktop API-only static filter marker ${marker}`);
}

if (process.exitCode) process.exit(process.exitCode);
console.log("[desktop-api-only] ok");
