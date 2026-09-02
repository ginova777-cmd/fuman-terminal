const fs = require("fs");
const path = require("path");

const arg = (name, fallback = "") => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const root = arg("root", "C:/Users/ginov/Documents/Codex/futopt-v4-retire-legacy");
const runtime = arg("runtime", process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime");
const taipeiDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
const tradeDate = arg("trade-date", taipeiDate);
const writerPath = path.join(root, "scripts", "run-daytrade-source-writer.js");
const receiptPath = arg("receipt", path.join(runtime, "data", "scan-receipts", `daytrade-futopt-spot-joint-strength-${tradeDate.replace(/-/g, "")}.json`));
const writer = fs.readFileSync(writerPath, "utf8");
const receipt = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, "utf8")) : null;
const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date()).reduce((out, item) => ({ ...out, [item.type]: item.value }), {});
const minute = Number(parts.hour) * 60 + Number(parts.minute);
const marketSession = tradeDate === taipeiDate && !["Sat", "Sun"].includes(parts.weekday) && minute >= 540 && minute <= 810;
const receiptRequired = arg("require-receipt", marketSession ? "1" : "0") === "1";

const checks = {
  runner_present: writer.includes("function writeFutoptSpotJointStrengthReceipt(priorityRows)"),
  runner_writes_receipt: writer.includes("daytrade-futopt-spot-joint-strength-"),
  fresh_rows_not_pre_filtered_by_preopen_threshold: !writer.includes("if (change < 2 || relative < 1 || volume < 50) continue;"),
  quote_fresh_required: writer.includes("const stockFutureIntradaySpotJointStrength = quoteFresh"),
  futopt_fresh_180s_required: writer.includes("ageSeconds(stockFuture.futoptUpdatedAt) <= 180"),
  futopt_gain_ge_1_required: writer.includes("stockFuture.futoptChangePercent >= 1"),
  spot_gain_ge_1_required: writer.includes("changePercent >= 1"),
  entry_and_upgrade_boost: writer.includes("entryScore += 240") && writer.includes("upgradeScore += 360"),
  dynamic_union_enabled: writer.includes("futopt_spot_joint_strength: metrics.stockFutureIntradaySpotJointStrength"),
  deep_scan_enabled: writer.includes("|| futoptSpotJointStrength;"),
  candle_priority_enabled: writer.includes('futoptSpotJointStrength ? "intraday_futopt_spot_joint_strength"'),
  receipt_exists_or_not_required: !receiptRequired || Boolean(receipt),
  receipt_contract: !receiptRequired || receipt?.contract === "daytrade_futopt_spot_joint_strength_receipt_v1",
  receipt_trade_date: !receiptRequired || receipt?.trade_date === tradeDate,
  receipt_status: !receiptRequired || ["MATCHED", "NO_MATCH"].includes(receipt?.status),
  receipt_symbols_array: !receiptRequired || Array.isArray(receipt?.matched_symbols),
  receipt_publish_guard: !receiptRequired || (receipt?.formal_candidate_count === 0 && receipt?.formal_candidate_allowed === false && receipt?.forbidden_publish_guard === true),
};

const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
const result = {
  ok: failedChecks.length === 0,
  contract: "daytrade_futopt_spot_joint_strength_runner_verifier_receipt_v1",
  trade_date: tradeDate,
  checked_at: new Date().toISOString(),
  market_session: marketSession,
  receipt_required: receiptRequired,
  receipt_path: receiptPath,
  receipt_exists: Boolean(receipt),
  receipt_status: receipt?.status || null,
  matched_count: Number(receipt?.matched_count || 0),
  matched_symbols: receipt?.matched_symbols || [],
  thresholds: { futopt_change_percent_min: 1, spot_change_percent_min: 1, futopt_fresh_seconds_max: 180, entry_score_boost: 240, upgrade_score_boost: 360 },
  allowed_action: "boost_mother_priority_hot_deep_scan_only",
  formal_candidate_allowed: false,
  checks,
  failed_checks: failedChecks,
  first_blocker: failedChecks[0] || null,
  read_only: true,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;
