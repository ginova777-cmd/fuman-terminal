const fs = require("fs");
const path = require("path");

const root = process.env.FUMAN_TERMINAL_ROOT || process.cwd();
const target = path.join(root, "terminal-app.js");
const source = fs.readFileSync(target, "utf8");

const checks = {
  same_day_display_cache_layer: source.includes("installStrategySameDayDisplayCache"),
  taipei_trade_date_guard: source.includes('timeZone:"Asia/Taipei"'),
  cache_requires_today_run_id_and_rows: source.includes("cached.tradeDate!==taipeiDate()||!cached.runId||!Array.isArray(cached.rows)||!cached.rows.length"),
  strategy3_force_bypasses_cache: source.includes('const cached=!force?read("strategy3"):null'),
  strategy4_force_bypasses_cache: source.includes('const cached=!force?read("strategy4"):null'),
  strategy3_cache_is_formal_payload_bound: source.includes("window.__fumanStrategy3FormalPayload"),
  strategy4_cache_requires_strategy4_run_id: source.includes("/^strategy4-/i.test(runId)"),
  cached_screen_is_labelled_verifying: source.includes("同日已驗證快取") && source.includes("背景驗證中"),
  strategy2_not_persisted_by_this_layer: !source.includes('write("strategy2"'),
  strategy3_memory_cache_is_not_cross_day: source.includes('!sameToday(strategy3UsedDateKey)'),
  strategy4_memory_cache_is_not_cross_day: source.includes('!sameToday(dateFromRunId(strategy4ApiRunId))'),
};

const failures = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);

const output = {
  ok: failures.length === 0,
  verifier: "terminal-strategy-display-cache",
  target,
  checks,
  failures,
  policy: {
    display_cache_only: true,
    current_taipei_trade_date_only: true,
    run_id_required: true,
    force_refresh_bypasses_cache: true,
    strategy2_persistent_cache: false,
  },
};

console.log(JSON.stringify(output, null, 2));
process.exitCode = output.ok ? 0 : 1;
