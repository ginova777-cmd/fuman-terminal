const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "outputs", "daytrade-viewer-dream-readonly");
const WATER_ROOT_FILE = path.join(ROOT, "outputs", "terminal-water-root", "terminal-water-root.json");
const EXPECTED_DATE = (process.argv.find((arg) => arg.startsWith("--expected-date="))?.slice("--expected-date=".length) || "").replace(/\D/g, "").slice(0, 8);

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replace(/\D/g, "");
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function textValue(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function phaseFromWaterRoot(water = {}) {
  return textValue(water.sourceStatus?.summary?.phase || water.canonicalGate?.summary?.phase || water.marketCalendar?.row?.phase || "unknown");
}

function payloadValue(water, names, fallback = undefined) {
  const rowPayload = water.sourceStatus?.row?.payload && typeof water.sourceStatus.row.payload === "object" ? water.sourceStatus.row.payload : null;
  const probePayload = Array.isArray(water.probes)
    ? water.probes.find((probe) => probe.name === "source_status")?.row?.payload
    : null;
  const payload = rowPayload || (probePayload && typeof probePayload === "object" ? probePayload : {});
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(payload, name) && payload[name] !== null && payload[name] !== undefined && payload[name] !== "") {
      return payload[name];
    }
  }
  return fallback;
}

function issue(code, severity, detail = {}) {
  return { code, severity, detail };
}

function buildReport() {
  const checkedAt = new Date().toISOString();
  const expectedDate = EXPECTED_DATE || taipeiDateKey();
  const water = readJson(WATER_ROOT_FILE, {});
  const issues = [];
  const warnings = [];
  const phase = phaseFromWaterRoot(water);
  const source = water.sourceStatus?.summary || {};
  const gate = water.canonicalGate?.summary || {};
  const intraday = water.intraday1m?.summary || {};
  const calendar = water.marketCalendar?.row || {};
  const motherPoolRows = numberValue(payloadValue(water, ["mother_pool_symbols", "formal_scan_pool_symbols"], water.motherPool?.rowCount || 0), 0);
  const priorityTop40Rows = numberValue(payloadValue(water, ["priority_top40_symbols", "priority_pool_symbols"], water.priorityTop40?.rowCount || 0), 0);
  const priorityCoverage = numberValue(source.priorityFreshQuoteCoverage120s ?? gate.priorityFreshQuoteCoverage120s ?? payloadValue(water, ["priority_top40_fresh_quote_coverage_120s", "priority_fresh_quote_coverage_120s"], 0), 0);
  const motherCoverage = numberValue(payloadValue(water, ["mother_pool_fresh_quote_coverage_120s"], 0), 0);
  const quoteAgeSeconds = numberValue(source.quoteAgeSeconds ?? gate.quoteAgeSeconds, 999999);
  const intradayStaleSeconds = numberValue(water.effectiveSource?.intraday1mStaleSeconds ?? source.intraday1mStaleSeconds ?? intraday.latestCandleAgeSeconds, 999999);
  const today1mSymbols = numberValue(payloadValue(water, ["today_1m_symbols", "intraday_1m_symbols_today"], 0), 0);
  const readyMa20 = numberValue(payloadValue(water, ["ready_ma20_continuous", "ready_ma20_continuous_symbols"], 0), 0);
  const readyMa35 = numberValue(payloadValue(water, ["ready_ma35_continuous", "ready_ma35_continuous_symbols", "ready_ge_35_symbols"], 0), 0);
  const formalEntryAllowed = gate.formalEntryAllowed === true || payloadValue(water, ["formal_entry_allowed"], false) === true;
  const scannerCanRunOpening = gate.scannerCanRunOpening === true || source.scannerCanRunOpening === true || payloadValue(water, ["scanner_can_run_opening"], false) === true;
  const formalVerdict = textValue(gate.formalEntrySpeedVerdict || payloadValue(water, ["formal_entry_speed_verdict"], ""));
  const gateGrade = textValue(gate.canonicalGateGrade || source.daytradeGateGrade || payloadValue(water, ["daytrade_gate_grade"], ""));
  const gateStatus = textValue(gate.canonicalGateStatus || payloadValue(water, ["canonical_gate_status", "gate_status"], ""));
  const sourceStatus = textValue(source.status || payloadValue(water, ["status"], ""));
  const isTradingDay = calendar.isTradingDay !== false;
  const after0845 = /opening_boost|opening_detection|regular_daytrade/.test(phase);
  const after0900 = /opening_detection|regular_daytrade/.test(phase);
  const offSession = /after_daytrade_window|closed_before_0600/.test(phase);

  if (!fs.existsSync(WATER_ROOT_FILE)) {
    issues.push(issue("water_root_artifact_missing", "critical", { file: WATER_ROOT_FILE, requiredCommand: "npm run verify:terminal-water-root" }));
  }
  if (water.expectedDate && String(water.expectedDate).replace(/\D/g, "").slice(0, 8) !== expectedDate) {
    issues.push(issue("water_root_expected_date_mismatch", "critical", { waterRootExpectedDate: water.expectedDate, expectedDate }));
  }
  if (!isTradingDay) {
    warnings.push(issue("market_closed_viewer_should_show_previous_good", "warning", { displayMode: calendar.displayMode || "", skipReason: calendar.skipReason || "" }));
  }
  if (after0845) {
    if (motherPoolRows < 300) issues.push(issue("mother_pool_rows_below_300", "critical", { motherPoolRows, required: 300 }));
    if (priorityTop40Rows < 40) issues.push(issue("priority_top40_rows_below_40", "critical", { priorityTop40Rows, required: 40 }));
    if (priorityCoverage < 0.95) issues.push(issue("priority_top40_fresh_coverage_below_095", "critical", { priorityCoverage, required: 0.95 }));
    if (motherCoverage > 0 && motherCoverage < 0.8) issues.push(issue("mother_pool_fresh_coverage_below_080", "critical", { motherCoverage, required: 0.8 }));
    if (quoteAgeSeconds > 90) issues.push(issue("quote_age_seconds_above_90", "critical", { quoteAgeSeconds, requiredMax: 90 }));
    if (scannerCanRunOpening !== true && !offSession) issues.push(issue("scanner_can_run_opening_false", "critical", { scannerCanRunOpening }));
  }
  if (after0900) {
    if (intradayStaleSeconds > 120) issues.push(issue("intraday_1m_stale_above_120", "critical", { intradayStaleSeconds, requiredMax: 120 }));
    if (today1mSymbols <= 0) issues.push(issue("today_1m_symbols_zero", "critical", { today1mSymbols }));
    if (readyMa20 <= 0) issues.push(issue("ready_ma20_continuous_zero", "critical", { readyMa20 }));
    if (readyMa35 <= 0) warnings.push(issue("ready_ma35_continuous_zero_or_not_required", "warning", { readyMa35, note: "Strategy2 may not require MA35, but viewers must disclose the actual value." }));
  }
  if (after0845 && !offSession) {
    if (gateGrade !== "A") issues.push(issue("canonical_gate_grade_not_A", "critical", { gateGrade }));
    if (!["ready", "ok"].includes(gateStatus)) issues.push(issue("canonical_gate_status_not_ready", "critical", { gateStatus }));
    if (formalVerdict !== "YES") issues.push(issue("formal_entry_speed_verdict_not_YES", "critical", { formalVerdict }));
    if (formalEntryAllowed !== true) issues.push(issue("formal_entry_allowed_false", "critical", { formalEntryAllowed }));
  }

  const report = {
    ok: issues.length === 0,
    checkedAt,
    expectedDate,
    contract: "daytrade-viewer-dream-readonly-v1",
    role: "other-laptop-daytrade-ps1-viewer-readonly",
    writesSupabase: false,
    requiresServiceRoleKey: false,
    requiresRepoOnViewerLaptop: false,
    viewerInstruction: "The other daytrade/PS1 laptop only needs authenticated viewer access to production/Supabase readbacks. It must not run apply scripts or write source_status.",
    phase,
    sourceStatus,
    gateGrade,
    gateStatus,
    formalVerdict,
    formalEntryAllowed,
    scannerCanRunOpening,
    evidence: {
      waterRootFile: WATER_ROOT_FILE,
      marketCalendar: { isTradingDay, displayMode: calendar.displayMode || "", skipReason: calendar.skipReason || "" },
      motherPoolRows,
      priorityTop40Rows,
      priorityFreshQuoteCoverage120s: priorityCoverage,
      motherPoolFreshQuoteCoverage120s: motherCoverage,
      quoteAgeSeconds,
      intraday1mStaleSeconds: intradayStaleSeconds,
      today1mSymbols,
      readyMa20Continuous: readyMa20,
      readyMa35Continuous: readyMa35,
    },
    formalSources: [
      "source_status:fugle_daytrade_source",
      "v_fugle_daytrade_canonical_gate",
      "v_fugle_daytrade_unattended_gate_status",
      "v_fugle_daytrade_mother_pool",
      "v_fugle_daytrade_priority_top40",
      "v_fugle_daytrade_formal_priority_top40",
      "fugle_daytrade_quotes_live",
      "fugle_daytrade_intraday_1m",
      "v_fugle_daytrade_intraday_1m_status",
      "fugle_daytrade_daily_volume_avg",
      "fugle_daytrade_futopt_quotes_live"
    ],
    forbiddenFormalSources: ["shared source", "FinMind", "Yahoo", "TWSE generic fallback", "static JSON latest", "viewer local cache"],
    issues,
    warnings,
    nextAction: issues.length
      ? "Viewer must report these exact issue codes/numbers; source/orchestrator machine must self-heal or fail closed. Do not declare formal entry ready."
      : "Viewer read-only dream contract is aligned with current water-root evidence; proceed to strategy scanner/runId closure if source machine also passes formal gate.",
  };
  return report;
}

function writeReport(report) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "daytrade-viewer-dream-readonly.json"), `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    "# Daytrade Viewer Dream Readonly",
    "",
    `- ok: ${report.ok}`,
    `- expectedDate: ${report.expectedDate}`,
    `- phase: ${report.phase}`,
    `- role: ${report.role}`,
    `- writesSupabase: ${report.writesSupabase}`,
    `- requiresServiceRoleKey: ${report.requiresServiceRoleKey}`,
    `- gate: ${report.gateGrade}/${report.gateStatus}/${report.formalVerdict}`,
    `- priorityTop40Coverage: ${report.evidence.priorityFreshQuoteCoverage120s}`,
    `- motherPoolRows: ${report.evidence.motherPoolRows}`,
    `- priorityTop40Rows: ${report.evidence.priorityTop40Rows}`,
    `- quoteAgeSeconds: ${report.evidence.quoteAgeSeconds}`,
    `- intraday1mStaleSeconds: ${report.evidence.intraday1mStaleSeconds}`,
    "",
    "## Issues",
    ...(report.issues.length ? report.issues.map((item) => `- ${item.severity}: ${item.code} ${JSON.stringify(item.detail)}`) : ["- none"]),
    "",
    "## Viewer Rule",
    `- ${report.viewerInstruction}`,
  ];
  fs.writeFileSync(path.join(OUT_DIR, "daytrade-viewer-dream-readonly.md"), `${lines.join("\n")}\n`);
}

try {
  const report = buildReport();
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error?.stack || error?.message || String(error) }, null, 2));
  process.exitCode = 1;
}