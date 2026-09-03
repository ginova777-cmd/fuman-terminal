const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_ROOT = process.env.FUMAN_RUNTIME_DIR || process.env.FUMAN_RUNTIME_ROOT || (process.platform === "win32" ? "C:\\fuman-runtime" : ROOT);
const writerFile = path.join(ROOT, "scripts", "run-daytrade-source-writer.js");
const notifierFile = path.join(ROOT, "scripts", "notify-daytrade-intraday-burst-telegram.js");
const telegramFile = path.join(ROOT, "scripts", "telegram-push.js");
const guardFile = path.join(ROOT, "scripts", "notification-guard.js");
const runnerFile = path.join(ROOT, "run-daytrade-intraday-burst-telegram.ps1");
const installerFile = path.join(ROOT, "scripts", "install-daytrade-intraday-burst-telegram-task.ps1");
const outboxFile = path.join(RUNTIME_ROOT, "state", "daytrade-intraday-burst-telegram-outbox.json");
const receiptFile = path.join(RUNTIME_ROOT, "data", "scan-receipts", "daytrade-intraday-burst-telegram-" + taipeiDate().replace(/-/g, "") + ".json");

function read(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}
function readJson(file) {
  try { return JSON.parse(read(file)); } catch { return null; }
}
function taipeiDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}
function includesAll(source, fragments) {
  return fragments.every((fragment) => source.includes(fragment));
}
function readLiveTask() {
  if (process.platform !== "win32") return { applicable: false };
  const command = "$task=Get-ScheduledTask -TaskName 'Fuman Mother Pool Telegram 0900-1230' -ErrorAction SilentlyContinue;if(-not $task){[pscustomobject]@{exists=$false}|ConvertTo-Json -Compress;exit 0};$action=$task.Actions|Select-Object -First 1;$info=Get-ScheduledTaskInfo -TaskName $task.TaskName;$trigger=$task.Triggers|Select-Object -First 1;$state=switch([int]$task.State){2{'Queued'}3{'Ready'}4{'Running'}default{[string]$task.State}};[pscustomobject]@{exists=$true;state=$state;arguments=[string]$action.Arguments;workingDirectory=[string]$action.WorkingDirectory;lastResult=[long]$info.LastTaskResult;start=[string]$trigger.StartBoundary;interval=[string]$trigger.Repetition.Interval;duration=[string]$trigger.Repetition.Duration;stopAtDurationEnd=[bool]$trigger.Repetition.StopAtDurationEnd;multipleInstances=[string]$task.Settings.MultipleInstances}|ConvertTo-Json -Compress";
  const result = spawnSync("C:\\Program Files\\PowerShell\\7\\pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", timeout: 15000, windowsHide: true });
  try { return JSON.parse(String(result.stdout || "").trim()); }
  catch { return { exists: false, error: String(result.stderr || result.error?.message || "live_task_query_failed").trim() }; }
}

const writer = read(writerFile);
const notifier = read(notifierFile);
const telegram = read(telegramFile);
const guard = read(guardFile);
const runner = read(runnerFile);
const installer = read(installerFile);
const requireLive = process.argv.includes("--require-live");
const requireToday = process.argv.includes("--require-today");
const liveTask = requireLive ? readLiveTask() : { required: false };
const checks = {
  writer_readable: Boolean(writer),
  notifier_readable: Boolean(notifier),
  writer_never_invokes_notifier: !writer.includes("notifyFromOutbox")
    && !writer.includes("notify-daytrade-intraday-burst-telegram"),
  exact_price_rule: includesAll(writer, [
    "latest1mClose >= priceTriggerLevel",
    "trigger_type: \"price_breakout_1pct\"",
    "price_trigger_level: priceTriggerLevel",
  ]),
  exact_volume_rule: includesAll(writer, [
    "latest1mVolume >= volumeTriggerLevel",
    "trigger_type: \"volume_burst_rolling60_x2\"",
    "volume_trigger_level: volumeTriggerLevel",
  ]),
  mother_pool_only_source: includesAll(writer, [
    "const burstRows = priorityRows;",
    "tradableMotherPool",
    "not_daytrade_mother_pool_eligible",
    "strategy2_mother_pool_only_0900_1230",
  ]),
  dedicated_task_contract: includesAll(runner, ["notify-daytrade-intraday-burst-telegram.js"]) && includesAll(installer, ["Fuman Mother Pool Telegram 0900-1230", "<Interval>PT1M</Interval>", "<Duration>PT3H31M</Duration>", "<StopAtDurationEnd>true</StopAtDurationEnd>", "<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>", "<LogonType>S4U</LogonType>", "<RunLevel>HighestAvailable</RunLevel>", "<Monday />", "<Friday />", "Register-ScheduledTask -TaskName $TaskName -Xml $taskXml -Force"]),
  outbox_hooked_after_delta: includesAll(writer, [
    "const burstRows = priorityRows;",
    "writeIntradayBurstTelegramOutbox(burstRows, tradeDate, checkedAt, runId, result?.quoteMap)",
    "strategy2_mother_pool_only_0900_1230",
    "INTRADAY_BURST_TELEGRAM_OUTBOX_FILE",
  ]),
  telegram_strict_only_contract: includesAll(writer, [
    "trigger_type: \"price_breakout_1pct\"",
    "trigger_type: \"volume_burst_rolling60_x2\"",
    "const hotRankFallbackEventCount = 0;",
    "telegram only sends price_breakout_1pct and volume_burst_rolling60_x2",
    "rejected_reason_counts",
    "sample_rejected",
  ]) && !writer.includes("events.push(...hotRankFallbackEvents"),
  price_quote_map_fallback_contract: includesAll(writer, [
    "writeIntradayBurstTelegramOutbox(rows, tradeDate, checkedAt, runId, quoteMap = new Map())",
    "const quote = quoteMap instanceof Map ? (quoteMap.get(symbol) || {}) : {}",
    "quotePayload.price",
    "ageSeconds(quoteFreshnessTime(quote)) <= WINDOW_SECONDS",
    "writeIntradayBurstTelegramOutbox(burstRows, tradeDate, checkedAt, runId, result?.quoteMap)",
    "result.quoteMap = quoteMap",
  ]),
  fugle_candle_cache_baseline_contract: includesAll(writer, [
    "buildIntradayBurstCandleCacheBySymbol",
    "readFugleWebSocketCandles({ maxAgeMs: 90 * 60 * 1000 })",
    "buildIntradayBurstMetricsFromCandleCache",
    "cache_rolling_1m_baseline_source",
    "candle_cache_symbol_count",
    "cache_rolling_1m_ready_count",
  ]),
  computed_strict_burst_rule_contract: includesAll(writer, [
    "const priceRuleMet = rollingHigh > 0 && latest1mClose >= priceTriggerLevel",
    "const volumeRuleMet = rollingVolume > 0 && latest1mVolume >= volumeTriggerLevel",
    "(metrics.intradayPriceBurst1Pct === true || priceRuleMet)",
    "(metrics.intradayVolumeBurstRolling60X2 === true || volumeRuleMet)",
  ]),
  technical_indicator_gate_contract: includesAll(writer, [
    "buildIntradayTechnicalIndicators",
    "kd_parameters: { rsv_period: 5, k_smoothing: 3, d_smoothing: 3 }",
    "rsi_parameters: { fast_period: 4, slow_period: 6, method: \"wilder\" }",
    "macd_parameters: { fast_period: 7, slow_period: 12, signal_period: 20 }",
    "technical_golden_cross_any === true",
    "technical_golden_cross_not_met",
    "technical_indicator_readback: technicalIndicatorReadback",
    "min_rolling_samples: 60",
  ]),
  notifier_strict_trigger_contract: includesAll(notifier, [
    "price_breakout_1pct",
    "volume_burst_rolling60_x2",
    "瞬間拉抬",
    "瞬間巨量",
  ]),
  formal_1m_data_gate: includesAll(notifier, [
    "source: \"fugle_formal_1m\"",
    "rolling_1m_baseline_status",
    "rolling_1m_baseline_not_ready",
    "rolling_1m_samples_below_60",
    "technical_indicator_not_ready",
    "technical_golden_cross_not_met",
    "kd_5_3_3",
    "rsi_4_cross_6",
    "macd_7_12_20",
  ]),
  price_and_quote_gate: includesAll(notifier, [
    "price_below_50",
    "quote_not_fresh",
    "quote_age_seconds",
    "tradable_mother_pool !== true",
    "outbox_scope_not_mother_pool_only",
  ]),
  time_and_dedupe_gate: includesAll(notifier, [
    "return minutes >= 540 && minutes <= 750",
    "COOLDOWN_SECONDS",
    "cooldown_active",
    "idempotencyKey",
  ]),
  notification_is_radar_only: includesAll(notifier, [
    "非正式候選、非下單訊號",
    "motherPoolIntradayBurstTelegram: true",
  ]),
  telegram_result_readback: includesAll(telegram, [
    "const results = [];",
    "return results;",
    "sent: result.sent === true",
  ]),
  narrowly_scoped_guard: includesAll(guard, [
    "allowMotherPoolBurstTelegram",
    "FUMAN_ALLOW_DAYTRADE_BURST_TELEGRAM",
    "options.motherPoolIntradayBurstTelegram === true",
  ]),
  no_token_in_contract: !notifier.includes("TELEGRAM_BOT_TOKEN") && !notifier.includes("TELEGRAM_CHAT_ID"),
  same_day_sent_receipt_history_preserved: includesAll(notifier, [
    "function writeReceiptWithHistory",
    "receipt.sent_event_count",
    "sentEventsFromState",
    "cannot erase a proven same-day send",
  ]),
  canonical_sent_receipt_contract: includesAll(notifier, [
    "canonicalSentEvent",
    "telegramIdempotencyKey",
    "event_key",
    "tradeDate",
    "event_time",
    "send_result: \"sent\"",
    "const attemptSentCount",
    "sent_events: attemptSentCount",
  ]),
};

if (requireLive) {
  checks.live_task_exists_enabled = liveTask.exists === true && ["Ready", "Running", "Queued"].includes(String(liveTask.state || ""));
  checks.live_task_fixed_release_root = /C:\\fuman-release-owner\\fuman-terminal\\run-daytrade-intraday-burst-telegram\.ps1/i.test(String(liveTask.arguments || "")) && String(liveTask.workingDirectory || "").toLowerCase() === ROOT.toLowerCase();
  checks.live_task_exact_window = /T09:00:00/.test(String(liveTask.start || "")) && String(liveTask.interval || "") === "PT1M" && String(liveTask.duration || "") === "PT3H31M" && liveTask.stopAtDurationEnd === true;
  checks.live_task_ignore_new = String(liveTask.multipleInstances || "") === "IgnoreNew";
  checks.live_task_last_result_ok = Number(liveTask.lastResult) === 0;
}

const outbox = readJson(outboxFile);
const receipt = readJson(receiptFile);
const receiptSentEvents = Array.isArray(receipt?.sent_events) ? receipt.sent_events : [];
const receiptEventKeys = receiptSentEvents.map((event) => String(event?.event_key || ""));
const expectedAlertScope = "strategy2_mother_pool_only_0900_1230_with_same_day_fugle_1m_coverage";
const outboxEvents = Array.isArray(outbox?.events) ? outbox.events : [];
checks.runtime_outbox_mother_pool_scope = !outbox || String(outbox.alert_scope || "") === expectedAlertScope;
checks.runtime_events_mother_pool_only = !outbox || outboxEvents.every((event) =>
  event?.tradable_mother_pool === true
  && String(event?.trade_date || "") === String(outbox?.trade_date || "")
  && String(event?.source || outbox?.source || "") === "fugle_formal_1m"
);
checks.runtime_receipt_canonical_fields = !receipt || receiptSentEvents.every((event) =>
  Boolean(event?.event_key)
  && String(event?.tradeDate || "") === String(receipt?.trade_date || "")
  && String(event?.trade_date || "") === String(receipt?.trade_date || "")
  && /^\d{4}$/.test(String(event?.symbol || ""))
  && Boolean(event?.event_time)
  && Boolean(event?.sent_at)
  && event?.sent === true
  && String(event?.send_result || "") === "sent"
);
checks.runtime_receipt_event_keys_unique = !receipt || receiptEventKeys.length === new Set(receiptEventKeys).size;
checks.runtime_receipt_count_matches = !receipt || Number(receipt?.sent_event_count) === receiptSentEvents.length;
if (requireToday) {
  checks.runtime_today_outbox_present = Boolean(outbox) && String(outbox?.trade_date || "") === taipeiDate();
  checks.runtime_today_receipt_present = Boolean(receipt) && String(receipt?.trade_date || "") === taipeiDate();
  checks.runtime_no_send_after_1230 = !receipt || receiptSentEvents.every((event) => taipeiMinutesFromIso(event?.sent_at) <= 750);
  checks.runtime_today_technical_indicator_readback_present = Array.isArray(outbox?.technical_indicator_readback) && outbox.technical_indicator_readback.length > 0;
  checks.runtime_today_events_require_technical_cross = outboxEvents.every((event) =>
    event?.technical_indicator_status === "ready"
    && event?.technical_golden_cross_any === true
    && Array.isArray(event?.technical_golden_cross_signals)
    && event.technical_golden_cross_signals.length > 0
  );
}

const rejectedReasonCounts = outbox?.rejected_reason_counts || null;
const candidateCount = Number.isFinite(Number(outbox?.candidate_count)) ? Number(outbox.candidate_count) : null;
const baselineRejectedCount = Number(rejectedReasonCounts?.rolling_1m_baseline_not_ready || 0);
const baselineRejectedRatio = candidateCount ? baselineRejectedCount / candidateCount : 0;
const cacheReadyCount = Number.isFinite(Number(outbox?.cache_rolling_1m_ready_count)) ? Number(outbox.cache_rolling_1m_ready_count) : null;
const candleCacheSymbolCount = Number.isFinite(Number(outbox?.candle_cache_symbol_count)) ? Number(outbox.candle_cache_symbol_count) : null;
const outboxUpdatedAt = outbox?.updated_at || "";
checks.runtime_technical_indicator_contract = !outbox?.technical_indicator_readback || outbox.technical_indicator_readback.every((row) =>
  row?.kd_parameters?.rsv_period === 5
  && row?.rsi_parameters?.fast_period === 4
  && row?.rsi_parameters?.slow_period === 6
  && row?.macd_parameters?.fast_period === 7
  && row?.macd_parameters?.slow_period === 12
  && row?.macd_parameters?.signal_period === 20
  && typeof row?.technical_golden_cross_any === "boolean"
);
function taipeiMinutesFromIso(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return 0;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}
const outboxTaipeiMinutes = taipeiMinutesFromIso(outboxUpdatedAt);
const baselineRuntimeHealthy = !outbox
  || candidateCount === 0
  || outboxTaipeiMinutes < 9 * 60 + 25
  || baselineRejectedRatio <= 0.5;
const runtime = {
  outbox_path: outboxFile,
  outbox_exists: Boolean(outbox),
  outbox_trade_date: outbox?.trade_date || null,
  outbox_is_today: String(outbox?.trade_date || "") === taipeiDate(),
  outbox_alert_scope: outbox?.alert_scope || null,
  outbox_scope_is_mother_pool_only: checks.runtime_outbox_mother_pool_scope,
  outbox_events_are_mother_pool_only: checks.runtime_events_mother_pool_only,
  outbox_event_count: Array.isArray(outbox?.events) ? outbox.events.length : 0,
  receipt_path: receiptFile,
  receipt_exists: Boolean(receipt),
  receipt_sent_event_count: receiptSentEvents.length,
  receipt_event_keys_unique: checks.runtime_receipt_event_keys_unique,
  receipt_canonical_fields: checks.runtime_receipt_canonical_fields,
  receipt_last_attempt_sent_events: Number(receipt?.last_attempt?.sent_events || 0),
  strict_burst_event_count: Number.isFinite(Number(outbox?.strict_burst_event_count)) ? Number(outbox.strict_burst_event_count) : null,
  hot_rank_fallback_event_count: Number.isFinite(Number(outbox?.hot_rank_fallback_event_count)) ? Number(outbox.hot_rank_fallback_event_count) : null,
  candidate_count: candidateCount,
  rejected_reason_counts: rejectedReasonCounts,
  candle_cache_symbol_count: candleCacheSymbolCount,
  cache_rolling_1m_ready_count: cacheReadyCount,
  rolling_1m_baseline_rejected_count: baselineRejectedCount,
  rolling_1m_baseline_rejected_ratio: Number(baselineRejectedRatio.toFixed(4)),
  rolling_1m_baseline_runtime_healthy: baselineRuntimeHealthy,
  runtime_status: outbox ? (baselineRuntimeHealthy ? "available" : "rolling_1m_baseline_not_ready") : "awaiting_next_writer_tick",
  live_task: liveTask,
};

checks.runtime_rolling_1m_baseline_available = baselineRuntimeHealthy;const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({
  ok: failedChecks.length === 0,
  contract: "daytrade_intraday_burst_telegram_verifier_v1",
  checked_at: new Date().toISOString(),
  checks,
  runtime,
  failed_checks: failedChecks,
  first_blocker: failedChecks[0] || null,
  read_only: true,
}, null, 2));
process.exitCode = failedChecks.length ? 1 : 0;









