"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { OPENING_REPORT_0830_INDUSTRY_MAP, leaderPairs } = require("./opening-report-0830-industry-map-contract");

const tradeDate = "2026-08-28";
const compact = tradeDate.replace(/\D/g, "");
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "fuman-opening-report-asia-fixture-"));
const reportDir = path.join(runtime, "data", "opening-report-0830");

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

try {
  const industries = OPENING_REPORT_0830_INDUSTRY_MAP.map((industry) => {
    const leaders = leaderPairs(industry).map(([name, yahoo]) => ({
      name,
      yahoo_symbol: yahoo || "",
      industry: industry.industry,
      ok: false,
      source_time: "",
      percent: null,
      direction: "unknown",
      display: "資料不足",
      reason_code: "fixture_unavailable",
    }));
    return {
      industry: industry.industry,
      display_name: industry.display_name,
      leader_count: leaders.length,
      valid_count: 0,
      unavailable_count: leaders.length,
      average_percent: null,
      display: "資料不足",
      direction: "unknown",
      reason_code: "fixture_unavailable",
      leaders,
    };
  });
  const memory = industries.find((industry) => industry.industry === "MEMORY");
  memory.leaders = [
    {
      name: "Micron",
      yahoo_symbol: "MU",
      industry: "MEMORY",
      ok: true,
      source_time: "2026-08-27T20:00:00.000Z",
      percent: 2.25,
      direction: "positive",
      display: "偏強",
      reason_code: "leader_positive",
    },
    {
      name: "SK hynix",
      yahoo_symbol: "000660.KS",
      industry: "MEMORY",
      ok: true,
      source_time: "2026-08-27T06:00:00.000Z",
      percent: 99.99,
      direction: "positive",
      display: "偏強",
      reason_code: "leader_positive",
    },
  ];
  memory.leader_count = 2;
  memory.valid_count = 2;
  memory.unavailable_count = 0;
  memory.average_percent = 51.12;
  memory.display = "偏強";
  memory.direction = "positive";

  writeJson(path.join(reportDir, `opening-report-0820-overseas-leaders-${compact}.json`), {
    contract: "opening-report-0830-overseas-leaders-v1",
    ok: true,
    date: tradeDate,
    run_id: "fixture-0820",
    cutoff: `${tradeDate} 08:20:00 Asia/Taipei`,
    industries,
  });
  writeJson(path.join(reportDir, `opening-report-0820-market-snapshot-${compact}.json`), {
    contract: "opening-report-0820-market-snapshot-v1",
    ok: true,
    date: tradeDate,
    run_id: "fixture-0820",
    cutoff: `${tradeDate} 08:20:00 Asia/Taipei`,
    items: [
      { key: "nasdaq", label: "NASDAQ", percent: 0.4, source_time: "2026-08-27T20:00:00.000Z", source_url: "fixture" },
      { key: "sox", label: "SOX", percent: 0.5, source_time: "2026-08-27T20:00:00.000Z", source_url: "fixture" },
      { key: "japan", label: "日股", percent: 0.1, source_time: "2026-08-28T00:10:00.000Z", source_url: "fixture" },
      { key: "korea", label: "韓股", percent: 0.2, source_time: "2026-08-28T00:10:00.000Z", source_url: "fixture" },
    ],
  });

  const result = childProcess.spawnSync(process.execPath, [
    path.join(__dirname, "run-opening-report-0830-production.js"),
    `--date=${tradeDate}`,
    "--run-id=fixture-0830",
    "--no-terminal-snapshot",
  ], {
    encoding: "utf8",
    env: { ...process.env, FUMAN_RUNTIME_DIR: runtime, FUMAN_STATE_DIR: path.join(runtime, "state"), BACKTEST_MODE: "1" },
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  const final = JSON.parse(fs.readFileSync(path.join(reportDir, `opening-report-0830-final-receipt-${compact}.json`), "utf8"));
  const memoryInput = JSON.parse(fs.readFileSync(path.join(runtime, "state", "opening_report_0830.industry_bias.MEMORY.json"), "utf8"));

  assert.strictEqual(final.ok, true);
  assert.strictEqual(final.report_status, "REPORT_OK");
  assert(final.overseas_source_gap_count >= 1, "stale or missing Asia leaders must remain visible as source gaps");
  assert.strictEqual(memoryInput.overseas_leader_detection.average_percent, 2.25);
  assert.strictEqual(memoryInput.overseas_sector_up_1d, true);
  console.log(JSON.stringify({
    ok: true,
    contract: "opening_report_asia_partial_delivery_fixtures_v1",
    report_status: final.report_status,
    source_gap_leaders: final.overseas_source_gap_count,
    memory_average_excluding_stale_korea: memoryInput.overseas_leader_detection.average_percent,
  }, null, 2));
} finally {
  fs.rmSync(runtime, { recursive: true, force: true });
}
