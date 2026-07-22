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
