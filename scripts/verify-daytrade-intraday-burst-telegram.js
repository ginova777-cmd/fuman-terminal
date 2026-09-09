const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { eventMessage, sideVolumeEvents, validSideVolumeEvent } = require("./notify-daytrade-intraday-burst-telegram");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_ROOT = process.env.FUMAN_RUNTIME_DIR || process.env.FUMAN_RUNTIME_ROOT || (process.platform === "win32" ? "C:\\fuman-runtime" : ROOT);
const writerFile = path.join(ROOT, "scripts", "run-daytrade-source-writer.js");
const notifierFile = path.join(ROOT, "scripts", "notify-daytrade-intraday-burst-telegram.js");
const canonicalWaterReaderFile = path.join(ROOT, "lib", "daytrade-canonical-water-reader.js");
const telegramFile = path.join(ROOT, "scripts", "telegram-push.js");
const guardFile = path.join(ROOT, "scripts", "notification-guard.js");
const runnerFile = path.join(ROOT, "run-daytrade-intraday-burst-telegram.ps1");
const installerFile = path.join(ROOT, "scripts", "install-daytrade-intraday-burst-telegram-task.ps1");
const packageFile = path.join(ROOT, "package.json");
const masterControlFile = path.join(ROOT, "run-terminal-master-control.ps1");
const outboxFile = path.join(RUNTIME_ROOT, "state", "daytrade-intraday-burst-telegram-outbox.json");
const receiptFile = path.join(RUNTIME_ROOT, "data", "scan-receipts", "daytrade-intraday-burst-telegram-" + taipeiDate().replace(/-/g, "") + ".json");
const runnerReceiptFile = path.join(RUNTIME_ROOT, "data", "scan-receipts", "daytrade-intraday-burst-telegram-runner-" + taipeiDate().replace(/-/g, "") + ".json");

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
  // Encode the command so nested task/action quoting cannot be altered by the
  // Windows process command-line parser.
  const encodedCommand = Buffer.from(command, "utf16le").toString("base64");
  const result = spawnSync("C:\\Program Files\\PowerShell\\7\\pwsh.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand], { encoding: "utf8", timeout: 15000, windowsHide: true });
  try { return JSON.parse(String(result.stdout || "").trim()); }
  catch { return { exists: false, error: String(result.stderr || result.error?.message || "live_task_query_failed").trim() }; }
}

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const writer = read(writerFile);
const notifier = read(notifierFile);
const canonicalWaterReader = read(canonicalWaterReaderFile);
const telegram = read(telegramFile);
const guard = read(guardFile);
const runner = read(runnerFile);
const installer = read(installerFile);
const packageSource = read(packageFile);
const masterControl = read(masterControlFile);
const quoteReadBlock = canonicalWaterReader.match(/quoteRows\.push\(\.\.\.await readRows\(key, QUOTE_TABLE,[\s\S]*?\}, \{ timeout: 15000 \}\)\);/)?.[0] || "";
const formalTelegramVerifierFiles = (() => {
  try {
    return fs.readdirSync(path.join(ROOT, "scripts"))
      .filter((name) => /^verify-daytrade-intraday-burst-.*\.js$/i.test(name)
        || /^verify-.*daytrade.*telegram.*\.js$/i.test(name)
        || /^verify-.*telegram.*daytrade.*\.js$/i.test(name))
      .sort();
  } catch { return []; }
})();
const requireLive = process.argv.includes("--require-live");
const requireToday = process.argv.includes("--require-today");
const liveTaskEvidenceFile = argValue("live-task-evidence");
const releaseAuthority = readJson(path.join(ROOT, "data", "contracts", "release_root_authority_v1.json"));
const expectedTaskRoot = path.resolve(String(releaseAuthority?.sourceRoot || ROOT));
const liveTask = requireLive
  ? (liveTaskEvidenceFile ? { ...readJson(liveTaskEvidenceFile), evidence_file: liveTaskEvidenceFile } : readLiveTask())
  : { required: false };
const sideFixtureNow = new Date("2026-09-09T02:00:30.000Z").getTime();
const sideFixtureDate = "2026-09-09";
function sideFixture(overrides = {}) {
  return {
    symbol: "2303", name: "聯電", price: 43.5,
    inside_volume: 500, outside_volume: 20000,
    outside_inside_ratio: 40, side_volume_available: true,
    side_volume_unit: "lots", outside_volume_gt_inside_times_2: true,
    side_volume_source_event_at: "2026-09-09T02:00:00.000Z",
    side_volume_trade_date: sideFixtureDate,
    side_volume_canonical_run_id: "fugle_daytrade_source:20260909:canonical",
    quote_age_seconds: 30,
    ...overrides,
  };
}
function derivedSideEvents(row) {
  return sideVolumeEvents({ poolBySymbol: new Map([[String(row.symbol), row]]) }, sideFixtureDate, sideFixtureNow, []);
}
const validSideFixtureEvents = derivedSideEvents(sideFixture());
const checks = {
  writer_readable: Boolean(writer),
  notifier_readable: Boolean(notifier),
  canonical_water_reader_readable: Boolean(canonicalWaterReader),
  single_canonical_telegram_verifier: formalTelegramVerifierFiles.length === 1
    && formalTelegramVerifierFiles[0] === "verify-daytrade-intraday-burst-telegram.js",
  no_retired_verifier_reference: includesAll(packageSource, [
    '"verify:daytrade-burst-telegram": "node scripts/verify-daytrade-intraday-burst-telegram.js"',
  ]) && !/verify:daytrade[^"\r\n]*telegram[^"\r\n]*":(?!\s*"node scripts\/verify-daytrade-intraday-burst-telegram\.js")/i.test(packageSource)
    && includesAll(masterControl, ["scripts\\verify-daytrade-intraday-burst-telegram.js"]),
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
  missed_candle_replay_contract: includesAll(writer, [
    "INTRADAY_BURST_REPLAY_MAX_AGE_SECONDS",
    "for (let offset = 1; offset < cachedCandles.length; offset += 1)",
    "replayed_missed_candle: true",
    "replayMetrics.latest_1m_close >= replayPriceTriggerLevel",
    "replayMetrics.latest_1m_volume >= replayVolumeTriggerLevel",
  ]),
  mother_pool_only_source: includesAll(writer, [
    "const burstRows = priorityRows;",
    "tradableMotherPool",
    "not_daytrade_mother_pool_eligible",
    "daytrade_mother_pool_only_0900_1230",
  ]),
  dedicated_task_contract: includesAll(runner, ["notify-daytrade-intraday-burst-telegram.js"]) && includesAll(installer, ["Fuman Mother Pool Telegram 0900-1230", "<Interval>PT1M</Interval>", "<Duration>PT3H31M</Duration>", "<StopAtDurationEnd>true</StopAtDurationEnd>", "<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>", "<LogonType>InteractiveToken</LogonType>", "<RunLevel>LeastPrivilege</RunLevel>", "<Monday />", "<Friday />", "Register-ScheduledTask -TaskName $TaskName -Xml $taskXml -Force"]),
  runner_receipt_contract: includesAll(runner, [
    "daytrade_intraday_burst_telegram_runner_v1",
    "daytrade-intraday-burst-telegram-runner-",
    'contract_version = $contractVersion',
    'canonical_run_id = $canonicalRunId',
    'accepted_mother_pool_symbols',
    "started_at = $startedAt",
    "finished_at = $finishedAt",
    "exit_code = $exitCode",
    "notifier_receipt_path",
    "notifier_receipt_verified = $notifierReceiptVerified",
    "failed_checks = $failedChecks",
    "first_blocker = $firstBlocker",
    "$notifierReceiptRaw = Get-Content -LiteralPath $notifierReceiptFile -Raw",
    "[regex]::Match($notifierReceiptRaw",
    "notifier_receipt_started_at_missing",
    "[Globalization.DateTimeStyles]::RoundtripKind",
    "$notifierStartedAt -ge $runnerStartedAt",
    "notifier_receipt_not_complete_or_stale",
    "$runnerSucceeded = ($exitCode -eq 0 -and $notifierReceiptVerified)",
    "complete = $runnerSucceeded",
    "Move-Item -LiteralPath $temporaryFile -Destination $receiptFile -Force",
    "exit $exitCode",
  ]),
  canonical_water_reader_contract: includesAll(canonicalWaterReader, [
    'SOURCE_NAME = "fugle_daytrade_source"',
    'SOURCE_STATUS_TABLE = "source_status"',
    'CANONICAL_GATE_VIEW = "v_fugle_daytrade_canonical_gate"',
    'UNATTENDED_GATE_VIEW = "v_fugle_daytrade_unattended_gate_status"',
    'MOTHER_POOL_CONTRACT_VERSION = "4.1.0"',
    'MOTHER_POOL_VIEW = "v_fugle_daytrade_mother_pool_v4_1"',
    'QUOTE_TABLE = "fugle_daytrade_quotes_live"',
    'INTRADAY_1M_STATUS_VIEW = "v_fugle_daytrade_intraday_1m_status"',
    'INTRADAY_1M_RPC = "get_fugle_daytrade_intraday_1m_latest_n"',
    'FIVE_MINUTE_VIEW = "v_fugle_intraday_5m_readback"',
    'reader_policy: "supabase_read_only_no_writer_no_fugle_fallback"',
    "mother_pool_capacity_is_hard_gate: false",
    "priority_fresh_quote_coverage_120s < 0.95",
    "quote_age_seconds > 90",
    "canonical_water_mother_pool_empty",
    'pageSize: 200',
    'canonical_water_mother_pool_contract_version_mismatch',
    'canonical_water_mother_pool_canonical_run_id_mismatch',
    'canonical_water_mother_pool_source_freshness_invalid',
    'canonical_water_mother_pool_retired_ma_field_present',
    'candleAge <= 120',
  ]),
  retired_mother_pool_view_absent: ![canonicalWaterReader, notifier, runner].some((source) => source.includes('"v_fugle_daytrade_' + 'mother_pool"')),
  retired_mother_pool_ma_absent: ["ma30", "ma35", "ma58", "ma5_ma10_ma35_bullish"].every((field) => {
    const readerHits = canonicalWaterReader.match(new RegExp(`\\b${field}\\b`, "gi")) || [];
    const notifierHits = notifier.match(new RegExp(`\\b${field}\\b`, "gi")) || [];
    return readerHits.length <= 1 && notifierHits.length === 0;
  }),
  canonical_water_reader_has_no_writer_authority: !canonicalWaterReader.includes("service_role")
    && !canonicalWaterReader.includes("FUGLE_API_TOKEN")
    && !canonicalWaterReader.includes("FUGLE_TOKEN")
    && !canonicalWaterReader.includes("method: \"PATCH\"")
    && !canonicalWaterReader.includes("method: \"DELETE\"")
    && !canonicalWaterReader.includes("Prefer: resolution=merge-duplicates"),
  canonical_water_field_mapping_contract: includesAll(canonicalWaterReader, [
    "function normalizeMotherPoolRow",
    "insideVolume",
    "outsideVolume",
    "outsideInsideRatio",
    "sideVolumeAvailable",
    "outsideVolumeGeInsideTimes2",
    "outsideVolumeGtInsideTimes2",
    "sourceFlags",
    "industrySignalFastInjectIndustries",
    "sectorStrengthScore",
    "sectorMemberActiveCount",
    "mother_pool_field_coverage",
    "side_volume_data_gap_rows",
  ]),
  quote_table_explicit_trade_date_contract: includesAll(canonicalWaterReader, [
    "function quoteTimestamp",
    "function quoteTradeDate",
    "function normalizeQuoteRow",
    "const explicitTradeDate",
    "trade_date: quoteTradeDate(row)",
    'quote_trade_date_policy: "require_explicit_fugle_daytrade_quotes_live_trade_date_v1"',
    "row?.quote_seen_at",
    "row?.last_trade_time",
    "canonical_quote_time",
    "normalizedQuoteRows",
  ]) && quoteReadBlock.includes("last_trade_time")
    && quoteReadBlock.includes(",trade_date,")
    && quoteReadBlock.includes("trade_date: `eq.${tradeDate}`"),
  retired_quote_trade_date_derivation_absent: !canonicalWaterReader.includes(
    'quote_trade_date_policy: "derive_asia_taipei_from_quote_seen_at_last_trade_time_updated_at"',
  ),
  notifier_uses_canonical_water_before_send: includesAll(notifier, [
    'require("../lib/daytrade-canonical-water-reader")',
    "await readCanonicalDaytradeWater",
    "telegramObservation: true",
    "receipt.canonical_water = canonicalWater.receipt",
    "if (!canonicalWater.ok)",
    'receipt.first_blocker = canonicalWater.firstBlocker || "canonical_water_data_gap"',
    "outbox_canonical_run_id_mismatch",
    "canonical_water_mother_pool_member",
    "canonical_water_quote_fresh",
    "canonical_water_intraday_1m_ready",
  ]),
  outbox_hooked_after_delta: includesAll(writer, [
    "const burstRows = priorityRows;",
    "writeIntradayBurstTelegramOutbox(burstRows, tradeDate, checkedAt, runId, result?.quoteMap, result?.industryUniverseRows)",
    "result.industryUniverseRows = activeSymbols.map",
    "daytrade_mother_pool_only_0900_1230",
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
    "writeIntradayBurstTelegramOutbox(rows, tradeDate, checkedAt, runId, quoteMap = new Map(), heatmapUniverseRows = rows)",
    "const quote = quoteMap instanceof Map ? (quoteMap.get(symbol) || {}) : {}",
    "quotePayload.price",
    "ageSeconds(quoteFreshnessTime(quote)) <= WINDOW_SECONDS",
    "writeIntradayBurstTelegramOutbox(burstRows, tradeDate, checkedAt, runId, result?.quoteMap, result?.industryUniverseRows)",
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
  industry_heatmap_flow_contract: includesAll(writer, [
    "finalizeIntradayIndustryHeatmap",
    "taiwan_domestic_detailed_industry+twse_tpex_mops_parent+fugle_formal_quote_full_market",
    "industry_subgroup_role: \"formal_domestic_industry_ranking\"",
    "industry_heatmap_universe: \"full_market_active_ordinary_stock\"",
    "IC生產製造\": \"IC代工",
    "CPU/ASIC/IP\": \"IC設計",
    "overseas_priority_role: \"mother_pool_priority_weight_only\"",
    "warmup_waiting_for_taiwan_open",
    "industry_flow_direction",
    "industry_net_flow_proxy",
    "top3_persistent_large_inflow_volume_price_confirmed",
    "sudden_large_inflow_volume_price_confirmed",
    "industry_not_top3_or_sudden_inflow",
    "flow_delta_proxy >= 500000000",
    "industry_volume_expansion_confirmed",
    "industry_price_rise_continuing",
    "volume_expansion_symbol_count",
    "previous_average_change_percent",
    "daytrade_industry_signal_fast_inject_v1",
    "industry_signal_fast_inject",
    "mother_pool_fast_inject_count",
    "expires_at",
  ]) && includesAll(notifier, [
    '"產業雷達: "',
    '"前三名持續流入"',
    '"盤中突發大額流入"',
    '"｜量價續強｜排行 "',
    "industry_heatmap_not_ready",
    "industry_flow_invalid",
    "industry_not_top3_or_sudden_inflow",
    "industry_volume_expansion_not_confirmed",
    "industry_price_rise_not_continuing",
  ]),
  notifier_strict_trigger_contract: includesAll(notifier, [
    "price_breakout_1pct",
    "volume_burst_rolling60_x2",
    "瞬間拉抬",
    "瞬間巨量",
  ]),
  outside_volume_radar_contract: includesAll(notifier, [
    'trigger_type: "outside_volume_gt_inside_x2"',
    '"當沖盤中雷達｜外盤強勢"',
    '"外盤：" + formatNumber(event.outside_volume, 0) + " 張"',
    '"內盤：" + formatNumber(event.inside_volume, 0) + " 張"',
    '"外內盤比：" + formatNumber(event.outside_inside_ratio, 2) + " 倍"',
    'outside > inside * 2',
    'row?.side_volume_available === true',
    'row?.side_volume_unit === "lots"',
    'row?.side_volume_trade_date === tradeDate',
    'row?.side_volume_canonical_run_id === canonicalRunId(tradeDate)',
    'nowMs - sourceEventMs <= 120000',
    'outside_volume_technical_cross_role: "bonus_only"',
    'dedupeScope: "daytrade-outside-volume:"',
    'maxEventAgeSec: 120',
  ]),
  outside_volume_reader_explicit_fields: includesAll(canonicalWaterReader, [
    "inside_volume,outside_volume,side_volume_total,side_volume_unit",
    "side_volume_source_event_at,side_volume_trade_date,side_volume_canonical_run_id",
    "outside_inside_ratio,side_volume_available,outside_volume_ge_inside_times_2,outside_volume_gt_inside_times_2",
  ]),
  outside_volume_radar_fixture_contract: validSideFixtureEvents.length === 1
    && validSideFixtureEvents[0].outside_inside_ratio === 40
    && validSideVolumeEvent(validSideFixtureEvents[0], sideFixtureDate, sideFixtureNow).length === 0
    && derivedSideEvents(sideFixture({ inside_volume: 500, outside_volume: 1000, outside_inside_ratio: 2, outside_volume_gt_inside_times_2: false })).length === 0
    && derivedSideEvents(sideFixture({ side_volume_available: false })).length === 0
    && derivedSideEvents(sideFixture({ side_volume_source_event_at: "2026-09-09T01:57:00.000Z" })).length === 0
    && eventMessage(validSideFixtureEvents[0]).includes("外內盤比：40 倍")
    && eventMessage(validSideFixtureEvents[0]).includes("技術狀態（加分項目）"),
  compact_notification_template_contract: includesAll(notifier, [
    '"入場價: " + formatNumber(event.latest_1m_close)',
    '"技術確認: " + technical',
    '"當沖盤中雷達｜" + eventLabel(event.trigger_type)',
  ]) && !includesAll(notifier, ["最新 1分K 收 ", "前置樣本 ", "僅為 Mother Pool 雷達提醒"]),
  five_minute_strong_hard_gate_contract: includesAll(notifier, [
    "v_fugle_intraday_5m_readback",
    "v_fugle_intraday_5m_verification_readback",
    "daytrade_intraday_5m_runner_verifier_receipt_v4",
    "daytrade_intraday_5m_branch_independent_strict_wait_v1",
    "golden-cross-any-macd-3-9-3-v4",
    "five-minute-indicators-macd-3-9-3-v4",
    "macd_3_9_3_golden_cross_5m",
    "macd_fast_period",
    "macd_slow_period",
    "macd_signal_period",
    "allBranchesFalse",
    "anyBranchTrue",
    "CONFIRMED_STRONG_5M",
    '" (5分K強)"',
    "five_minute_confirmation_required: true",
    'five_minute_required_status: "CONFIRMED_STRONG_5M"',
    "five_minute_not_confirmed_strong",
    "row?.bar_complete === true",
    "row?.data_gap_5m !== true",
    "FIVE_MINUTE_MAX_STALE_SECONDS",
  ]) && ["macd_dif_5m", "macd_signal_5m", "macd_golden_cross_5m", "macd_zero_cross_up_5m"].every((marker) => !notifier.includes(marker)),
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
  notification_is_radar_only: includesAll(notifier, ["motherPoolIntradayBurstTelegram: true"]),
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
    "complete: false",
    'status: "running"',
    "receipt.complete = true",
    'receipt.status = receipt.ok === true ? "complete" : "failed"',
    "receipt.finished_at = new Date().toISOString()",
    "min_rolling_samples: 60",
    "technical_cross_any",
  ]),
};

if (requireLive) {
  checks.live_task_exists_enabled = liveTask.exists === true && ["Ready", "Running", "Queued"].includes(String(liveTask.state || ""));
  checks.live_task_fixed_release_root = String(liveTask.arguments || "").toLowerCase().includes(path.join(expectedTaskRoot, "run-daytrade-intraday-burst-telegram.ps1").toLowerCase())
    && path.resolve(String(liveTask.workingDirectory || "")).toLowerCase() === expectedTaskRoot.toLowerCase();
  checks.live_task_exact_window = /T09:00:00/.test(String(liveTask.start || "")) && String(liveTask.interval || "") === "PT1M" && String(liveTask.duration || "") === "PT3H31M" && liveTask.stopAtDurationEnd === true;
  checks.live_task_ignore_new = String(liveTask.multipleInstances || "") === "IgnoreNew";
  checks.live_task_last_result_ok = Number(liveTask.lastResult) === 0;
}

const outbox = readJson(outboxFile);
const receipt = readJson(receiptFile);
const runnerReceipt = readJson(runnerReceiptFile);
const receiptSentEvents = Array.isArray(receipt?.sent_events) ? receipt.sent_events : [];
const currentCanonicalWaterReceipt = receipt?.canonical_water && typeof receipt.canonical_water === "object" ? receipt.canonical_water : null;
const lastCompleteCanonicalWaterReceipt = receipt?.last_complete_canonical_water && typeof receipt.last_complete_canonical_water === "object"
  ? receipt.last_complete_canonical_water
  : null;
const canonicalWaterReceipt = currentCanonicalWaterReceipt?.status === "complete" && currentCanonicalWaterReceipt?.complete === true
  ? currentCanonicalWaterReceipt
  : (lastCompleteCanonicalWaterReceipt || currentCanonicalWaterReceipt);
const receiptEventKeys = receiptSentEvents.map((event) => String(event?.event_key || ""));
const expectedAlertScope = "daytrade_mother_pool_only_0900_1230_with_same_day_fugle_1m_coverage_and_industry_heatmap";
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
checks.runtime_canonical_water_receipt_contract = !canonicalWaterReceipt || (
  canonicalWaterReceipt?.contract === "daytrade_canonical_water_reader_v1"
  && canonicalWaterReceipt?.contract_version === "4.1.0"
  && canonicalWaterReceipt?.status === "complete"
  && canonicalWaterReceipt?.complete === true
  && String(canonicalWaterReceipt?.trade_date || "") === String(receipt?.trade_date || "")
  && String(canonicalWaterReceipt?.canonical_run_id || "") === `fugle_daytrade_source:${taipeiDate().replace(/-/g, "")}:canonical`
  && canonicalWaterReceipt?.source_name === "fugle_daytrade_source"
  && canonicalWaterReceipt?.reader_policy === "supabase_read_only_no_writer_no_fugle_fallback"
  && canonicalWaterReceipt?.credential_role === "anon_or_authenticated_reader"
  && canonicalWaterReceipt?.writes_supabase === false
  && canonicalWaterReceipt?.reader_mode === "telegram_observation_per_symbol_fail_closed"
  && Number(canonicalWaterReceipt?.telegram_pool_fresh_coverage_min) === 0.90
  && canonicalWaterReceipt?.mother_pool_capacity_is_hard_gate === false
  && Number(canonicalWaterReceipt?.mother_pool_read_rows) >= 1
  && Number(canonicalWaterReceipt?.market_event_sync_coverage_120s) >= 0.90
  && Number(canonicalWaterReceipt?.no_new_market_event_rows) >= 0
  && Number(canonicalWaterReceipt?.market_event_data_gap_rows) >= 0
  && Array.isArray(canonicalWaterReceipt?.failed_checks)
  && canonicalWaterReceipt.failed_checks.length === 0
  && !canonicalWaterReceipt?.first_blocker
  && canonicalWaterReceipt?.sources?.source_status === "source_status"
  && canonicalWaterReceipt?.sources?.canonical_gate === "v_fugle_daytrade_canonical_gate"
  && canonicalWaterReceipt?.sources?.unattended_gate === "v_fugle_daytrade_unattended_gate_status"
  && canonicalWaterReceipt?.sources?.mother_pool === "v_fugle_daytrade_mother_pool_v4_1"
  && canonicalWaterReceipt?.sources?.quote === "fugle_daytrade_quotes_live"
  && canonicalWaterReceipt?.sources?.intraday_1m_rpc === "get_fugle_daytrade_intraday_1m_latest_n"
);
checks.runtime_canonical_water_event_evidence = !canonicalWaterReceipt || !Array.isArray(canonicalWaterReceipt?.event_evidence)
  || canonicalWaterReceipt.event_evidence.every((row) => row?.mother_pool_member === true
    && row?.quote_trade_date_ok === true
    && row?.quote_fresh === true
    && row?.intraday_1m_trade_date_ok === true
    && row?.intraday_1m_ready === true);
const legacyMotherPoolHeatmap = outbox?.industry_heatmap_source === "fugle_formal_quote_mother_pool_heatmap";
const fullMarketDomesticHeatmap = (
  outbox?.industry_heatmap_source === "taiwan_domestic_detailed_industry+twse_tpex_mops_parent+fugle_formal_quote_full_market"
  && outbox?.industry_taxonomy === "taiwan_domestic_detailed_industry_v1"
  && outbox?.industry_heatmap_universe === "full_market_active_ordinary_stock"
  && Number(outbox?.industry_heatmap_universe_rows) > 0
);
checks.runtime_industry_heatmap_ready = !outbox || (
  (outbox?.industry_heatmap_status === "warmup_waiting_for_taiwan_open"
    && taipeiMinutesFromIso(outbox?.updated_at) < 540
    && Array.isArray(outbox?.industry_heatmap)
    && outbox.industry_heatmap.length === 0)
  || (outbox?.industry_heatmap_status === "ready"
    && (legacyMotherPoolHeatmap || fullMarketDomesticHeatmap)
    && Array.isArray(outbox?.industry_heatmap)
    && outbox.industry_heatmap.length > 0)
);
checks.runtime_events_have_industry_flow = !outbox || outboxEvents.every((event) =>
  event?.industry_flow_status === "ready"
  && Boolean(String(event?.industry || "").trim())
  && (event?.industry_persistent_large_inflow === true || event?.industry_sudden_large_inflow === true)
  && event?.industry_volume_expansion_confirmed === true
  && event?.industry_price_rise_continuing === true
  && Number.isFinite(Number(event?.industry_heat_score))
);
checks.runtime_events_industry_concentration_ordered = !outbox || outboxEvents.every((event, index) =>
  index === 0
  || Number(outboxEvents[index - 1]?.industry_flow_rank || 999999) <= Number(event?.industry_flow_rank || 999999)
);
let offSessionCloseoutComplete = false;
if (requireToday) {
  offSessionCloseoutComplete = taipeiMinutesFromIso() > 750
    && receipt?.first_blocker === "outside_trading_window"
    && receipt?.ok === true
    && receipt?.complete === true
    && receipt?.status === "complete"
    && runnerReceipt?.ok === true
    && runnerReceipt?.complete === true
    && runnerReceipt?.status === "complete"
    && Number(runnerReceipt?.exit_code) === 0;
  checks.runtime_today_outbox_present = Boolean(outbox) && String(outbox?.trade_date || "") === taipeiDate();
  checks.runtime_today_receipt_present = Boolean(receipt) && String(receipt?.trade_date || "") === taipeiDate();
  checks.runtime_today_runner_receipt_present = Boolean(runnerReceipt) && String(runnerReceipt?.trade_date || "") === taipeiDate();
  checks.runtime_today_canonical_water_receipt_present = (Boolean(canonicalWaterReceipt)
    && String(canonicalWaterReceipt?.trade_date || "") === taipeiDate()) || offSessionCloseoutComplete;
  checks.runtime_today_canonical_water_or_offsession_closeout = (Boolean(canonicalWaterReceipt)
    && String(canonicalWaterReceipt?.trade_date || "") === taipeiDate()) || offSessionCloseoutComplete;
  checks.runtime_today_runner_receipt_complete = !runnerReceipt || (
    runnerReceipt?.contract === "daytrade_intraday_burst_telegram_runner_v1"
    && runnerReceipt?.contract_version === "4.1.0"
    && String(runnerReceipt?.canonical_run_id || "") === `fugle_daytrade_source:${taipeiDate().replace(/-/g, "")}:canonical`
    && (offSessionCloseoutComplete || Number(runnerReceipt?.accepted_mother_pool_symbols) >= 1)
    && runnerReceipt?.complete === true
    && runnerReceipt?.status === "complete"
    && Number(runnerReceipt?.exit_code) === 0
    && Array.isArray(runnerReceipt?.failed_checks)
    && runnerReceipt.failed_checks.length === 0
    && !runnerReceipt?.first_blocker
    && Boolean(runnerReceipt?.started_at)
    && Boolean(runnerReceipt?.finished_at)
    && String(runnerReceipt?.notifier_receipt_path || "").toLowerCase() === receiptFile.toLowerCase()
  );
  checks.runtime_no_send_after_1230 = !receipt || receiptSentEvents.every((event) => taipeiMinutesFromIso(event?.sent_at) <= 750);
  checks.runtime_today_technical_indicator_readback_present = offSessionCloseoutComplete
    || (Array.isArray(outbox?.technical_indicator_readback) && outbox.technical_indicator_readback.length > 0);
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
const sameDayBaselineWarmup = Boolean(outbox)
  && String(outbox?.trade_date || "") === taipeiDate()
  && outboxTaipeiMinutes >= 9 * 60
  && outboxTaipeiMinutes < 10 * 60
  && candidateCount > 0
  && cacheReadyCount === 0
  && baselineRejectedCount === candidateCount;
const baselineRuntimeHealthy = !outbox
  || candidateCount === 0
  || sameDayBaselineWarmup
  || baselineRejectedRatio <= 0.5;
const technicalReadback = Array.isArray(outbox?.technical_indicator_readback) ? outbox.technical_indicator_readback : [];
const canonicalMotherPoolSymbols = new Set(Array.isArray(canonicalWaterReceipt?.mother_pool_symbols)
  ? canonicalWaterReceipt.mother_pool_symbols.map((symbol) => String(symbol || ""))
  : []);
checks.runtime_candidate_readback_mother_pool_only = !outbox
  || offSessionCloseoutComplete
  || (canonicalMotherPoolSymbols.size === Number(canonicalWaterReceipt?.mother_pool_read_rows)
    && technicalReadback.length === candidateCount
    && technicalReadback.length === canonicalMotherPoolSymbols.size
    && technicalReadback.every((row) => canonicalMotherPoolSymbols.has(String(row?.symbol || ""))
      && String(row?.trade_date || "") === String(outbox?.trade_date || "")));
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
  canonical_water_receipt_present: Boolean(canonicalWaterReceipt),
  canonical_water_receipt_status: canonicalWaterReceipt?.status || null,
  canonical_water_trade_date: canonicalWaterReceipt?.trade_date || null,
  canonical_water_canonical_run_id: canonicalWaterReceipt?.canonical_run_id || null,
  canonical_water_mother_pool_read_rows: Number.isFinite(Number(canonicalWaterReceipt?.mother_pool_read_rows)) ? Number(canonicalWaterReceipt.mother_pool_read_rows) : null,
  canonical_water_mother_pool_page_count: Number.isFinite(Number(canonicalWaterReceipt?.mother_pool_page_count)) ? Number(canonicalWaterReceipt.mother_pool_page_count) : null,
  canonical_water_quote_fresh_coverage_120s: Number.isFinite(Number(canonicalWaterReceipt?.quote_fresh_coverage_120s)) ? Number(canonicalWaterReceipt.quote_fresh_coverage_120s) : null,
  canonical_water_failed_checks: canonicalWaterReceipt?.failed_checks || null,
  runner_receipt_path: runnerReceiptFile,
  runner_receipt_exists: Boolean(runnerReceipt),
  runner_receipt_status: runnerReceipt?.status || null,
  runner_receipt_exit_code: Number.isFinite(Number(runnerReceipt?.exit_code)) ? Number(runnerReceipt.exit_code) : null,
  strict_burst_event_count: Number.isFinite(Number(outbox?.strict_burst_event_count)) ? Number(outbox.strict_burst_event_count) : null,
  hot_rank_fallback_event_count: Number.isFinite(Number(outbox?.hot_rank_fallback_event_count)) ? Number(outbox.hot_rank_fallback_event_count) : null,
  candidate_count: candidateCount,
  rejected_reason_counts: rejectedReasonCounts,
  candle_cache_symbol_count: candleCacheSymbolCount,
  cache_rolling_1m_ready_count: cacheReadyCount,
  rolling_1m_baseline_rejected_count: baselineRejectedCount,
  rolling_1m_baseline_rejected_ratio: Number(baselineRejectedRatio.toFixed(4)),
  rolling_1m_baseline_same_day_warmup: sameDayBaselineWarmup,
  rolling_1m_baseline_expected_ready_at: sameDayBaselineWarmup ? `${outbox.trade_date}T10:00:00+08:00` : null,
  rolling_1m_baseline_runtime_healthy: baselineRuntimeHealthy,
  runtime_status: outbox
    ? (sameDayBaselineWarmup ? "same_day_rolling60_warmup" : (baselineRuntimeHealthy ? "available" : "rolling_1m_baseline_not_ready"))
    : "awaiting_next_writer_tick",
  off_session_closeout_complete: offSessionCloseoutComplete,
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









