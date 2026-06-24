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
  'chipTradeLatest: "/api/chip-trade-latest"',
  'chipTradeTdccBreakout: "/api/chip-trade-tdcc-breakout-latest"',
  "chipTradeForeignTrustVolumePct",
]);

forbidIncludes("terminal-runtime-config.js", [
  'institutionTdccBreakout: "/api/institution-latest"',
  "/data/institution-tdcc-breakout-top.json",
]);

const institutionApi = requireIncludes("api/institution-latest.js", [
  "INSTITUTION_MIN_COMPLETE_ROWS",
  "snapshot-min-rows",
  "chip_trade_latest",
  "no-store",
]);

if (!/(range|Range|Content-Range|from|to|pageSize|PAGE_SIZE)/.test(institutionApi)) {
  fail("api/institution-latest.js must contain paged/range read logic for >1000 rows");
}

if (!/(304|441|482|1000|INSTITUTION_MIN_COMPLETE_ROWS)/.test(institutionApi)) {
  fail("api/institution-latest.js must guard against partial/truncated runs");
}

requireIncludes("api/chip-trade-latest.js", [
  "institution-latest",
  "no-store",
]);

requireIncludes("api/chip-trade-tdcc-breakout-latest.js", [
  "no-store",
]);

const agents = requireIncludes("AGENTS.md", [
  "買賣超目前正式行為",
  "chipTradeFrozen = true",
  "count >= 1200",
  "304 rows = invalid",
  "Deploy",
  "hasChipTradeRows",
]);

if (/Strategy 1|Strategy 2|Strategy 3|Strategy 4|Strategy 5/.test(agents)) {
  fail("AGENTS.md should stay on the new concise contract, not the old strategy long-form file");
}

if (failed) {
  console.error("[buy-sell-no-rollback] failed");
  process.exit(1);
}

console.log("[buy-sell-no-rollback] ok");
