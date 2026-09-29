const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WRITER = path.join(ROOT, "scripts", "run-daytrade-source-writer.js");
const RUNTIME_ROOT = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const WRITE_RECEIPT = process.argv.includes("--write-receipt");
const RUNTIME_MANIFEST = process.env.DAYTRADE_PRIORITY_SYMBOLS_FILE
  || path.join(RUNTIME_ROOT, "cache", "intraday", "fugle-daytrade-ws-priority-symbols.json");

const checks = [];
function check(ok, name, detail = undefined) {
  checks.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) });
}

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const writer = fs.readFileSync(WRITER, "utf8");
check(/key:\s*"strategy3"[\s\S]{0,120}protectedApi:\s*true/.test(writer), "strategy3_uses_protected_canonical_api");
check(writer.includes("/api/strategy3-latest?date="), "strategy3_canonical_endpoint_present");
check(writer.includes("for (let daysBack = 1; daysBack <= 7; daysBack += 1)"), "strategy3_previous_complete_run_window_present");
check(writer.includes("payload.complete === true"), "strategy3_complete_required");
check(writer.includes("payload.publishAllowed === true"), "strategy3_publish_allowed_required");
check(writer.includes('String(payload.evidenceStatus || "").toLowerCase() === "complete"'), "strategy3_evidence_complete_required");
check(writer.includes('String(payload.unattendedStatus || "").toUpperCase() === "YES"'), "strategy3_unattended_yes_required");
check(writer.includes("payload.fallbackUsed !== true"), "strategy3_fallback_rejected");
check(/addMany\("strategy3",\s*payload\.strategy3\s*\|\|\s*payload\.strategy3Symbols\s*\|\|\s*bridgeValues\("strategy3"\),\s*80\)/.test(writer), "strategy3_independent_attribution_added");
check(!writer.includes("counts.strategy3 = 0"), "legacy_strategy3_zero_attribution_removed");

let runtime = null;
try { runtime = JSON.parse(fs.readFileSync(RUNTIME_MANIFEST, "utf8")); } catch {}
check(Boolean(runtime), "runtime_manifest_readable", RUNTIME_MANIFEST);
if (runtime) {
  const tradeDate = taipeiDate();
  const expectedCanonicalRunId = `fugle_daytrade_source:${tradeDate.replace(/-/g, "")}:canonical`;
  const group = runtime.priorityBridge?.groups?.strategy3 || {};
  const symbols = Array.isArray(group.symbols) ? group.symbols : [];
  const uniqueSymbols = [...new Set(symbols)];
  check(runtime.tradeDate === tradeDate, "runtime_trade_date_is_today", runtime.tradeDate);
  check(runtime.canonicalRunId === expectedCanonicalRunId, "runtime_canonical_run_id_matches_today", runtime.canonicalRunId);
  check(group.status === "ready", "runtime_strategy3_group_ready", group.reason || "");
  check(group.source === "protected_canonical_api:/api/strategy3-latest", "runtime_strategy3_source_is_canonical", group.source);
  check(group.qualityStatus === "complete", "runtime_strategy3_quality_complete", group.qualityStatus);
  check(group.publishAllowed === true, "runtime_strategy3_publish_allowed", group.publishAllowed);
  check(typeof group.runId === "string" && group.runId.length > 0, "runtime_strategy3_run_id_present", group.runId);
  check(symbols.length > 0 && symbols.length === uniqueSymbols.length && symbols.every((symbol) => /^\d{4}$/.test(symbol)), "runtime_strategy3_symbols_valid_unique", symbols.length);
  check(runtime.priorityBridge?.counts?.strategy3 === symbols.length, "runtime_strategy3_count_matches_symbols", runtime.priorityBridge?.counts?.strategy3);
  const mother = Array.isArray(runtime.daytradeMotherPoolSymbols) ? runtime.daytradeMotherPoolSymbols : [];
  const terminal = Array.isArray(runtime.terminalPrioritySymbols) ? runtime.terminalPrioritySymbols : [];
  check(mother.length > 0, "runtime_mother_pool_union_present", mother.length);
  check(terminal.length >= mother.length, "runtime_terminal_union_not_replaced_by_strategy3", { terminal: terminal.length, mother: mother.length, strategy3: symbols.length });
}

const failedChecks = checks.filter((item) => !item.ok);
let receipt = {
  ok: failedChecks.length === 0,
  complete: failedChecks.length === 0,
  contract: "daytrade_strategy3_independent_attribution_runner_verifier_receipt_v1",
  checkedAt: new Date().toISOString(),
  tradeDate: taipeiDate(),
  runtimeManifest: RUNTIME_MANIFEST,
  checks,
  failedChecks: failedChecks.map((item) => item.name),
  firstBlocker: failedChecks[0]?.name || null,
  createsFormalCandidate: false,
  publishAllowed: false,
};

if (WRITE_RECEIPT) {
  const receiptPath = path.join(
    RUNTIME_ROOT,
    "data",
    "scan-receipts",
    `daytrade-strategy3-independent-attribution-${receipt.tradeDate.replace(/-/g, "")}.json`,
  );
  receipt = { ...receipt, receiptPath };
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
process.exitCode = receipt.complete ? 0 : 1;
