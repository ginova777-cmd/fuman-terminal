const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const apiSource = fs.readFileSync(path.join(root, "api", "scan-strategy4.js"), "utf8");
const runnerSource = fs.readFileSync(path.join(root, "scripts", "scan-strategy4-cache.js"), "utf8");
const closureSource = fs.readFileSync(path.join(root, "scripts", "verify-strategy4-canonical-closure.js"), "utf8");
const wrapperSource = fs.readFileSync(path.join(root, "run-strategy4.ps1"), "utf8");
const dailyPublishSource = fs.readFileSync(path.join(root, "scripts", "verify-strategy4-daily-publish.js"), "utf8");
const dbVerifierSource = fs.readFileSync(path.join(root, "scripts", "verify-strategy4-db-latest-run.js"), "utf8");

const failures = [];

if (/daily\.volMa5\s*<[^\n]+return\s+null/.test(apiSource)) {
  failures.push("api/scan-strategy4.js duplicates the authoritative avg5 gate instead of using the runner's lots cache");
}

if (/payload\?\.from\s*!==\s*from/.test(apiSource)) {
  failures.push("Fugle cache still requires an exact rolling from date instead of accepting sufficient earlier history");
}

if (!apiSource.includes('String(payload.from).slice(0, 10) > String(from).slice(0, 10)')) {
  failures.push("Fugle cache does not enforce that cached history starts no later than the required lookback");
}

if (!runnerSource.includes('policy: "avg5_below_3000_excludes_strategy4"')) {
  failures.push("runner does not declare the Strategy4 avg5 hard-gate policy");
}

for (const signalId of ["watch_trend", "base_setup", "full_scan_watch", "below_20d_high_8", "lower_half_60d"]) {
  if (!runnerSource.includes(`"${signalId}"`)) failures.push(`observation-only signal ${signalId} is not classified`);
}

if (!runnerSource.includes('resultClass: "formal_actionable"') || !runnerSource.includes("observationOnlyCount") || !runnerSource.includes("dataGapCount")) {
  failures.push("runner does not split formal actionable results, observation-only evaluations, and data gaps");
}

if (!runnerSource.includes('enabled: true') || !runnerSource.includes('rule: "avgVolume5-gte-hard-gate"') || !runnerSource.includes('unit: "lots"') || !runnerSource.includes('exceptionAllowed: false')) {
  failures.push("runner volume check is not a strict 3000-lot hard gate");
}

if (!runnerSource.includes('dataGapContract: "target_date_coverage_gte_90_exclude_stale_v1"') || !runnerSource.includes("staleDataGapCodes")) {
  failures.push("runner does not exclude stale daily-K rows under the 90-percent data-gap contract");
}

if (!runnerSource.includes("noDataCodes: normalizeArray(output.noDataCodes)") || !runnerSource.includes("insufficientHistory: normalizeArray(output.insufficientHistory)")) {
  failures.push("published Strategy4 run payload does not retain auditable data-gap symbol evidence");
}

if (!runnerSource.includes('pageSize = Math.min(1000, requestedLimit)') || !runnerSource.includes('pageParams.set("offset", String(offset))')) {
  failures.push("Supabase published self-test does not paginate result sets larger than 1000 rows");
}

if (!closureSource.includes("async function supabaseAllRows") || !closureSource.includes("offset=${offset}")) {
  failures.push("canonical closure verifier does not paginate the complete published result set");
}

if (!wrapperSource.includes("$isTodayRecovery") || !wrapperSource.includes("Strategy4 historical recovery requires delivered LINE evidence")) {
  failures.push("same-day recovery cannot safely complete a missing LINE receipt after verifier repair");
}

if (!wrapperSource.includes("[switch]$ReuseDeliveredLineEvidence") || !wrapperSource.includes("-ReuseDeliveredLineEvidence:($null -ne $lineEvidence)")) {
  failures.push("same-day recovery does not reuse matching delivered LINE evidence and may send a duplicate notification");
}

if (!wrapperSource.includes("Strategy4 LINE push skipped; reusing delivered same-run evidence")) {
  failures.push("Strategy4 recovery does not expose auditable evidence when an existing LINE delivery is reused");
}

if (wrapperSource.includes('@("scripts\\verify-terminal-daily-ohlcv.js")') || dailyPublishSource.includes('"scripts/verify-terminal-daily-ohlcv.js"')) {
  failures.push("Strategy4 closure is still coupled to the shared 20-trading-day OHLC verifier instead of its own target-date 90-percent data-gap contract");
}

if (!dbVerifierSource.includes("dataGapsExcluded") || !dbVerifierSource.includes("displayedDataGapCodes")) {
  failures.push("Strategy4 DB verifier does not prove that accepted data-gap symbols are absent from formal results");
}

if (wrapperSource.includes("Invoke-Strategy4ScorecardSync") || wrapperSource.includes("scorecard:sync")) {
  failures.push("Strategy4 runner still invokes the shared all-strategy scorecard sync and schedule audit");
}

if (!wrapperSource.includes("Invoke-Strategy4ScorecardSourceRefresh") || !wrapperSource.includes("scorecard:terminal-source")) {
  failures.push("Strategy4 runner does not retain its scoped scorecard and three-surface refresh");
}

if (!apiSource.includes('id: "full_scan_watch"')) {
  failures.push("API no longer preserves unmatched stocks in the full-scan watch result");
}

if (failures.length) {
  console.error("Strategy4 full-scan volume contract FAILED");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Strategy4 full-scan contract OK: avg5>=3000 lots is authoritative, stale daily-K rows are excluded within 90% coverage tolerance, formal results are separated, and scorecard refresh is Strategy4-scoped.");
