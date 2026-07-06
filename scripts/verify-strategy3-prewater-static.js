const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const FILES = {
  scanner: path.join(ROOT, "scripts", "scan-strategy3-cache.js"),
  api: path.join(ROOT, "api", "strategy3-latest.js"),
  verifier: path.join(ROOT, "scripts", "verify-strategy3-battle-state.js"),
  sourceContract: path.join(ROOT, "lib", "run-time-source-snapshot-contract.js"),
  sourceSlot: path.join(ROOT, "lib", "supabase-public-slot.js"),
  daytradeWriter: path.join(ROOT, "scripts", "run-daytrade-source-writer.js"),
};

const REQUIRED_MARKERS = {
  scanner: [
    "fetchStrategy3QuoteLatestReady",
    "fetchStrategy3Intraday1mStatus",
    "fetchStrategy3Intraday1mLatestN",
    "fetchStrategy3LiveSideVolumeMap",
    "stock_daily_volume",
    "source_snapshot_captured_at",
    "source_status_at_run",
    "quote_coverage_at_run",
    "intraday_1m_readiness_at_run",
    "ma_readiness_at_run",
    "preopen_futopt_daily_readiness_at_run",
    "run_quality_at_publish",
    "fallbackUsed",
    "fallbackScope",
    "fallbackDetails",
    "degradedBlocksLatest",
    "preservePreviousGood",
    "writeBudget",
    "retentionOk",
    "evidenceStatus",
    "unattendedStatus",
    "requiredFields",
    "blankCounts",
    "sampleMissingRows",
    "blockedReason",
    "scanner_block_reason",
  ],
  api: [
    "FORMAL_SOURCE_CHAIN",
    "fugle_quotes_latest+v_strategy3_intraday_1m_status+stock_daily_volume",
    "apiOnlyError",
    "source_snapshot_captured_at",
    "source_status_at_run",
    "quote_coverage_at_run",
    "intraday_1m_readiness_at_run",
    "ma_readiness_at_run",
    "preopen_futopt_daily_readiness_at_run",
    "run_quality_at_publish",
    "fallbackUsed",
    "fallbackScope",
    "fallbackDetails",
    "fallbackContract",
    "degradedBlocksLatest",
    "preservePreviousGood",
    "writeBudget",
    "retentionOk",
    "evidenceStatus",
    "unattendedStatus",
    "requiredFields",
    "blankCounts",
    "sampleMissingRows",
    "blockedReason",
    "scanner_block_reason",
  ],
  verifier: [
    "sourceEvidenceMissingFields",
    "sourceEvidenceIssues",
    "source_snapshot_captured_at",
    "source_status_at_run",
    "quote_coverage_at_run",
    "intraday_1m_readiness_at_run",
    "ma_readiness_at_run",
    "preopen_futopt_daily_readiness_at_run",
    "run_quality_at_publish",
    "fallbackUsed",
    "fallbackScope",
    "fallbackDetails",
    "writeBudget",
    "retentionOk",
    "api_unattendedStatus",
    "api_evidenceStatus",
  ],
  sourceContract: [
    "source_snapshot_captured_at",
    "source_status_at_run",
    "quote_coverage_at_run",
    "intraday_1m_readiness_at_run",
    "ma_readiness_at_run",
    "preopen_futopt_daily_readiness_at_run",
    "run_quality_at_publish",
    "auditRunTimeSourceSnapshot",
    "buildRunTimeSourceSnapshotFields",
  ],
  sourceSlot: [
    "fugle_daytrade_source",
    "v_fugle_daytrade_source_contract_health",
    "quote_age_seconds",
    "fetchStrategy3QuoteLatestReady",
    "fetchStrategy3Intraday1mStatus",
  ],
  daytradeWriter: [
    "fugle_daytrade_source",
    "fugle_daytrade_source_speed_scorecard",
    "scanner_can_run_opening",
    "daytrade_gate_grade",
    "priority_fresh_quote_coverage_120s",
    "quote_age_seconds",
  ],
};

const SOURCE_DEPENDENCIES = [
  {
    sourceName: "Strategy3 quotes",
    tableViewRpc: "fugle_quotes_latest",
    requiredColumns: ["symbol/code", "price", "change", "volume", "updated_at/quote time"],
    freshnessThreshold: "quote_age_seconds <= 120s; daytrade target <= 90s",
    coverageThreshold: "rows >= 1000; fresh_quote_coverage_120s >= 0.95",
    gradeA: "fresh coverage >= 0.95 and quote age inside threshold",
    degradedOk: "off-session stale only with captured run-time snapshot",
    unacceptable: "timeout, missing quote age, low coverage, formal fallback",
  },
  {
    sourceName: "Strategy3 intraday 1m",
    tableViewRpc: "v_strategy3_intraday_1m_status",
    requiredColumns: ["symbol", "today_1m_symbols", "ready_ge_35", "latest_candle_time", "stale_seconds"],
    freshnessThreshold: "market <= 120s; off-session must carry captured-at evidence",
    coverageThreshold: "rowCount >= 1000; ready_ge_35 sufficient",
    gradeA: "rowCount >= 1000, latest candle present, no market stale",
    degradedOk: "after-session stale with complete run-time snapshot",
    unacceptable: "market stale, missing latest candle, low row count",
  },
  {
    sourceName: "Strategy3 daily volume",
    tableViewRpc: "stock_daily_volume",
    requiredColumns: ["symbol", "trade_date", "volume", "avg_volume"],
    freshnessThreshold: "latest trade date",
    coverageThreshold: "rows >= 1000",
    gradeA: "latestDate equals trade date and rows >= 1000",
    degradedOk: "holiday only with trading-calendar reason",
    unacceptable: "missing date or low rows",
  },
  {
    sourceName: "Dedicated daytrade source",
    tableViewRpc: "source_status(fugle_daytrade_source), fugle_daytrade_source_speed_scorecard, v_fugle_daytrade_source_contract_health",
    requiredColumns: ["gateGrade", "quote_age_seconds", "priority_fresh_quote_coverage_120s", "scanner_can_run_opening"],
    freshnessThreshold: "<= 90s live",
    coverageThreshold: "priority coverage >= 0.95",
    gradeA: "gateGrade=A and formalEntryAllowed=true",
    degradedOk: "B/C observation only; no formal entry",
    unacceptable: "D, stale, scanner_can_run_opening=false",
  },
];

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function main() {
  const issues = [];
  const checks = [];
  for (const [label, file] of Object.entries(FILES)) {
    const text = read(file);
    for (const marker of REQUIRED_MARKERS[label] || []) {
      const ok = text.includes(marker);
      checks.push({ label, marker, ok });
      if (!ok) issues.push(`${label} missing ${marker}`);
    }
  }

  const fixtureDir = path.join(ROOT, "fixtures", "strategy3-prewater");
  const fixtures = fs.existsSync(fixtureDir)
    ? fs.readdirSync(fixtureDir).filter((name) => name.endsWith(".json")).sort()
    : [];
  if (fixtures.length < 11) issues.push(`fixture count ${fixtures.length} below 11`);

  const result = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    mode: "local-static-no-supabase",
    dependencies: SOURCE_DEPENDENCIES,
    fixtures,
    checks,
    issues,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`[strategy3-prewater-static] failed: ${error.message || String(error)}`);
  process.exitCode = 1;
}
