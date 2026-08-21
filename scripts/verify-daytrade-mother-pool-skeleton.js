const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONTRACT = "daytrade_mother_pool_skeleton_v1";
const BASELINE = "public-terminal-fast-20260714-22";
const BASELINE_COMMIT = "4d6ba88c19c5924093fcbe8afb0566df3c80a921";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
}

function json(rel) {
  return JSON.parse(read(rel));
}

function includes(file, marker, issues) {
  if (!read(file).includes(marker)) issues.push(`${file}: missing ${marker}`);
}

function excludes(file, marker, issues) {
  if (read(file).includes(marker)) issues.push(`${file}: forbidden ${marker}`);
}

function main() {
  const issues = [];
  const contract = json("data/contracts/daytrade_mother_pool_skeleton_v1.json");
  const version = json("version.json");

  if (contract.contract !== CONTRACT) issues.push(`contract mismatch ${contract.contract}`);
  if (contract.baseline !== BASELINE) issues.push(`baseline mismatch ${contract.baseline}`);
  if (contract.baselineCommit !== BASELINE_COMMIT) issues.push(`baselineCommit mismatch ${contract.baselineCommit}`);
  if (contract.rules?.oldSupabaseMarketSnapshotsFallbackDisabled !== true) issues.push("old Supabase market_snapshots fallback rule is not hard-enabled");
  if (contract.rules?.top40IsNotLimitGateOrOnlyEntry !== true) issues.push("TOP40 compatibility rule missing");
  if (contract.rules?.dataGapMustNotDisplayAsNoSignal !== true) issues.push("DATA_GAP display guard missing");

  if (version.formalSkeletonContract !== CONTRACT) issues.push("version.json formalSkeletonContract mismatch");
  if (version.formalSkeletonBaseline !== BASELINE) issues.push("version.json formalSkeletonBaseline mismatch");

  includes("terminal-core.js", `const formalSkeletonContract = "${CONTRACT}"`, issues);
  includes("terminal-core.js", `const formalSkeletonBaseline = "${BASELINE}"`, issues);
  includes("terminal-core.js", "window.FUMAN_FORMAL_SKELETON_CONTRACT", issues);
  includes("terminal-core.js", "window.FUMAN_FORMAL_SKELETON_BASELINE", issues);
  includes("index.html", "terminal-desktop-fast-shell.js?buy-sell-derived-fields=20260629-01&strategy2-history=20260629-01", issues);
  includes("scripts/verify-live-version.js", "public-terminal-fast-20260714-(?:19|20)", issues);
  excludes("scripts/verify-live-version.js", "public-terminal-fast-20260714-(?:19|20|22)", issues);

  includes("api/market-ai-live.js", "old_supabase_market_snapshots_fallback_disabled_by_daytrade_mother_pool_skeleton_v1", issues);
  excludes("api/market-ai-live.js", "allowLatestFallback: !requireTodayLiveSource && (fastCachedPayload || !isMarketAiPostClose(clock))", issues);
  excludes("api/market-ai-live.js", "function snapshotResponsePayload", issues);
  excludes("api/market-ai-live.js", "readSnapshot(\"market_ai_live\"", issues);

  const forbiddenFormalMarkers = [
    "cb_bridge_as_formal_source",
    "warrant_bridge_as_formal_source",
    "previous_good_as_today",
    "DATA_GAP_NO_SIGNAL",
  ];
  for (const marker of forbiddenFormalMarkers) {
    for (const file of ["api/market-ai-live.js", "api/strategy2-latest.js", "api/strategy3-latest.js", "api/institution-latest.js"]) {
      if (fs.existsSync(path.join(ROOT, file))) excludes(file, marker, issues);
    }
  }

  if (issues.length) {
    console.error("[daytrade-mother-pool-skeleton] failed");
    for (const issue of issues) console.error("- " + issue);
    process.exit(1);
  }
  console.log("[daytrade-mother-pool-skeleton] ok", JSON.stringify({
    contract: CONTRACT,
    baseline: BASELINE,
    releaseVersion: version.version,
    oldSupabaseMarketSnapshotsFallback: "disabled",
  }));
}

main();
