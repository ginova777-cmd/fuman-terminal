const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const issues = [];

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
}

function requireIncludes(file, markers) {
  const content = read(file);
  for (const marker of markers) {
    if (!content.includes(marker)) issues.push(`${file}: missing retired Strategy1 marker ${marker}`);
  }
}

function forbidIncludes(file, markers) {
  const content = read(file);
  for (const marker of markers) {
    if (content.includes(marker)) issues.push(`${file}: retired Strategy1 UI/API marker must not appear: ${marker}`);
  }
}

forbidIncludes("index.html", [
  "策略1-",
  "策略1 明日開盤入",
  "明日開盤入</a>",
]);
forbidIncludes("index.github.html", [
  "策略1-",
  "策略1 明日開盤入",
  "明日開盤入</a>",
]);
forbidIncludes("api/mobile-fragment.js", [
  'strategy1: {',
  'endpoint: "/api/open-buy-latest"',
  'title: "策略1',
  'title: "明日開盤入"',
]);
forbidIncludes("api/mobile-boot.js", [
  'strategy1: "/api/open-buy-latest"',
  'strategy1: "open-buy"',
]);
forbidIncludes("api/latest-strategy.js", [
  '"strategy1"',
  "'strategy1'",
]);

requireIncludes("api/open-buy-latest.js", [
  "function retiredStrategy1Handler",
  "module.exports = retiredStrategy1Handler",
  "retired: true",
  'status: "retired"',
  'strategy: "strategy1"',
  "Strategy1 retired; open-buy source is no longer queried.",
  "publishAllowed: false",
  "fallbackUsed: false",
  "preservePreviousGood: true",
  'source: "strategy1_retired_no_supabase_read"',
]);

const openBuyLatest = read("api/open-buy-latest.js");
const retiredExportIndex = openBuyLatest.indexOf("module.exports = retiredStrategy1Handler");
if (retiredExportIndex < 0) {
  issues.push("api/open-buy-latest.js: retired handler must be the only exported handler");
} else {
  const afterExport = openBuyLatest.slice(retiredExportIndex);
  if (/fetchRowsFrom\(|strategy1RuntimePreopenEvidence\(|buildPayload\(/.test(afterExport)) {
    issues.push("api/open-buy-latest.js: retired export must not call legacy Supabase Strategy1 readers after export");
  }
}

const packageJson = JSON.parse(read("package.json"));
if (!String(packageJson.scripts?.["verify:strategy1-open-buy-ui"] || "").includes("verify-strategy1-open-buy-ui-contract.js")) {
  issues.push("package.json: missing verify:strategy1-open-buy-ui retired guard");
}
if (!read("scripts/prepare-deploy.js").includes("verify:strategy1-open-buy-ui")) {
  issues.push("scripts/prepare-deploy.js: deploy preflight must run verify:strategy1-open-buy-ui retired guard");
}

if (issues.length) {
  console.error("[strategy1-open-buy-ui] failed");
  for (const issue of issues) console.error("- " + issue);
  process.exit(1);
}

console.log("[strategy1-open-buy-ui] ok retired=true noSupabaseRead=true");