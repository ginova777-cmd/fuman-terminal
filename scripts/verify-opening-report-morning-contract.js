"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const REPORT_DIR = path.join(RUNTIME, "data", "opening-report-0830");
const STATE_DIR = path.join(RUNTIME, "state");

const CONTRACT = "opening-report-morning-single-verifier-v1";
const SINGLE_VERIFIER_SCRIPT = "scripts/verify-opening-report-morning-contract.js";
const SINGLE_VERIFIER_CMD = "node --use-system-ca " + SINGLE_VERIFIER_SCRIPT;
const RETIRED_TELEGRAM_SCRIPT = path.join(ROOT, "scripts", "verify-opening-report-0830-telegram-contract.js");
const RETIRED_TELEGRAM_PACKAGE_KEY = "verify:opening-report-0830-telegram-contract";
const RETIRED_FIELD_ACK_SCRIPT = path.join(ROOT, "scripts", "verify-opening-report-0830-mother-pool-field-ack.js");
const RETIRED_FIELD_ACK_PACKAGE_KEYS = ["verify:opening-report-mother-pool-field-ack", "verify:opening-report-mother-pool-field-ack:fixture"];
const KOREA_NAVER_ENFORCE_FROM = "2026-09-09";
const FUJIKURA_JAPAN_SOURCE_ENFORCE_FROM = "2026-09-10";
const BOE_RETIRE_ENFORCE_FROM = "2026-09-10";

const RETIRED_ALIASES = [
  "verify:opening-report-0820-preflight",
  "verify:opening-report-0830-contract",
  "verify:opening-report-0830-bridge-handoff",
  "verify:opening-report-0830-terminal-briefing",
  "verify:opening-report-0830-delivery-chain",
  "verify:opening-report-0830-unattended-readiness",
  "verify:opening-report-0830-production:line",
  "verify:opening-report-0830-briefing-only-live",
  "verify:market-ai-opening-report-fallback",
  "verify:terminal-opening-report-0830-standalone",
];

const RETIRED_VERIFIER_FILES = [
  "scripts/verify-market-ai-opening-report-fallback.js",
  "scripts/verify-terminal-opening-report-0830-standalone-renderer.js",
];

const REQUIRED_INDUSTRIES = [
  "AI_GPU_CLOUD",
  "AWS_AI_DATACENTER",
  "FOUNDRY_ADVANCED_PROCESS",
  "IC_DESIGN",
  "MEMORY",
  "ABF_SUBSTRATE",
  "PCB_CCL",
  "PASSIVE_COMPONENTS",
  "THERMAL_POWER",
  "NETWORK_HIGH_SPEED",
  "OPTICAL_COMM",
  "III_V_OPTICAL",
  "ROBOTICS_AUTOMATION",
  "PANEL",
  "APPLE_CONSUMER",
];

function compactDate(input) {
  return String(input || "").replace(/-/g, "");
}

function defaultTradeDate() {
  const now = new Date();
  const taipei = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return taipei;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { tradeDate: defaultTradeDate(), requireCurrent: false, phase: "static" };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--require-current") {
      out.requireCurrent = true;
      out.phase = "delivery";
    } else if (arg === "--pre-delivery" || arg === "--phase=preflight" || arg === "--phase=pre-delivery") {
      out.phase = "preflight";
    } else if (arg === "--trade-date" && args[i + 1]) {
      out.tradeDate = args[i + 1];
      i += 1;
    } else if (arg.startsWith("--trade-date=")) {
      out.tradeDate = arg.slice("--trade-date=".length);
    }
  }
  if (/^\d{8}$/.test(out.tradeDate)) {
    out.tradeDate = out.tradeDate.slice(0, 4) + "-" + out.tradeDate.slice(4, 6) + "-" + out.tradeDate.slice(6, 8);
  }
  return out;
}

function currentPreflightReceiptChecks(checks, tradeDate) {
  const ymd = compactDate(tradeDate);
  const paths = {
    preflight: path.join(REPORT_DIR, "opening-report-0820-preflight-receipt-" + ymd + ".json"),
    leaders: path.join(REPORT_DIR, "opening-report-0820-overseas-leaders-" + ymd + ".json"),
    snapshot: path.join(REPORT_DIR, "opening-report-0820-market-snapshot-" + ymd + ".json"),
  };
  for (const [key, filePath] of Object.entries(paths)) {
    addCheck(checks, "current_preflight_receipt_exists:" + key, exists(filePath), filePath);
  }
  if (!Object.values(paths).every(exists)) return;
  const preflight = readJson(paths.preflight);
  const leaders = readJson(paths.leaders);
  const snapshot = readJson(paths.snapshot);
  const industries = leaders.industries || leaders.industry_bias || leaders.rows || leaders.overseas_industries || [];
  addCheck(checks, "current_preflight_ok", preflight.ok === true && ["REPORT_OK", "REPORT_DEGRADED"].includes(preflight.report_status), JSON.stringify({ ok: preflight.ok, report_status: preflight.report_status }));
  addCheck(checks, "current_preflight_15_industries", Array.isArray(industries) && industries.length === 15, "count=" + (Array.isArray(industries) ? industries.length : "not-array"));
  addCheck(checks, "current_preflight_snapshot_ok", snapshot.ok === true && (snapshot.date === tradeDate || snapshot.trade_date === tradeDate), JSON.stringify({ ok: snapshot.ok, date: snapshot.date, trade_date: snapshot.trade_date }));
}

function readText(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function exists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function run(command, args) {
  const result = childProcess.spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
    timeout: 15000,
  });
  return { ok: result.status === 0, text: (result.stdout || "") + "\n" + (result.stderr || "") };
}

function addCheck(checks, name, ok, detail) {
  checks.push({
    name,
    ok: Boolean(ok),
    detail: detail == null ? "" : String(detail),
  });
}

function loadIndustryContract() {
  const mod = require(path.join(ROOT, "scripts", "opening-report-0830-industry-map-contract.js"));
  return mod;
}

function getIndustryRow(contract, industry) {
  const rows = contract.OPENING_REPORT_0830_INDUSTRY_MAP || contract.INDUSTRY_MAP || contract.industryMap || [];
  return rows.find((row) => row.industry === industry || row.id === industry || row.key === industry);
}

function hasSymbol(list, symbol) {
  return Array.isArray(list) && list.some((value) => String(value?.symbol || value?.yahoo_symbol || value?.yahooSymbol || value?.name || value).includes(symbol));
}

function symbolMapChecks(checks) {
  const contract = loadIndustryContract();
  const rows = contract.OPENING_REPORT_0830_INDUSTRY_MAP || contract.INDUSTRY_MAP || contract.industryMap || [];
  addCheck(checks, "industry_contract_15_rows", rows.length === REQUIRED_INDUSTRIES.length && REQUIRED_INDUSTRIES.every((industry) => getIndustryRow(contract, industry)), "required=" + REQUIRED_INDUSTRIES.length + " actual=" + rows.length);
  const classification = typeof contract.validateIndustryMapContract === "function" ? contract.validateIndustryMapContract(rows) : { ok: false, issues: ["validator_missing"] };
  addCheck(checks, "industry_tier_a_b_classification_complete", classification.ok === true, JSON.stringify(classification.issues || []));

  const pcb = getIndustryRow(contract, "PCB_CCL") || {};
  const iiiV = getIndustryRow(contract, "III_V_OPTICAL") || {};
  addCheck(checks, "manual_mapping_8358_pcb_ccl_a", hasSymbol(pcb.tw_a || pcb.twA || pcb.a || pcb.mapped_symbols_a, "8358"), "8358 must be PCB/CCL A");
  addCheck(checks, "manual_mapping_8039_pcb_ccl_b", hasSymbol(pcb.tw_b || pcb.twB || pcb.b || pcb.mapped_symbols_b, "8039"), "8039 must be PCB/CCL B");
  addCheck(checks, "manual_mapping_4991_iii_v_related_b", hasSymbol(iiiV.tw_b || iiiV.twB || iiiV.b || iiiV.mapped_symbols_b, "4991"), "4991 must be III-V/optical related B");
  addCheck(checks, "manual_mapping_3105_iii_v_a", hasSymbol(iiiV.tw_a || iiiV.twA || iiiV.a || iiiV.mapped_symbols_a, "3105"), "3105 must be III-V/optical A");
  const pcbLeaders = pcb.overseas_leaders || pcb.overseasLeaders || pcb.leaders || [];
  const fujikura = pcbLeaders.find((leader) => String(leader?.yahoo_symbol || leader?.yahooSymbol || "") === "5803.T");
  addCheck(checks, "fujikura_5803_uses_yahoo_japan_quote", fujikura?.name === "藤倉" && fujikura?.source_provider === "yahoo_japan_quote", JSON.stringify(fujikura || null));

  const passive = getIndustryRow(contract, "PASSIVE_COMPONENTS") || {};
  const passiveLeaders = passive.overseas_leaders || passive.overseasLeaders || passive.leaders || [];
  addCheck(checks, "passive_components_anchor_only_murata", passiveLeaders.length === 1 && hasSymbol(passiveLeaders, "6981.T"), JSON.stringify(passiveLeaders));

  const optical = getIndustryRow(contract, "OPTICAL_COMM") || {};
  const opticalLeaders = optical.overseas_leaders || optical.overseasLeaders || optical.leaders || [];
  const opticalRequired = ["COHR", "LITE", "CIEN", "AAOI", "GLW"];
  addCheck(checks, "optical_us_leaders_include_required", opticalRequired.every((symbol) => hasSymbol(opticalLeaders, symbol)), JSON.stringify(opticalLeaders));

  const activeOverseasLeaders = rows.flatMap((row) => row.overseas_leaders || row.overseasLeaders || row.leaders || []);
  const activeBoe = activeOverseasLeaders.filter((leader) => String(leader?.name || "").toUpperCase() === "BOE" || String(leader?.yahoo_symbol || leader?.yahooSymbol || "").toUpperCase() === "000725.SZ");
  addCheck(checks, "boe_000725sz_absent_from_active_map", activeBoe.length === 0, JSON.stringify(activeBoe));

  const contractText = readText("scripts/opening-report-0830-industry-map-contract.js");
  const forbidden = ["6967.T", "WCI", "SCFI", "BDI"];
  addCheck(checks, "forbidden_overseas_sources_excluded", forbidden.every((token) => !contractText.includes(token) || contractText.includes("FORBIDDEN_OVERSEAS_LEADERS")), "forbidden=" + forbidden.join(","));
}

function staticContractChecks(checks) {
  const pkg = readJson(path.join(ROOT, "package.json"));
  addCheck(checks, "single_morning_verifier_package_entry", pkg.scripts && pkg.scripts["verify:opening-report-morning-contract"] === SINGLE_VERIFIER_CMD, pkg.scripts && pkg.scripts["verify:opening-report-morning-contract"]);
  for (const alias of RETIRED_ALIASES) {
    addCheck(checks, "retired_alias_absent:" + alias, !(pkg.scripts && pkg.scripts[alias]), alias);
  }
  addCheck(checks, "retired_telegram_package_entry_absent", !(pkg.scripts && pkg.scripts[RETIRED_TELEGRAM_PACKAGE_KEY]), RETIRED_TELEGRAM_PACKAGE_KEY);
  addCheck(checks, "retired_telegram_contract_file_absent", !exists(RETIRED_TELEGRAM_SCRIPT), RETIRED_TELEGRAM_SCRIPT);
  for (const relPath of RETIRED_VERIFIER_FILES) addCheck(checks, "retired_verifier_file_absent:" + path.basename(relPath), !exists(path.join(ROOT, relPath)), path.join(ROOT, relPath));

  const selfCheck = run("node", ["--check", SINGLE_VERIFIER_SCRIPT]);
  addCheck(checks, "single_verifier_syntax_check", selfCheck.ok, selfCheck.text.trim());

  const detector = readText("scripts/run-opening-report-0830-overseas-leader-detector.js");
  const usCalendar = readText("scripts/us-equity-market-calendar.js");
  addCheck(checks, "us_market_calendar_contract_present", usCalendar.includes("NYSE_NASDAQ_2026") && usCalendar.includes("2026-09-07") && usCalendar.includes("Labor Day") && usCalendar.includes("early_close"), "NYSE/Nasdaq 2026 closure and early-close contract required");
  addCheck(checks, "us_market_closed_excluded_japan_korea_remain", detector.includes("us_market_closed_no_new_session") && detector.includes("us_market_closed_previous_session_background_only") && detector.includes("Naver Finance KRX basic"), "US closed rows must be background-only while fresh Japan/Korea rows remain eligible");
  addCheck(checks, "japan_korea_freeze_window_0800_0820", detector.includes("08:00-08:20 Asia/Taipei") && detector.includes("T08:20:59.999+08:00"), "Japan/Korea must freeze by 08:20 minute end");
  addCheck(checks, "korea_naver_percent_only_primary_present", detector.includes("korea_naver_change_percent_primary") && detector.includes("fluctuationsRatio") && detector.includes("localTradedAt") && detector.includes("KQ"), "Korean .KS/.KQ rows must use Naver directly with same-day percent and source time");
  addCheck(checks, "fujikura_yahoo_japan_primary_present", detector.includes("japan_yahoo_change_percent_primary") && detector.includes("Yahoo! Japan Finance TSE real-time") && detector.includes("japanUpdateTime") && detector.includes("priceChangeRate"), "Fujikura must use the Yahoo! Japan TSE real-time percent and source time");
  const detectorModule = require(path.join(ROOT, "scripts", "run-opening-report-0830-overseas-leader-detector.js"));
  addCheck(checks, "overseas_market_classifier_contract", detectorModule.classifyLeaderMarket("AAPL") === "us" && detectorModule.classifyLeaderMarket("6861.T") === "japan" && detectorModule.classifyLeaderMarket("005930.KS") === "korea" && detectorModule.classifyLeaderMarket("222800.KQ") === "korea" && detectorModule.classifyLeaderMarket("000725.SZ") === "other", "US, Japan, Korea and unsupported markets must not be conflated");
  const naverFixture = detectorModule.parseNaverKoreaBasic({ itemCode: "005930", fluctuationsRatio: "1.11", localTradedAt: "2026-09-08T09:20:59+09:00" }, { yahoo: "005930.KS" }, "2026-09-08");
  const naverAfterCutoff = detectorModule.parseNaverKoreaBasic({ itemCode: "005930", fluctuationsRatio: "1.12", localTradedAt: "2026-09-08T09:21:00+09:00" }, { yahoo: "005930.KS" }, "2026-09-08");
  addCheck(checks, "korea_naver_percent_fixture", naverFixture.ok === true && naverFixture.percent === 1.11 && naverFixture.reason_code === "korea_naver_change_percent_primary", JSON.stringify(naverFixture));
  addCheck(checks, "korea_naver_after_cutoff_rejected", naverAfterCutoff.ok === false && naverAfterCutoff.reason_code === "naver_korea_outside_0800_0820_window", JSON.stringify(naverAfterCutoff));
  const yahooJapanFixture = '{"codeWithMarketExtension":"5803.T","label":"東証PRM","price":{"value":"5,534"},"priceChange":{"value":"451"},"priceChangeRate":{"value":"8.87"},"japanUpdateTime":"9:20","delayMinutes":0,"openPrice":{"name":"始値","value":"5,350","updateDate":"09:06","updateDateMeta":"2026-09-09T09:06:00+09:00"}}';
  const yahooJapanAfterCutoffFixture = yahooJapanFixture.replace('"japanUpdateTime":"9:20"', '"japanUpdateTime":"9:21"');
  const yahooJapanWrongDateFixture = yahooJapanFixture.replace("2026-09-09T09:06:00+09:00", "2026-09-08T09:06:00+09:00");
  const yahooJapanParsed = detectorModule.parseYahooJapanQuotePage(yahooJapanFixture, { yahoo: "5803.T" }, "2026-09-09");
  const yahooJapanAfterCutoff = detectorModule.parseYahooJapanQuotePage(yahooJapanAfterCutoffFixture, { yahoo: "5803.T" }, "2026-09-09");
  const yahooJapanWrongDate = detectorModule.parseYahooJapanQuotePage(yahooJapanWrongDateFixture, { yahoo: "5803.T" }, "2026-09-09");
  addCheck(checks, "fujikura_yahoo_japan_percent_fixture", yahooJapanParsed.ok === true && yahooJapanParsed.percent === 8.87 && yahooJapanParsed.reason_code === "japan_yahoo_change_percent_primary" && yahooJapanParsed.selected_time === "2026-09-09T00:20:00.000Z", JSON.stringify(yahooJapanParsed));
  addCheck(checks, "fujikura_yahoo_japan_after_cutoff_rejected", yahooJapanAfterCutoff.ok === false && yahooJapanAfterCutoff.reason_code === "yahoo_japan_outside_0800_0820_window", JSON.stringify(yahooJapanAfterCutoff));
  addCheck(checks, "fujikura_yahoo_japan_wrong_date_rejected", yahooJapanWrongDate.ok === false && yahooJapanWrongDate.reason_code === "yahoo_japan_trade_date_mismatch", JSON.stringify(yahooJapanWrongDate));
  const calendarModule = require(path.join(ROOT, "scripts", "us-equity-market-calendar.js"));
  const holidayFixture = calendarModule.buildUsEquityMarketCalendar("2026-09-08");
  addCheck(checks, "us_market_labor_day_runtime_switch", holidayFixture.us_market_status === "market_closed" && holidayFixture.no_new_us_session === true && holidayFixture.us_holiday_name === "Labor Day", JSON.stringify(holidayFixture));

  const preflight = readText("scripts/run-opening-report-0820-preflight.js");
  addCheck(checks, "preflight_freezes_at_0820", preflight.includes("08:20:59.999 Asia/Taipei"), "08:20 minute-end freeze must be explicit");

  const runner = readText("scripts/run-opening-report-0830-production.js");
  const handoffAck = readText("scripts/verify-opening-report-0830-mother-pool-handoff-ack.js");
  const persistenceAck = readText("scripts/verify-opening-report-0830-mother-pool-persistence-ack.js");
  const motherPoolWriter = readText("scripts/run-daytrade-source-writer.js");
  const motherPoolEvidence = readText("lib/opening-report-0830-mother-pool-evidence.js");
  addCheck(checks, "runner_owns_non_trading_day_guard", runner.includes("isTwseTradingDay") && runner.includes("market_calendar_non_trading_day") && runner.includes("no_side_effects") && runner.includes("line_push_attempted: false") && runner.includes("mother_pool_bridge_attempted: false"), "direct runner invocation must skip before every side effect on market-closed days");
  addCheck(checks, "runner_consumes_frozen_snapshot_only", runner.includes("frozen 08:20 evidence only") || runner.includes("凍結"), "08:30 runner must not refetch overseas direction");
  addCheck(checks, "runner_observation_only", runner.includes("formal_candidates: 0") && runner.includes("watchlist_only: true") && runner.includes("industry_observation_only"), "morning report must never create formal candidates");
  addCheck(checks, "runner_does_not_read_or_grade_intraday_gate", !runner.includes("readTaiwanGate") && !runner.includes("daytrade-unattended-gate-watchdog"), "08:30 report must not read, calculate, or grade intraday Gate A-D");
  addCheck(checks, "runner_preserves_previous_good_on_incomplete_briefing", runner.includes("briefing?.ok !== true") && runner.includes("preserve_previous_good: true"), "an incomplete briefing must never overwrite the last complete terminal snapshot");
  addCheck(checks, "line_delivery_contract_present", runner.includes("line-push-receipt") && runner.includes("pushLine") && runner.includes("lineReportFlex"), "LINE Flex delivery remains canonical");
  addCheck(checks, "line_customer_layout_fixed", ["📈 08:30 漲幅族群晨報", "15 個產業掃描完成", "海外平均漲幅", "日韓早盤漲幅", "台股 A：", "台股 B："].every((token) => runner.includes(token)), "LINE customer layout must support regular and US-closed fallback cards");
  const lineLayoutSource = (runner.match(/function lineReportText[\s\S]*?function invalidLineTarget/) || [""])[0];
  addCheck(checks, "line_customer_layout_hides_internal_status", ["掃描：15／15", "資料截點：08:20", "Mother Pool：", "台股 Gate：", "狀態：", "FAIL_CLOSED", "僅供觀察，不是自動下單訊號"].every((token) => !lineLayoutSource.includes(token)), "LINE customer card must not expose internal operations");
  addCheck(checks, "us_closed_asia_positive_leader_top3_handoff", runner.includes("us_market_closed_asia_positive_leader_top3") && runner.includes("asiaPositiveLeaderObservations") && runner.includes("priority_overseas_leaders"), "US-closed days must hand positive Japan/Korea leader Top 3 mappings to Mother Pool");
  addCheck(checks, "positive_top3_zero_to_three_is_valid", runner.includes("displayTop3.length <= 3") && !runner.includes("displayTop3.length === 3"), "Zero to three positive observations is a valid completed report");
  addCheck(checks, "bridge_priority_observation_nonblocking", runner.includes("us_open_positive_industry_or_us_closed_asia_positive_leader_top3_v2") && runner.includes("It must never change the 08:30 report delivery decision."), "Mother Pool bridge only changes scan priority");
  addCheck(checks, "old_immediate_field_ack_retired", !exists(RETIRED_FIELD_ACK_SCRIPT) && RETIRED_FIELD_ACK_PACKAGE_KEYS.every((key) => !JSON.stringify(readJson(path.join(ROOT, "package.json"))).includes(key)), "old immediate field ACK verifier and aliases must be absent");
  addCheck(checks, "runner_requires_mother_pool_handoff_ack", runner.includes("runMotherPoolHandoffAck") && runner.includes("mother_pool_handoff_ack_ok") && runner.includes("mother_pool_persistence_ack_pending"), "runner must stop at HANDOFF_ACK and wait for persistence verification");
  addCheck(checks, "mother_pool_handoff_ack_contract_present", handoffAck.includes("opening-report-0830-mother-pool-handoff-ack-v2") && handoffAck.includes("credential_role: \"anon_read_only\"") && handoffAck.includes("db_readback_ok"), "Mother Pool must publish HANDOFF_ACK after initial anon readback");
  addCheck(checks, "mother_pool_persistence_ack_contract_present", persistenceAck.includes("opening-report-0830-mother-pool-persistence-ack-v1") && persistenceAck.includes("writer_refreshes_observed") && persistenceAck.includes("required_writer_refreshes") && persistenceAck.includes("db_readback_ok"), "PERSISTENCE_ACK must verify canonical Writer rewrites");
  addCheck(checks, "mother_pool_handoff_ack_checks_observation_only", ["formal_candidate_count", "formal_candidate_allowed", "forbidden_publish_guard", "market_not_TW"].every((token) => handoffAck.includes(token)), "handoff acknowledgement must preserve observation-only and canonical TW market fields");
  addCheck(checks, "mother_pool_accepts_canonical_twse_tpex_markets", motherPoolEvidence.includes('["TW", "TWSE", "TPEX"]') && handoffAck.includes("market_not_TW_TWSE_TPEX"), "TWSE and TPEX are canonical Taiwan markets and must not be rejected as non-Taiwan");
  addCheck(checks, "mother_pool_writer_preserves_morning_evidence", motherPoolWriter.includes("openingReportSeedBySymbol") && motherPoolWriter.includes("mergeOpeningReportEvidence") && motherPoolWriter.includes("openingReport0830IndustryBias") && motherPoolWriter.includes("preserveMorningWatchRows") && readText("lib/opening-report-writer-preservation.js").includes("opening_report_0830_priority_reason"), "canonical Mother Pool rewrites must reconstruct verified morning evidence from per-symbol reports instead of erasing it");
  addCheck(checks, "mother_pool_overlap_evidence_contract_present", motherPoolEvidence.includes("industry_observations") && motherPoolEvidence.includes("linked_industries") && handoffAck.includes("overlapping_industries_preserved"), "one stock must retain every linked Top-3 industry observation");
  const handoffAckFixture = run("node", ["scripts/verify-opening-report-0830-mother-pool-handoff-ack.js", "--fixture"]);
  addCheck(checks, "mother_pool_handoff_ack_multi_industry_fixture", handoffAckFixture.ok && handoffAckFixture.text.includes('"overlapping_industries_preserved": true') && handoffAckFixture.text.includes('"db_twse": true') && handoffAckFixture.text.includes('"db_tpex": true'), handoffAckFixture.text.trim());
  const persistenceAckFixture = run("node", ["scripts/verify-opening-report-0830-mother-pool-persistence-ack.js", "--fixture"]);
  addCheck(checks, "mother_pool_persistence_ack_fixture", persistenceAckFixture.ok && persistenceAckFixture.text.includes('"writer_refreshes_observed": 2') && persistenceAckFixture.text.includes('"db_readback_ok": true'), persistenceAckFixture.text.trim());

  const wrapper = readText("run-opening-report-0830-production-wrapper.ps1");
  addCheck(checks, "wrapper_owns_non_trading_day_guard", wrapper.includes("check-market-calendar-action.js") && wrapper.includes("market_calendar_non_trading_day") && wrapper.includes("line_push_attempted = $false") && wrapper.includes("mother_pool_bridge_attempted = $false"), "Task Scheduler wrapper must guard independently before invoking the runner");
  addCheck(checks, "wrapper_runner_verifier_receipt_chain", wrapper.includes("run-opening-report-0830-production.js") && wrapper.includes("verify-opening-report-0830-mother-pool-persistence-ack.js") && wrapper.includes("verify-opening-report-morning-contract.js") && wrapper.includes("opening-report-morning-wrapper-v1"), "wrapper must be runner -> PERSISTENCE_ACK -> canonical verifier -> wrapper receipt");
  addCheck(checks, "wrapper_audited_line_receipt_recovery", wrapper.includes("ReuseLineReceipt") && wrapper.includes("--reuse-line-receipt") && wrapper.includes("existingLine.line_push_ok"), "bounded recovery may reuse only the already successful same-run LINE receipt");
  addCheck(checks, "wrapper_has_no_telegram_execution", !wrapper.includes("send-opening-report-0830-telegram") && !wrapper.includes("TELEGRAM_BOT_TOKEN") && wrapper.includes("telegram_enabled = $false"), "Telegram must remain retired from morning wrapper");
  addCheck(checks, "wrapper_complete_requires_all_channels", wrapper.includes("$linePersonalOk") && wrapper.includes("$lineGroupOk") && wrapper.includes("$terminalOk") && wrapper.includes("$bridgeOk") && wrapper.includes("$handoffAckOk") && wrapper.includes("$persistenceAckOk") && wrapper.includes("$expected -eq 15") && wrapper.includes("$scanned -eq 15"), "complete must require 15/15 + LINE personal/group + terminal + HANDOFF_ACK + PERSISTENCE_ACK");

  const bridge = readText("scripts/apply-opening-report-0830-priority-bias-bridge.js");
  addCheck(checks, "bridge_cannot_publish_formal_candidates", bridge.includes("formal_candidate_allowed") && bridge.includes("formal_candidate_count") && bridge.includes("forbidden_publish_guard"), "bridge only boosts scan priority");
  addCheck(checks, "bridge_rejects_non_top3_priority_observation", bridge.includes("industry_not_priority_observation_top3") && bridge.includes("asia_positive_leader_evidence_invalid"), "only verified positive observation Top 3 mappings can boost");
  addCheck(checks, "bridge_handoff_delegates_live_quote_gate", bridge.includes("delegated_to_mother_pool") && !bridge.includes("not_in_canonical_priority_pool") && !bridge.includes("fresh_quote_stale"), "morning handoff must not be blocked by Mother Pool membership or live quote age");

  const terminalApp = readText("terminal-app.js");
  const terminalShell = readText("terminal-desktop-fast-shell.js");
  const marketApi = readText("api/market-ai-live.js");
  addCheck(checks, "terminal_displays_0830_window_observation_only", (terminalApp + terminalShell).includes("08:30-08:59") && (terminalApp + terminalShell).includes("僅供觀察排序"), "terminal must show morning report as observation-only");
  addCheck(checks, "terminal_weekend_uses_last_complete_morning_report", marketApi.includes("const allowPreviousTradingDay = isWeekend(clock)") && marketApi.includes("allowLatestFallback: allowPreviousTradingDay") && marketApi.includes("previousTradingDay: payloadDate !== clock.ymd"), "weekends must retain the last completed trading-day morning report");
  addCheck(checks, "terminal_morning_report_uses_canonical_15_industries", marketApi.includes("OPENING_REPORT_0830_REQUIRED_INDUSTRIES = OPENING_REPORT_0830_INDUSTRY_MAP.length") && marketApi.includes("frozenIndustryRows.length >= OPENING_REPORT_0830_REQUIRED_INDUSTRIES") && !marketApi.includes("industryRows.length < 19"), "terminal reconstruction must follow the canonical 15-industry contract");
}

function sourceTimeOk(value, cutoffMs) {
  if (!value) return true;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return false;
  return ms <= cutoffMs;
}

function leaderRows(leaders) {
  const industries = Array.isArray(leaders?.industries) ? leaders.industries : [];
  return industries.flatMap((industry) => (industry?.leaders || []).map((leader) => ({ ...leader, industry: industry.industry, display_name: industry.display_name })));
}

function expectedAsiaPositiveLeaderTop3(leaders) {
  const bySymbol = new Map();
  for (const row of leaderRows(leaders)) {
    const symbol = String(row.yahoo_symbol || "");
    if (!/\.(?:T|KS|KQ)$/i.test(symbol) || row.ok !== true || !Number.isFinite(Number(row.percent)) || Number(row.percent) <= 0) continue;
    const existing = bySymbol.get(symbol);
    if (!existing || Number(row.percent) > Number(existing.percent)) bySymbol.set(symbol, row);
  }
  return [...bySymbol.values()]
    .sort((a, b) => Number(b.percent) - Number(a.percent) || String(a.yahoo_symbol).localeCompare(String(b.yahoo_symbol)))
    .slice(0, 3)
    .map((row, index) => ({ rank: index + 1, symbol: row.yahoo_symbol, percent: Number(row.percent) }));
}

function currentReceiptChecks(checks, tradeDate) {
  const ymd = compactDate(tradeDate);
  const paths = {
    preflight: path.join(REPORT_DIR, "opening-report-0820-preflight-receipt-" + ymd + ".json"),
    leaders: path.join(REPORT_DIR, "opening-report-0820-overseas-leaders-" + ymd + ".json"),
    snapshot: path.join(REPORT_DIR, "opening-report-0820-market-snapshot-" + ymd + ".json"),
    final: path.join(REPORT_DIR, "opening-report-0830-final-receipt-" + ymd + ".json"),
    line: path.join(REPORT_DIR, "line-push-receipt-" + ymd + ".json"),
  };

  for (const [key, filePath] of Object.entries(paths)) {
    addCheck(checks, "current_receipt_exists:" + key, exists(filePath), filePath);
  }

  if (!Object.values(paths).every(exists)) return;

  const preflight = readJson(paths.preflight);
  const leaders = readJson(paths.leaders);
  const snapshot = readJson(paths.snapshot);
  const finalReceipt = readJson(paths.final);
  const line = readJson(paths.line);
  const windowStartMs = Date.parse(tradeDate + "T08:00:00+08:00");
  const cutoffMs = Date.parse(tradeDate + "T08:20:59.999+08:00");

  addCheck(checks, "current_preflight_ok", preflight.ok === true || preflight.status === "OK" || preflight.report_status === "REPORT_OK" || preflight.report_status === "REPORT_DEGRADED", JSON.stringify({ ok: preflight.ok, status: preflight.status, report_status: preflight.report_status }));

  const industries = leaders.industries || leaders.industry_bias || leaders.rows || leaders.overseas_industries || [];
  addCheck(checks, "current_leaders_15_industries", Array.isArray(industries) && industries.length === 15, "count=" + (Array.isArray(industries) ? industries.length : "not-array"));

  const rows = leaderRows(leaders);
  const allSourcesWithinCutoff = rows.filter((row) => /\.(?:T|KS|KQ)$/i.test(String(row.yahoo_symbol || "")) && row.ok === true).every((row) => {
    const sourceMs = Date.parse(String(row.source_time || ""));
    return Number.isFinite(sourceMs) && sourceMs >= windowStartMs && sourceMs <= cutoffMs;
  });
  addCheck(checks, "current_no_source_after_0820", allSourcesWithinCutoff, "cutoff=" + tradeDate + "T08:20:00+08:00");

  const usMarket = leaders.us_market || {};
  addCheck(checks, "current_us_market_status_contract", ["regular", "early_close", "market_closed"].includes(usMarket.us_market_status) && typeof usMarket.no_new_us_session === "boolean" && usMarket.calendar_timezone === "America/New_York", JSON.stringify(usMarket));
  const currentDetectorModule = require(path.join(ROOT, "scripts", "run-opening-report-0830-overseas-leader-detector.js"));
  const usRows = rows.filter((row) => currentDetectorModule.classifyLeaderMarket(row.yahoo_symbol) === "us");
  addCheck(checks, "current_us_closed_rows_not_promoted", usMarket.no_new_us_session !== true || usRows.every((row) => row.ok !== true && row.percent == null && row.reason_code === "us_market_closed_no_new_session"), "closed US rows must be background-only and excluded from ranking");
  const otherMarketRows = rows.filter((row) => currentDetectorModule.classifyLeaderMarket(row.yahoo_symbol) === "other");
  addCheck(checks, "current_other_market_rows_not_ranked", otherMarketRows.every((row) => row.ok !== true && row.percent == null), JSON.stringify(otherMarketRows.map((row) => ({ symbol: row.yahoo_symbol, reason_code: row.reason_code }))));
  const koreaRows = rows.filter((row) => /\.(?:KS|KQ)$/i.test(String(row.yahoo_symbol || "")));
  const naverRequired = tradeDate >= KOREA_NAVER_ENFORCE_FROM;
  addCheck(checks, "current_korea_uses_naver_primary", !naverRequired || koreaRows.every((row) => row.source === "Naver Finance KRX basic"), JSON.stringify({ enforce_from: KOREA_NAVER_ENFORCE_FROM, required: naverRequired, count: koreaRows.length, sources: [...new Set(koreaRows.map((row) => row.source))] }));
  addCheck(checks, "current_naver_korea_primary_valid", koreaRows.filter((row) => row.ok === true).every((row) => row.source === "Naver Finance KRX basic" && Array.isArray(row.source_fields) && row.source_fields.includes("fluctuationsRatio") && row.source_fields.includes("localTradedAt") && Number.isFinite(Number(row.percent))), JSON.stringify(koreaRows.filter((row) => row.ok === true).map((row) => ({ symbol: row.yahoo_symbol, percent: row.percent, source: row.source }))));
  const fujikuraRows = rows.filter((row) => String(row.yahoo_symbol || "").toUpperCase() === "5803.T");
  const fujikuraJapanRequired = tradeDate >= FUJIKURA_JAPAN_SOURCE_ENFORCE_FROM;
  addCheck(checks, "current_fujikura_uses_yahoo_japan_primary", !fujikuraJapanRequired || (fujikuraRows.length === 1 && fujikuraRows.every((row) => row.source_provider === "yahoo_japan_quote" && row.source === "Yahoo! Japan Finance TSE real-time")), JSON.stringify({ enforce_from: FUJIKURA_JAPAN_SOURCE_ENFORCE_FROM, required: fujikuraJapanRequired, rows: fujikuraRows.map((row) => ({ source_provider: row.source_provider, source: row.source, reason_code: row.reason_code })) }));
  addCheck(checks, "current_fujikura_yahoo_japan_valid_fields", !fujikuraJapanRequired || fujikuraRows.filter((row) => row.ok === true).every((row) => Array.isArray(row.source_fields) && ["codeWithMarketExtension", "price", "priceChangeRate", "japanUpdateTime", "delayMinutes"].every((field) => row.source_fields.includes(field)) && Number.isFinite(Number(row.percent))), JSON.stringify(fujikuraRows.filter((row) => row.ok === true).map((row) => ({ percent: row.percent, source_fields: row.source_fields }))));
  const boeRows = rows.filter((row) => String(row.name || "").toUpperCase() === "BOE" || String(row.yahoo_symbol || "").toUpperCase() === "000725.SZ");
  addCheck(checks, "current_boe_000725sz_retired", tradeDate < BOE_RETIRE_ENFORCE_FROM || boeRows.length === 0, JSON.stringify({ enforce_from: BOE_RETIRE_ENFORCE_FROM, rows: boeRows }));

  addCheck(checks, "current_snapshot_trade_date", snapshot.trade_date === tradeDate || snapshot.tradeDate === tradeDate || snapshot.date === tradeDate, JSON.stringify({ trade_date: snapshot.trade_date, tradeDate: snapshot.tradeDate, date: snapshot.date }));
  addCheck(checks, "current_report_status_is_report_only", ["REPORT_OK", "REPORT_DEGRADED", "COMPLETE", "complete", "WAITING_CANONICAL_VERIFIER"].includes(finalReceipt.report_status), finalReceipt.report_status || finalReceipt.status);
  addCheck(checks, "current_runner_and_persistence_ready", finalReceipt.contract === "opening_report_0830_complete_v1" && finalReceipt.runner_complete === true && finalReceipt.mother_pool_persistence_ack_ok === true && ((finalReceipt.complete === true && finalReceipt.status === "complete" && finalReceipt.first_blocker == null) || (finalReceipt.complete === false && finalReceipt.status === "waiting_canonical_verifier" && finalReceipt.first_blocker === "canonical_verifier_pending")), JSON.stringify({ contract: finalReceipt.contract, complete: finalReceipt.complete, status: finalReceipt.status, first_blocker: finalReceipt.first_blocker }));
  addCheck(checks, "current_report_observation_only", finalReceipt.watchlist_only === true && Number(finalReceipt.formal_candidates || 0) === 0, JSON.stringify({ watchlist_only: finalReceipt.watchlist_only, formal_candidates: finalReceipt.formal_candidates }));
  addCheck(checks, "current_scan_15_of_15", Number(finalReceipt.expected_industry_count) === 15 && Number(finalReceipt.scanned_industry_count) === 15, JSON.stringify({ expected_industry_count: finalReceipt.expected_industry_count, scanned_industry_count: finalReceipt.scanned_industry_count }));

  const priorityRows = Array.isArray(finalReceipt.priority_observations) ? finalReceipt.priority_observations : [];
  const priorityContractOk = priorityRows.length <= 3 && priorityRows.every((row, index) => Number(row.rank) === index + 1 && Number(row.percent) > 0);
  addCheck(checks, "current_priority_observation_zero_to_three_valid", priorityContractOk && finalReceipt.priority_observation_contract_ok === true && Number(finalReceipt.priority_observation_count) === priorityRows.length, JSON.stringify(priorityRows.map((row) => ({ rank: row.rank, symbol: row.overseas_symbol || null, percent: row.percent }))));
  if (usMarket.no_new_us_session === true) {
    const expectedAsia = expectedAsiaPositiveLeaderTop3(leaders);
    const actualAsia = priorityRows.map((row) => ({ rank: Number(row.rank), symbol: row.overseas_symbol, percent: Number(row.percent) }));
    addCheck(checks, "current_us_closed_asia_positive_leader_top3_exact", finalReceipt.priority_observation_mode === "us_market_closed_asia_positive_leader_top3" && JSON.stringify(actualAsia) === JSON.stringify(expectedAsia), JSON.stringify({ expected: expectedAsia, actual: actualAsia }));
    addCheck(checks, "current_us_closed_asia_mapping_present", priorityRows.every((row) => Array.isArray(row.mapped_symbols_a) && row.mapped_symbols_a.length > 0 && Array.isArray(row.mapped_symbols_b) && row.mapped_symbols_b.length > 0), "each positive Japan/Korea leader must carry Taiwan A/B mappings");
  }

  const runId = finalReceipt.run_id || finalReceipt.runId;
  const hash = finalReceipt.delivery_content_hash || finalReceipt.content_hash || finalReceipt.contentHash;
  const lineRunId = line.run_id || line.runId;
  const lineHash = line.delivery_content_hash || line.content_hash || line.contentHash;
  addCheck(checks, "current_line_same_run_id", !runId || !lineRunId || runId === lineRunId, runId + "/" + lineRunId);
  addCheck(checks, "current_line_same_content_hash", !hash || !lineHash || hash === lineHash, hash + "/" + lineHash);
  addCheck(checks, "current_line_token_target_not_logged", line.token_logged === false && line.target_logged === false, JSON.stringify({ token_logged: line.token_logged, target_logged: line.target_logged }));

  const targetCount = Number(line.target_count || line.targetCount || 0);
  const hasUser = line.has_user_target === true || line.hasUserTarget === true;
  const hasGroup = line.has_group_target === true || line.hasGroupTarget === true;
  const deliveredCount = Number(line.delivered_count || line.deliveredCount || 0);
  const lineAttempted = line.line_push_attempted === true;
  addCheck(checks, "current_line_user_and_group_delivery", line.ok === true && lineAttempted && targetCount >= 2 && deliveredCount >= 2 && hasUser && hasGroup, JSON.stringify({ ok: line.ok, line_push_attempted: lineAttempted, target_count: targetCount, delivered_count: deliveredCount, has_user_target: hasUser, has_group_target: hasGroup }));

  const terminal = finalReceipt.terminal_briefing_snapshot || {};
  addCheck(checks, "current_terminal_snapshot_ok", terminal.ok === true, JSON.stringify({ ok: terminal.ok, key: terminal.key }));
  addCheck(checks, "current_terminal_same_run_id", terminal.report_run_id === runId, String(terminal.report_run_id || "") + "/" + String(runId || ""));
  addCheck(checks, "current_terminal_same_content_hash", terminal.delivery_content_hash === hash, String(terminal.delivery_content_hash || "") + "/" + String(hash || ""));

  const reportPath = String(finalReceipt.report_path || "");
  const reportText = reportPath && exists(reportPath) ? fs.readFileSync(reportPath, "utf8") : "";
  addCheck(checks, "current_codex_markdown_exists", Boolean(reportText), reportPath);
  addCheck(checks, "current_codex_markdown_same_run_id", Boolean(runId) && reportText.includes("run_id：" + runId), runId || "missing_run_id");
  addCheck(checks, "current_codex_markdown_observation_only", reportText.includes("formal_candidates=0") && reportText.includes("watchlist_only=true"), "Codex Markdown must remain observation-only");

  const bridgePath = String(finalReceipt.bridge_aggregate_receipt || "");
  const bridge = bridgePath && exists(bridgePath) ? readJson(bridgePath) : null;
  addCheck(checks, "current_bridge_aggregate_exists", Boolean(bridge), bridgePath);
  addCheck(checks, "current_bridge_aggregate_ok", bridge?.status === "BRIDGE_OK" && Number(bridge?.successful_industry_count || 0) === Number(bridge?.industry_count || 0) && Number(bridge?.observation_count || 0) === priorityRows.length, JSON.stringify({ status: bridge?.status, observation_count: bridge?.observation_count, industry_count: bridge?.industry_count, successful_industry_count: bridge?.successful_industry_count }));
  addCheck(checks, "current_bridge_same_run_id", bridge?.run_id === runId, String(bridge?.run_id || "") + "/" + String(runId || ""));
  addCheck(checks, "current_bridge_observation_only", bridge?.forbidden_publish_guard === true && Number(bridge?.formal_candidate_count || 0) === 0 && bridge?.formal_candidate_allowed === false, JSON.stringify({ forbidden_publish_guard: bridge?.forbidden_publish_guard, formal_candidate_count: bridge?.formal_candidate_count, formal_candidate_allowed: bridge?.formal_candidate_allowed }));
  const handoffAckPath = String(finalReceipt.mother_pool_handoff_ack_receipt || path.join(RUNTIME, "data", "scan-receipts", "opening-report-0830-mother-pool-handoff-ack-" + compactDate(tradeDate) + ".json"));
  const handoffAckReceipt = handoffAckPath && exists(handoffAckPath) ? readJson(handoffAckPath) : null;
  addCheck(checks, "current_mother_pool_handoff_ack_exists", Boolean(handoffAckReceipt), handoffAckPath);
  addCheck(checks, "current_mother_pool_handoff_ack_same_run", handoffAckReceipt?.report_run_id === runId, String(handoffAckReceipt?.report_run_id || "") + "/" + String(runId || ""));
  addCheck(checks, "current_mother_pool_handoff_ack_complete", handoffAckReceipt?.contract === "opening-report-0830-mother-pool-handoff-ack-v2" && handoffAckReceipt?.complete === true && handoffAckReceipt?.db_readback_ok === true && handoffAckReceipt?.first_blocker == null, JSON.stringify({ contract: handoffAckReceipt?.contract, complete: handoffAckReceipt?.complete, db_readback_ok: handoffAckReceipt?.db_readback_ok, first_blocker: handoffAckReceipt?.first_blocker }));
  addCheck(checks, "current_mother_pool_handoff_ack_observation_only", Number(handoffAckReceipt?.formal_candidate_count || 0) === 0 && handoffAckReceipt?.formal_candidate_allowed === false && handoffAckReceipt?.forbidden_publish_guard === true, JSON.stringify({ formal_candidate_count: handoffAckReceipt?.formal_candidate_count, formal_candidate_allowed: handoffAckReceipt?.formal_candidate_allowed, forbidden_publish_guard: handoffAckReceipt?.forbidden_publish_guard }));
  const persistenceAckPath = String(finalReceipt.mother_pool_persistence_ack_receipt || path.join(RUNTIME, "data", "scan-receipts", "opening-report-0830-mother-pool-persistence-ack-" + compactDate(tradeDate) + ".json"));
  const persistenceAckReceipt = persistenceAckPath && exists(persistenceAckPath) ? readJson(persistenceAckPath) : null;
  addCheck(checks, "current_mother_pool_persistence_ack_exists", Boolean(persistenceAckReceipt), persistenceAckPath);
  addCheck(checks, "current_mother_pool_persistence_ack_same_run", persistenceAckReceipt?.report_run_id === runId, String(persistenceAckReceipt?.report_run_id || "") + "/" + String(runId || ""));
  addCheck(checks, "current_mother_pool_persistence_ack_complete", persistenceAckReceipt?.contract === "opening-report-0830-mother-pool-persistence-ack-v1" && persistenceAckReceipt?.complete === true && persistenceAckReceipt?.db_readback_ok === true && Number(persistenceAckReceipt?.writer_refreshes_observed || 0) >= 2 && persistenceAckReceipt?.first_blocker == null, JSON.stringify({ contract: persistenceAckReceipt?.contract, complete: persistenceAckReceipt?.complete, db_readback_ok: persistenceAckReceipt?.db_readback_ok, writer_refreshes_observed: persistenceAckReceipt?.writer_refreshes_observed, first_blocker: persistenceAckReceipt?.first_blocker }));
  const refreshTimes = persistenceAckReceipt?.writer_refresh_timestamps || [];
  const handoffMs = Date.parse(handoffAckReceipt?.checked_at || "");
  const persistedMs = Date.parse(persistenceAckReceipt?.checked_at || "");
  addCheck(checks, "current_persistence_two_distinct_refreshes_after_handoff", new Set(refreshTimes).size >= 2 && refreshTimes.every(t => Date.parse(t) > handoffMs && Date.parse(t) <= persistedMs), JSON.stringify(refreshTimes));
  addCheck(checks, "current_ack_dates_match_report", handoffAckReceipt?.trade_date === tradeDate && persistenceAckReceipt?.trade_date === tradeDate, tradeDate);
  const readback = persistenceAckReceipt?.persistence_readback_receipt ? readJson(persistenceAckReceipt.persistence_readback_receipt) : null;
  addCheck(checks, "current_persistence_live_readback_link", readback?.complete === true && readback?.db_readback_ok === true && readback?.report_run_id === runId && readback?.trade_date === tradeDate && Date.parse(readback.checked_at) >= Math.max(...refreshTimes.map(Date.parse)) && JSON.stringify(readback.db_readback_symbols || []) === JSON.stringify(persistenceAckReceipt.db_readback_symbols || []), persistenceAckReceipt?.persistence_readback_receipt || "missing");
  addCheck(checks, "current_final_links_persistence_ack", finalReceipt.mother_pool_handoff_ack_ok === true && finalReceipt.mother_pool_persistence_ack_ok === true, JSON.stringify({ handoff: finalReceipt.mother_pool_handoff_ack_ok, persistence: finalReceipt.mother_pool_persistence_ack_ok }));
}

async function liveDeliveryChecks(checks, tradeDate) {
  const finalPath = path.join(REPORT_DIR, "opening-report-0830-final-receipt-" + compactDate(tradeDate) + ".json");
  const final = readJson(finalPath);
  if (!final) return;
  const {contentHash} = require("../lib/opening-report-delivery-contract");
  const expectedHash = contentHash(final.priority_observation_mode, final.display_top3 || []);
  addCheck(checks,"current_full_content_hash",final.delivery_content_hash === expectedHash,"hash includes full Top3 and A/B mappings");
  try {
    const {readSnapshot} = require("../lib/supabase-snapshots");
    const snapshot = await readSnapshot("opening_report_0830_terminal_briefing", {tradeDate,allowLatestFallback:false,timeoutMs:10000,maxAttempts:2});
    const payload=snapshot?.payload;
    addCheck(checks,"current_terminal_db_readback",payload?.ok===true && payload.run_id===final.run_id && payload.delivery_content_hash===expectedHash && JSON.stringify(payload.display_top3 || [])===JSON.stringify(final.display_top3 || []) && compactDate(payload.date)===compactDate(tradeDate),JSON.stringify({run_id:payload?.run_id,date:payload?.date,hash:payload?.delivery_content_hash}));
  } catch(error) { addCheck(checks,"current_terminal_db_readback",false,error.message); }
}

function writeReceipt(result, tradeDate) {
  const outputArg = process.argv.find(x => x.startsWith("--output="));
  if (outputArg) { const target = path.resolve(outputArg.slice(9)); fs.mkdirSync(path.dirname(target), {recursive:true}); fs.writeFileSync(target, JSON.stringify(result,null,2)); return target; }
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const ymd = compactDate(tradeDate);
  const filePath = path.join(REPORT_DIR, "opening-report-morning-contract-verifier-" + ymd + ".json");
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
  return filePath;
}

async function main() {
  const args = parseArgs();
  const checks = [];

  staticContractChecks(checks);
  symbolMapChecks(checks);
  if (args.phase === "preflight") {
    currentPreflightReceiptChecks(checks, args.tradeDate);
  } else if (args.requireCurrent) {
    currentReceiptChecks(checks, args.tradeDate);
    await liveDeliveryChecks(checks, args.tradeDate);
  }

  const failures = checks.filter((check) => !check.ok);
  const result = {
    ok: failures.length === 0,
    status: failures.length === 0 ? "complete" : "failed",
    complete: failures.length === 0,
    exitCode: failures.length === 0 ? 0 : 1,
    contract: CONTRACT,
    checked_at: new Date().toISOString(),
    trade_date: args.tradeDate,
    require_current: args.requireCurrent,
    phase: args.phase,
    terminal_dir: ROOT,
    runtime_dir: RUNTIME,
    retired_contracts: [RETIRED_TELEGRAM_PACKAGE_KEY],
    canonical_verifier: "verify:opening-report-morning-contract",
    retired_aliases: RETIRED_ALIASES,
    checks,
    failed_checks: failures.map((check) => check.name),
    first_blocker: failures.length ? failures[0].name : null,
    reason_code: failures.length ? "opening_report_morning_" + failures[0].name : "opening_report_morning_contract_pass",
  };

  result.receipt_path = writeReceipt(result, args.tradeDate);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode=1; });
