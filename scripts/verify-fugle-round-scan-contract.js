const fs = require("fs");
const path = require("path");

const runtime = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const statusFile = process.env.FUGLE_WS_STATUS_FILE
  || path.join(runtime, "state", "fugle-daytrade-websocket-status-v2.json");
const receiptFile = path.join(runtime, "data", "scan-receipts", "fugle-round-scan.json");
const read = (file) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
};
const status = read(statusFile) || {};
const selected = Array.isArray(status.roundScanSymbols) ? status.roundScanSymbols : [];
const quotas = status.roundScanQuotas || {};
const failed = [];
const add = (ok, code) => { if (!ok) failed.push(code); };
const taipeiNow = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei", hour12: false, hour: "2-digit", minute: "2-digit",
}).format(new Date());
const [taipeiHour, taipeiMinute] = taipeiNow.split(":").map(Number);
const roundScanDue = (taipeiHour * 60 + taipeiMinute) >= 540 && (taipeiHour * 60 + taipeiMinute) <= 810;
if (!roundScanDue) {
  const pending = {
    contract: "fugle-round-scan-verifier-v1",
    checked_at: new Date().toISOString(),
    status_file: statusFile,
    source_updated_at: status.updatedAt || "",
    round_scan_contract: status.roundScanContract || "",
    round_scan_limit: Number(status.roundScanLimit || 0),
    selected_count: selected.length,
    selected_symbols: selected,
    quotas,
    counts: status.roundScanCounts || {},
    next_cursor: Number(status.roundScanNextCursor ?? -1),
    failed_checks: [],
    first_blocker: null,
    status: "pending",
    complete: false,
    pending_reason: "round_scan_not_due_outside_09:00-13:30_Asia_Taipei",
  };
  fs.mkdirSync(path.dirname(receiptFile), { recursive: true });
  fs.writeFileSync(receiptFile, JSON.stringify(pending, null, 2) + "\n");
  console.log(JSON.stringify(pending, null, 2));
  process.exit(0);
}
add(status.roundScanContract === "fugle-round-scan-event50-strong25-strategy15-fair10-v1", "contract_mismatch");
add(Number(status.roundScanLimit || 0) > 0 && Number(status.roundScanLimit || 0) <= 60, "round_limit_invalid");
add(selected.length <= Number(status.roundScanLimit || 60), "selected_over_round_limit");
add(new Set(selected).size === selected.length, "duplicate_symbols");
add(Number(quotas.event || 0) + Number(quotas.strong || 0) + Number(quotas.strategy || 0) + Number(quotas.fair || 0) === Number(status.roundScanLimit || 60), "quota_sum_invalid");
add(Number(status.roundScanNextCursor ?? -1) >= 0, "cursor_not_persisted");
const receipt = {
  contract: "fugle-round-scan-verifier-v1",
  checked_at: new Date().toISOString(),
  status_file: statusFile,
  source_updated_at: status.updatedAt || "",
  round_scan_contract: status.roundScanContract || "",
  round_scan_limit: Number(status.roundScanLimit || 0),
  selected_count: selected.length,
  selected_symbols: selected,
  quotas,
  counts: status.roundScanCounts || {},
  next_cursor: Number(status.roundScanNextCursor ?? -1),
  failed_checks: failed,
  first_blocker: failed[0] || null,
  status: failed.length ? "failed" : "complete",
  complete: failed.length === 0,
};
fs.mkdirSync(path.dirname(receiptFile), { recursive: true });
fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt, null, 2));
process.exitCode = failed.length ? 1 : 0;
