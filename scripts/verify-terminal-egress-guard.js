const fs = require("fs");
const path = require("path");

const terminalRoot = process.env.FUMAN_TERMINAL_ROOT || process.cwd();
const file = path.join(terminalRoot, "terminal-app.js");
const source = fs.readFileSync(file, "utf8");

const requirements = [
  {
    id: "strategy2_active_tab_guard",
    match: 'const isActive=()=>!!(isViewActive?.("strategy")&&selectedStrategyIds?.has?.("intraday_2m"));'
  },
  {
    id: "strategy3_active_tab_guard",
    match: 'isActive=()=>!!(isViewActive?.("strategy")&&(strategyPresetMode==="strategy3"||selectedStrategyIds?.has?.("overnight_chip")))'
  },
  {
    id: "strategy4_active_tab_guard",
    match: 'isActive=()=>!!(isViewActive?.("strategy")&&selectedStrategyIds?.has?.("swing_radar"))'
  },
  {
    id: "strategy2_no_15_second_background_poll",
    absent: "setInterval(()=>poll(!1),15000);"
  },
  {
    id: "strategy_poll_minimum_90_seconds",
    minCount: 3,
    match: "setInterval(()=>poll(!1),Math.max(9e4,cleanNumber(FUMAN_TUNING_CONFIG.completeRunPollMs||9e4)))"
  }
];

const checks = requirements.map(requirement => {
  const count = requirement.match ? source.split(requirement.match).length - 1 : 0;
  const ok = requirement.absent ? !source.includes(requirement.absent) : requirement.minCount ? count >= requirement.minCount : count > 0;
  return { id: requirement.id, ok, count: requirement.match ? count : undefined };
});

const result = {
  ok: checks.every(check => check.ok),
  checked_at: new Date().toISOString(),
  file,
  policy: "strategy API polling is active-tab-only and no faster than 90 seconds",
  checks
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;
