const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const runtime = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const collectorPath = path.join(root, "scripts", "fugle-futopt-websocket-collector.js");
const writerPath = path.join(root, "ops", "public-slot", "Run-DaytradeSourceWriter.ps1");
const pinnedPath = path.join(root, "ops", "public-slot", "Run-DaytradeSourceWriterPinned.ps1");
const installerPath = path.join(root, "ops", "public-slot", "install-daytrade-source-writer-task.ps1");

const read = (file) => fs.readFileSync(file, "utf8");
const collector = read(collectorPath);
const writer = read(writerPath);
const pinned = read(pinnedPath);
const installer = read(installerPath);
const statusPath = path.join(runtime, "state", "fugle-futopt-websocket-status.json");
const mirrorPath = path.join(runtime, "state", "fugle-daytrade-futopt-live-mirror.json");
const status = fs.existsSync(statusPath) ? JSON.parse(read(statusPath)) : null;
const mirror = fs.existsSync(mirrorPath) ? JSON.parse(read(mirrorPath)) : null;
const ageSeconds = (value) => {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? Math.max(0, Math.floor((Date.now() - parsed) / 1000)) : 999999;
};
const statusAgeSeconds = ageSeconds(status?.updatedAt);
const mirrorAgeSeconds = ageSeconds(mirror?.checked_at);

const checks = {
  collector_release_v5: collector.includes('COLLECTOR_RELEASE = "futopt-formal-live-mirror-v5"'),
  subscribe_is_paced: collector.includes("await delay(STREAMING_SUBSCRIBE_PACE_MS)"),
  runtime_only_api_key: !collector.includes("C:/fuman-terminal/secrets"),
  runtime_only_ticker_seed: !collector.includes("C:/fuman-terminal/ops/public-slot/runtime"),
  runtime_only_stock_seed: !collector.includes("C:/fuman-terminal/data/stocks-slim.json"),
  writer_requires_v5: writer.includes('FutoptCollectorRelease = "futopt-formal-live-mirror-v5"'),
  pinned_requires_v5: pinned.includes("approved_writer_futopt_release_mismatch:expected_v5"),
  installer_uses_pinned_wrapper: installer.includes("Run-DaytradeSourceWriterPinned.ps1"),
  no_v1_static_authority: ![collector, writer, pinned, installer].some((text) => text.includes("futopt-formal-live-mirror-v1")),
  live_status_v5: status?.collector_release === "futopt-formal-live-mirror-v5",
  live_symbol_scope_over_100: Number(status?.selectedSymbols || 0) > 100,
  live_formal_ready: status?.formalReady === true,
  live_status_fresh_120s: statusAgeSeconds <= 120,
  mirror_stock_rows_over_100: Number(mirror?.stock_future_rows || 0) > 100,
  mirror_written: mirror?.status === "written",
  mirror_fresh_180s: mirrorAgeSeconds <= 180,
};

const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
const result = {
  ok: failedChecks.length === 0,
  contract: "daytrade_futopt_v5_retirement_v1",
  checked_at: new Date().toISOString(),
  checks,
  live: {
    collector_release: status?.collector_release || null,
    selected_symbols: Number(status?.selectedSymbols || 0),
    formal_ready: status?.formalReady === true,
    stock_future_rows: Number(mirror?.stock_future_rows || 0),
    mirror_status: mirror?.status || null,
    status_age_seconds: statusAgeSeconds,
    mirror_age_seconds: mirrorAgeSeconds,
  },
  failed_checks: failedChecks,
  first_blocker: failedChecks[0] || null,
  read_only: true,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;
