const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

let failed = false;

function read(rel) {
  const file = path.join(ROOT, rel);
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    fail(`${rel} missing or unreadable`);
    return "";
  }
}

function fail(message) {
  failed = true;
  console.error(`[buy-sell-no-rollback] ${message}`);
}

function requireIncludes(file, needles) {
  const text = read(file);
  for (const needle of needles) {
    if (!text.includes(needle)) fail(`${file} missing marker: ${needle}`);
  }
  return text;
}

function forbidIncludes(file, needles) {
  const text = read(file);
  for (const needle of needles) {
    if (text.includes(needle)) fail(`${file} contains forbidden rollback marker: ${needle}`);
  }
  return text;
}

const chipFlow = requireIncludes("terminal-chip-flow.js", [
  "CHIP_TRADE_VALID_CACHE_KEY",
  "fuman-terminal-chip-trade-valid-cache-v1",
  "function hasChipTradeRows()",
  "chipTradeFrozen",
  "restoreChipTradeLocalCache() && hasChipTradeRows()",
  "loadChipTradeData(force = false)",
  "renderChipTradeTable();",
]);

forbidIncludes("terminal-chip-flow.js", [
  "/data/institution-latest.json",
  "/data/institution-slim.json",
  "/data/institution-mobile-top.json",
  "/data/institution-tdcc-breakout-top.json",
  "近5日均量 < 3000",
  "內外盤累計 < 3000",
]);

if (!/chipTradeFrozen\s*&&\s*hasInstitutionRows/.test(chipFlow)) {
  fail("terminal-chip-flow.js must return early when chipTradeFrozen and rows exist");
}

if (!/if\s*\(!chipTradeFrozen\)\s*loadChipExclusions\(false\)\.catch/.test(chipFlow)) {
  fail("terminal-chip-flow.js must not await chipTradeExclusions after frozen rows exist");
}

requireIncludes("terminal-runtime-config.js", [
  'institutionCache: "/api/institution-latest"',
  'institutionSlim: "/api/institution-latest"',
  'institutionSummary: "/api/institution-latest"',
  'institutionMobileTop: "/api/institution-latest"',
]);

forbidIncludes("terminal-runtime-config.js", [
  "/data/institution-latest.json",
  "/data/institution-slim.json",
  "/data/institution-tdcc-breakout-top.json",
]);

const institutionApi = requireIncludes("api/institution-latest.js", [
  'const INSTITUTION_FIELD_CONTRACT_VERSION = "buy-sell-derived-fields-20260629-01"',
  "fieldContractVersion: INSTITUTION_FIELD_CONTRACT_VERSION",
  "payloadMatchesFieldContract",
  "v_institution_latest_complete_run",
  "validateCompleteRun",
  "validateReadback",
  "complete-run-readback",
  "no-store",
]);

if (!/expectedTotal\s*!==\s*scannedCount/.test(institutionApi)) {
  fail("api/institution-latest.js must reject incomplete latest complete runs");
}

if (!/rows\.length\s*!==\s*resultCount/.test(institutionApi)) {
  fail("api/institution-latest.js must reject readback count mismatches");
}

requireIncludes("api/chip-trade-latest.js", [
  "institution-latest",
  "no-store",
]);

requireIncludes("api/chip-trade-tdcc-breakout-latest.js", [
  "no-store",
]);

requireIncludes("terminal-desktop-fast-shell.js", [
  'const CHIP_TRADE_FIELD_CONTRACT_VERSION = "buy-sell-derived-fields-20260629-01"',
  'query.set("fieldContract", CHIP_TRADE_FIELD_CONTRACT_VERSION)',
  "foreign_trust_buy_volume_pct",
  "foreignTrustVolumePct",
  "five_day_avg_volume",
  "avg_volume_5d",
  "chipTradeForeignTrustVolumePct(row)",
  "pickFirstValue(row?.foreignTrustBuyVolumePct",
]);

if (/row\?\.foreignTrustBuyVolumePct\s*\|\|\s*row\?\.institutionBuyVolumePct/.test(read("terminal-desktop-fast-shell.js"))) {
  fail("terminal-desktop-fast-shell.js must not use || when reading buy/sell volume pct because valid zero/signed fields can be lost");
}

requireIncludes("scripts/verify-publish-gate.js", [
  "buySellNoRollbackGuard",
  "buySellFieldContractGuard",
  "guard-buy-sell-no-rollback.js",
  "verify-buy-sell-field-contract.js",
]);

requireIncludes("package.json", [
  '"verify:buy-sell-field-contract": "node --use-system-ca scripts/verify-buy-sell-field-contract.js"',
]);

requireIncludes("scripts/verify-buy-sell-field-contract.js", [
  'const EXPECTED_FIELD_CONTRACT_VERSION = "buy-sell-derived-fields-20260629-01"',
  "captureInstitutionApi",
  "foreignTrustVolumePct",
  "fiveDayAvgVolume",
]);

requireIncludes("index.html", [
  "terminal-desktop-fast-shell.js?buy-sell-derived-fields=20260629-01&strategy2-history=20260629-01",
  'data-fuman-desktop-fast-shell="1"',
]);

const agents = requireIncludes("AGENTS.md", [
  "Latest Operator Contract",
  "Do Not Use As Read-Only Verification",
  "Post-Scan Immediate Display",
  "Strategy4 Latest Contract",
  "Anti-Rollback",
]);

requireIncludes("institutionAGENTS.MD", [
  "API-only complete-run contract",
  "衍生欄位契約",
  "foreignStreak / trustStreak / jointStreak",
  "foreignTrustVolumePct",
  "terminal-desktop-fast-shell.js",
  "guard:buy-sell-no-rollback",
]);

if (/Supabase Shared Source 四層契約|買賣超 \/ Institution|Strategy 1|Strategy 2|Strategy 3|Strategy 4|Strategy 5/.test(agents)) {
  fail("AGENTS.md should stay on the new concise contract, not the old strategy long-form file");
}

if (failed) {
  console.error("[buy-sell-no-rollback] failed");
  process.exit(1);
}

console.log("[buy-sell-no-rollback] ok");
