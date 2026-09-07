const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const apiSource = fs.readFileSync(path.join(root, "api", "scan-strategy4.js"), "utf8");
const runnerSource = fs.readFileSync(path.join(root, "scripts", "scan-strategy4-cache.js"), "utf8");
const closureSource = fs.readFileSync(path.join(root, "scripts", "verify-strategy4-canonical-closure.js"), "utf8");
const wrapperSource = fs.readFileSync(path.join(root, "run-strategy4.ps1"), "utf8");

const failures = [];

if (/daily\.volMa5\s*<[^\n]+return\s+null/.test(apiSource)) {
  failures.push("api/scan-strategy4.js still excludes stocks by five-day average volume");
}

if (/payload\?\.from\s*!==\s*from/.test(apiSource)) {
  failures.push("Fugle cache still requires an exact rolling from date instead of accepting sufficient earlier history");
}

if (!apiSource.includes('String(payload.from).slice(0, 10) > String(from).slice(0, 10)')) {
  failures.push("Fugle cache does not enforce that cached history starts no later than the required lookback");
}

if (!runnerSource.includes('policy: "avg5_never_excludes_strategy4"')) {
  failures.push("runner does not declare the avg5_never_excludes_strategy4 policy");
}

if (!runnerSource.includes('enabled: false') || !runnerSource.includes('rule: "avgVolume5-diagnostic-only"')) {
  failures.push("runner volume check is not diagnostic-only");
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

if (!apiSource.includes('id: "full_scan_watch"')) {
  failures.push("API no longer preserves unmatched stocks in the full-scan watch result");
}

if (failures.length) {
  console.error("Strategy4 full-scan volume contract FAILED");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Strategy4 full-scan volume contract OK: avg5 is diagnostic-only and cannot exclude scanned stocks.");
