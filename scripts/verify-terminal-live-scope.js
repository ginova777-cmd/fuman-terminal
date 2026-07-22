const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const files = [
  "api/terminal-fast-bundle.js",
  "api/mobile-fragment.js",
  "api/scorecard.js",
  "api/source-reports.js",
];

const issues = [];
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
function push(rel, lineNo, code, line) {
  issues.push({ file: rel, line: lineNo, code, line: line.trim() });
}
function context(lines, index, before = 10, after = 2) {
  return lines.slice(Math.max(0, index - before), Math.min(lines.length, index + after + 1)).join("\n");
}

for (const rel of files) {
  const text = read(rel);
  const lines = text.split(/\r?\n/);

  if (rel === "api/mobile-fragment.js") {
    lines.forEach((line, idx) => {
      if (/tab !== "ai" \? \{ live: 1, verify: 1, noSnapshot: 1 \}/.test(line)) {
        push(rel, idx + 1, "mobile_broad_live_fragment", line);
      }
      if (/noSnapshot/.test(line) && !/shouldUseLiveFragment/.test(line) && !/strategy2/.test(context(lines, idx))) {
        push(rel, idx + 1, "mobile_non_daytrade_no_snapshot", line);
      }
      if (/live:\s*["']1["']/.test(line) && !/shouldUseLiveFragment/.test(line) && !/strategy2/.test(context(lines, idx))) {
        push(rel, idx + 1, "mobile_non_daytrade_live", line);
      }
    });
    continue;
  }

  if (rel === "api/terminal-fast-bundle.js") {
    lines.forEach((line, idx) => {
      const ctx = context(lines, idx);
      if (/live=1/.test(line) && !/strategy2-latest/.test(line)) {
        push(rel, idx + 1, "terminal_non_daytrade_live_endpoint", line);
      }
      if (/noSnapshot/.test(line) && !/strategy2/.test(ctx)) {
        push(rel, idx + 1, "terminal_non_daytrade_no_snapshot", line);
      }
      if (/live:\s*["']1["']/.test(line) && !/strategy2/.test(ctx)) {
        push(rel, idx + 1, "terminal_non_daytrade_live_query", line);
      }
      if (/repairRealtimeRadarSnapshotEndpoints/.test(line)) {
        push(rel, idx + 1, "retired_realtime_radar_repair_import", line);
      }
    });
    continue;
  }

  if (rel === "api/scorecard.js") {
    lines.forEach((line, idx) => {
      if (/live=1/.test(line) || /live:\s*["']1["']/.test(line) || /noSnapshot/.test(line)) {
        push(rel, idx + 1, "scorecard_must_not_force_live", line);
      }
    });
    continue;
  }
}

const terminalFastBundle = read("api/terminal-fast-bundle.js");
if (!terminalFastBundle.includes("function liveFanoutEnabled")) {
  issues.push({ file: "api/terminal-fast-bundle.js", code: "missing_live_fanout_kill_switch", line: "FUMAN_TERMINAL_FAST_BUNDLE_LIVE_FANOUT" });
}
if (!terminalFastBundle.includes("const wantsLive = requestedLiveFanout && liveFanoutEnabled(request);")) {
  issues.push({ file: "api/terminal-fast-bundle.js", code: "terminal_live_fanout_not_env_gated", line: "wantsLive must be gated by liveFanoutEnabled" });
}

const scorecard = read("api/scorecard.js");
if (!scorecard.includes("function scorecardLiveSourceReportsEnabled")) {
  issues.push({ file: "api/scorecard.js", code: "missing_scorecard_live_source_reports_gate", line: "FUMAN_SCORECARD_LIVE_SOURCE_REPORTS" });
}
if (!scorecard.includes("const forceLiveSourceReports = scorecardLiveSourceReportsEnabled(request);")) {
  issues.push({ file: "api/scorecard.js", code: "scorecard_live_source_reports_not_env_gated", line: "strictLiveReports/refreshSourceReports must not directly enable live source reports" });
}
if (!scorecard.includes("const liveSnapshotReadback = scorecardLiveSnapshotReadbackEnabled(request);")) {
  issues.push({ file: "api/scorecard.js", code: "scorecard_live_snapshot_not_env_gated", line: "live/snapshotLive must not directly force live readback" });
}

const publicSlotSharedSource = read("ops/public-slot/Run-PublicSlotSharedSource.ps1");
if (/strategy1_open_buy_results\?select/i.test(publicSlotSharedSource)) {
  issues.push({ file: "ops/public-slot/Run-PublicSlotSharedSource.ps1", code: "retired_strategy1_shared_source_read", line: "shared source warmup must not read strategy1_open_buy_results" });
}
if (/fuman_realtime_radar_cache\?select/i.test(publicSlotSharedSource)) {
  issues.push({ file: "ops/public-slot/Run-PublicSlotSharedSource.ps1", code: "retired_realtime_radar_shared_source_read", line: "shared source warmup must not read fuman_realtime_radar_cache" });
}

const daytradeWriter = read("scripts/run-daytrade-source-writer.js");
if (/addMany\("strategy1"|addMany\("realtime_radar"/.test(daytradeWriter)) {
  issues.push({ file: "scripts/run-daytrade-source-writer.js", code: "retired_priority_seed_in_daytrade_writer", line: "daytrade writer must not seed Strategy1/realtime radar" });
}

const websocketCollector = read("ops/public-slot/fugle-websocket-collector.js");
if (/addMany\("strategy1"|addMany\("realtimeRadar"/.test(websocketCollector)) {
  issues.push({ file: "ops/public-slot/fugle-websocket-collector.js", code: "retired_priority_seed_in_websocket_collector", line: "WebSocket collector must not subscribe Strategy1/realtime radar priority seeds" });
}
const sourceReports = read("api/source-reports.js");
if (!sourceReports.includes("function sourceReportsLiveSourceReportsEnabled")) {
  issues.push({ file: "api/source-reports.js", code: "missing_source_reports_live_gate", line: "FUMAN_SCORECARD_LIVE_SOURCE_REPORTS" });
}
if (!sourceReports.includes("const forceLiveSourceReports = sourceReportsLiveSourceReportsEnabled(request);")) {
  issues.push({ file: "api/source-reports.js", code: "source_reports_live_not_env_gated", line: "strictLiveReports/refreshSourceReports must not directly enable live source reports" });
}

if (issues.length) {
  console.error(JSON.stringify({ ok: false, issueCount: issues.length, issues }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({
  ok: true,
  contract: "terminal-live-scope-v1",
  rule: "Only Strategy2/daytrade and explicit source gates may force live/noSnapshot; scorecard/mobile/desktop default to snapshots/sourceReports.",
  checkedFiles: files,
}, null, 2));
