const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, ".");
const PROD_ROOT = process.env.FUMAN_PROD_ROOT || "C:\\fuman-release-owner\\prod81";
const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const writerPath = process.env.MOTHER_POOL_WRITER_FILE || path.join(PROD_ROOT, "scripts", "run-daytrade-source-writer.js");
const current5mPath = process.env.MOTHER_POOL_5M_CURRENT_FILE || path.join(PROD_ROOT, "run-daytrade-intraday-5m-current-candidates.ps1");
const packagePath = process.env.MOTHER_POOL_PACKAGE_FILE || path.join(PROD_ROOT, "package.json");
const snapshotPath = path.join(RUNTIME, "state", "daytrade-mother-pool-snapshot-latest.json");

function read(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}
function readJson(file) {
  try { return JSON.parse(read(file)); } catch { return null; }
}
function taipeiDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function compact(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}
function includesAll(source, fragments) {
  return fragments.every((fragment) => source.includes(fragment));
}
function uniqueSymbols(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value?.symbol || value?.code || value || "").replace(/\D/g, "").slice(0, 4)).filter((value) => /^\d{4}$/.test(value)))].sort();
}

const writer = read(writerPath);
const current5m = read(current5mPath);
const packageSource = read(packagePath);
const snapshot = readJson(snapshotPath);
const checks = {
  writer_readable: Boolean(writer),
  five_minute_current_runner_readable: Boolean(current5m),
  writer_snapshot_file_contract: includesAll(writer, [
    "MOTHER_POOL_SNAPSHOT_FILE",
    "daytrade-mother-pool-snapshot-latest.json",
    "daytrade_mother_pool_snapshot_v1",
    "snapshot_sequence",
    "snapshot_type",
    "added_symbols",
    "removed_symbols",
    "symbol_membership",
    "PENDING_DOWNSTREAM_WARMUP",
    "downstream_warmup_pending_symbols",
  ]),
  writer_no_silent_same_run_mutation: includesAll(writer, [
    "previousSameDay",
    "addedSymbols",
    "removedSymbols",
    "snapshotSequence",
    "mother_pool_snapshot:",
    "previous_run_id",
  ]),
  writer_priority_artifact_exports_snapshot: includesAll(writer, [
    "motherPoolSnapshotRunId",
    "mother_pool_run_id",
    "motherPoolSnapshotSequence",
    "mother_pool_snapshot_sequence",
    "motherPoolEffectiveAt",
    "mother_pool_effective_at",
    "motherPoolMembership",
  ]),
  source_status_exports_snapshot: includesAll(writer, [
    "mother_pool_snapshot_contract",
    "mother_pool_run_id",
    "mother_pool_snapshot_sequence",
    "mother_pool_effective_at",
    "mother_pool_downstream_warmup_pending_symbols",
    "mother_pool_snapshot_read_interface",
  ]),
  five_minute_runner_uses_snapshot_first: includesAll(current5m, [
    "$SnapshotPath",
    "daytrade-mother-pool-snapshot-latest.json",
    "$snapshotSymbols",
    "$motherPoolSymbols",
    "$terminalSymbols",
    "$candidateSymbols = @($snapshotSymbols + $motherPoolSymbols + $terminalSymbols | Select-Object -Unique)",
    "snapshotRunId",
    "sequence",
  ]),
  package_verifier_script_present: !packageSource || packageSource.includes("verify:daytrade-mother-pool-snapshot"),
};

if (snapshot) {
  const symbols = uniqueSymbols(snapshot.symbols);
  const membership = Array.isArray(snapshot.symbol_membership) ? snapshot.symbol_membership : [];
  const activeMembership = membership.filter((row) => row?.membership_status !== "REMOVED");
  const membershipSymbols = uniqueSymbols(activeMembership.map((row) => row.symbol));
  const pending = uniqueSymbols(snapshot.downstream_warmup_pending_symbols);
  checks.runtime_snapshot_today = String(snapshot.trade_date || "").slice(0, 10) === taipeiDate();
  checks.runtime_snapshot_canonical_run_id = String(snapshot.canonical_run_id || "") === `fugle_daytrade_source:${compact(taipeiDate())}:canonical`;
  checks.runtime_snapshot_complete = snapshot.complete === true
    && snapshot.status === "complete"
    && Number(snapshot.exit_code) === 0
    && !snapshot.first_blocker;
  checks.runtime_symbol_count_matches = Number(snapshot.symbol_count) === symbols.length;
  checks.runtime_membership_matches_symbols = JSON.stringify(symbols) === JSON.stringify(membershipSymbols);
  checks.runtime_delta_fields_arrays = Array.isArray(snapshot.added_symbols) && Array.isArray(snapshot.removed_symbols);
  checks.runtime_run_id_sequence_fixed = String(snapshot.run_id || "") === String(snapshot.mother_pool_run_id || "")
    && String(snapshot.run_id || "").includes(`fugle_daytrade_source:${compact(taipeiDate())}:canonical:mother_pool_snapshot:`)
    && Number(snapshot.snapshot_sequence) >= 1;
  checks.runtime_per_symbol_membership_contract = activeMembership.every((row) =>
    /^\d{4}$/.test(String(row?.symbol || ""))
    && String(row?.trade_date || "") === String(snapshot.trade_date || "")
    && String(row?.mother_pool_run_id || "") === String(snapshot.run_id || "")
    && Number(row?.mother_pool_snapshot_sequence) === Number(snapshot.snapshot_sequence)
    && ["ACTIVE", "PENDING_DOWNSTREAM_WARMUP"].includes(String(row?.membership_status || ""))
    && Boolean(row?.membership_effective_at)
    && Boolean(row?.added_at)
  );
  checks.runtime_pending_symbols_are_members = pending.every((symbol) => symbols.includes(symbol));
}

const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
const output = {
  ok: failedChecks.length === 0,
  contract: "daytrade_mother_pool_snapshot_verifier_v1",
  checked_at: new Date().toISOString(),
  writer_path: writerPath,
  five_minute_current_runner_path: current5mPath,
  snapshot_path: snapshotPath,
  runtime_snapshot_present: Boolean(snapshot),
  runtime_snapshot: snapshot ? {
    trade_date: snapshot.trade_date,
    run_id: snapshot.run_id,
    canonical_run_id: snapshot.canonical_run_id,
    snapshot_sequence: snapshot.snapshot_sequence,
    snapshot_type: snapshot.snapshot_type,
    generated_at: snapshot.generated_at,
    effective_at: snapshot.effective_at,
    symbol_count: snapshot.symbol_count,
    added_symbols: snapshot.added_symbols,
    removed_symbols: snapshot.removed_symbols,
    downstream_warmup_pending_symbols: snapshot.downstream_warmup_pending_symbols,
  } : null,
  checks,
  failed_checks: failedChecks,
  first_blocker: failedChecks[0] || null,
  read_only: true,
};

console.log(JSON.stringify(output, null, 2));
process.exitCode = failedChecks.length ? 1 : 0;
