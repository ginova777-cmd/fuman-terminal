const fs = require("fs");
const path = require("path");
const api = require("../api/seven-strategy-daily-history.js");

const hooks = api.__test;
if (!hooks) throw new Error("missing __test export from api/seven-strategy-daily-history.js");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "88.html"), "utf8");
const apiSource = fs.readFileSync(path.join(root, "api", "seven-strategy-daily-history.js"), "utf8");
const scorecardSource = fs.readFileSync(path.join(root, "api", "scorecard.js"), "utf8");
const sql = fs.readFileSync(path.join(root, "ops", "public-slot", "SevenStrategyDailyHistory.sql"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const today = "2026-07-08";
const fixture = [
  {
    trade_date: today,
    detect_time: "09:15:02",
    symbol: "2330",
    name: "台積電",
    entry_price: 1000,
    current_price: 1005,
    change_percent: 0.5,
    score: 92,
    strategy: "PS1",
    signal_type: "formal",
    source: "fugle-entry-history",
    updated_at: "2026-07-08T01:15:05.000Z",
  },
  {
    trade_date: today,
    detect_time: "13:29:59",
    symbol: "2317",
    name: "鴻海",
    entry_price: 220,
    current_price: 221,
    change_percent: 0.45,
    score: 80,
    strategy: "PS1",
    signal_type: "detected",
    source: "fugle-detected-history",
    updated_at: "2026-07-08T05:29:59.000Z",
  },
  { trade_date: "2026-07-07", detect_time: "10:00:00", symbol: "2454", name: "聯發科", entry_price: 1200, strategy: "PS1", signal_type: "formal", source: "fugle-entry-history" },
  { trade_date: today, detect_time: "08:59:59", symbol: "2603", name: "長榮", entry_price: 180, strategy: "PS1", signal_type: "detected", source: "fugle-detected-history" },
  { trade_date: today, detect_time: "13:30:01", symbol: "2618", name: "長榮航", entry_price: 40, strategy: "PS1", signal_type: "detected", source: "fugle-detected-history" },
  { trade_date: today, detect_time: "10:30:00", symbol: "2881", name: "富邦金", entry_price: 90, strategy: "PS1", signal_type: "formal", source: "replay-entry" },
  { trade_date: today, detect_time: "11:00:00", symbol: "", name: "國泰金", entry_price: 70, strategy: "PS1", signal_type: "detected", source: "fugle-detected-history" },
  { trade_date: today, detect_time: "12:00:00", symbol: "2882", name: "", entry_price: 70, strategy: "PS1", signal_type: "detected", source: "fugle-detected-history" },
  { trade_date: today, detect_time: "12:30:00", symbol: "2883", name: "開發金", entry_price: null, strategy: "PS1", signal_type: "formal", source: "fugle-entry-history" },
];

const normalized = hooks.normalizeRows(fixture, today, 100);
const summary = hooks.summarizeRows(normalized.rows);
const checks = [
  ["source_name_fixed", hooks.SOURCE_NAME === "seven_strategy_daily_history"],
  ["html_section_marker", html.includes("seven-strategy-daily-history-panel")],
  ["html_fetches_supabase_api", html.includes("/api/seven-strategy-daily-history")],
  ["html_has_no_qutie_local_json_fetch", !html.includes("fugle-entry-history.json") && !html.includes("fugle-detected-history.json")],
  ["api_table_contract", apiSource.includes("public.seven_strategy_daily_history")],
  ["api_has_no_fs_read", !/fs\./.test(apiSource)],
  ["source_reports_connected", scorecardSource.includes("seven_strategy_daily_history") && scorecardSource.includes("/api/seven-strategy-daily-history")],
  ["sql_table", /create table if not exists public\.seven_strategy_daily_history/i.test(sql)],
  ["sql_regular_session_constraint", /detect_time >= time '09:00:00' and detect_time <= time '13:30:00'/i.test(sql)],
  ["sql_signal_type_constraint", /signal_type in \('formal', 'detected'\)/i.test(sql)],
  ["sql_no_replay_constraint", /seven_strategy_daily_history_no_replay/i.test(sql)],
  ["sql_grant_select", /grant select on public\.seven_strategy_daily_history to anon,\s*authenticated/i.test(sql)],
  ["required_fields_contract", hooks.REQUIRED_FIELDS.includes("symbol") && hooks.REQUIRED_FIELDS.includes("entryPrice") && hooks.REQUIRED_FIELDS.includes("strategy")],
  ["keeps_today_window_only", normalized.rows.length === 2],
  ["latest_on_top", normalized.rows[0]?.symbol === "2317" && normalized.rows[1]?.symbol === "2330"],
  ["formal_detected_counts", summary.formalCount === 1 && summary.detectedCount === 1],
  ["filters_old_date", normalized.filtered.nonToday === 1],
  ["filters_outside_window", normalized.filtered.outsideWindow === 2],
  ["filters_replay", normalized.filtered.replay === 1],
  ["filters_blank_required", normalized.filtered.blankRequired === 3],
];

const failed = checks.filter(([, ok]) => !ok).map(([issue]) => issue);
assert(!failed.length, `issues=${failed.join(",")}`);

console.log(`[scorecard-seven-strategy-daily-history-contract] rawOk=true source=${hooks.SOURCE_NAME} table=${hooks.TABLE_NAME} kept=${normalized.rows.length} first=${normalized.rows[0].symbol} formal=${summary.formalCount} detected=${summary.detectedCount} filteredOld=${normalized.filtered.nonToday} filteredWindow=${normalized.filtered.outsideWindow} filteredReplay=${normalized.filtered.replay} filteredBlankRequired=${normalized.filtered.blankRequired} endpoint=/api/seven-strategy-daily-history sourceReports=true localFileRead=false`);
