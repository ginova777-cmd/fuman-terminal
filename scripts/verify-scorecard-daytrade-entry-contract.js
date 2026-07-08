const fs = require("fs");
const path = require("path");
const api = require("../api/daytrade-entry-history.js");

const hooks = api.__test;
if (!hooks) throw new Error("missing __test export from api/daytrade-entry-history.js");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "88.html"), "utf8");
const apiSource = fs.readFileSync(path.join(root, "api", "daytrade-entry-history.js"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const today = "2026-07-08";
const fixture = [
  {
    trade_date: today,
    entry_time: "09:15:02",
    symbol: "2330",
    name: "台積電",
    entry_price: 1000,
    current_price: 1005,
    strategy_label: "PS1",
    note: "formal entry",
    source: "ps1-live",
    created_at: "2026-07-08T01:15:05.000Z",
  },
  {
    trade_date: today,
    entry_time: "13:29:59",
    symbol: "2317",
    name: "鴻海",
    entry_price: 220,
    current_price: 221,
    strategy_label: "PS1",
    note: "latest formal entry",
    source: "ps1-live",
    created_at: "2026-07-08T05:29:59.000Z",
  },
  { trade_date: "2026-07-07", entry_time: "10:00:00", symbol: "2454", source: "ps1-live" },
  { trade_date: today, entry_time: "08:59:59", symbol: "2603", source: "ps1-live" },
  { trade_date: today, entry_time: "13:30:01", symbol: "2618", source: "ps1-live" },
  { trade_date: today, entry_time: "10:30:00", symbol: "2881", source: "ps1-replay" },
  { trade_date: today, entry_time: "11:00:00", symbol: "2882", strategy_label: "PS1 observation", source: "ps1-live" },
  { trade_date: today, entry_time: "12:00:00", symbol: "", source: "ps1-live" },
];

const normalized = hooks.normalizeRows(fixture, today);
const issueChecks = [
  ["html_section_marker", html.includes("daytrade-ps1-entry-panel")],
  ["html_tab_marker", html.includes("scorecard-daytrade-ps1-tab") && html.includes("data-jump-panel")],
  ["html_fetches_supabase_api", html.includes("/api/daytrade-entry-history")],
  ["html_has_no_local_entry_file_fetch", !/\/data\/.*entry/i.test(html)],
  ["api_table_contract", apiSource.includes("public.fugle_daytrade_entry_history")],
  ["api_has_no_fs_read", !/fs\./.test(apiSource)],
  ["required_fields_contract", hooks.ENTRY_FIELDS.includes("trade_date") && hooks.ENTRY_FIELDS.includes("created_at")],
  ["keeps_today_window_formal_only", normalized.rows.length === 2],
  ["latest_on_top", normalized.rows[0]?.symbol === "2317" && normalized.rows[1]?.symbol === "2330"],
  ["filters_old_date", normalized.filtered.nonToday === 1],
  ["filters_outside_window", normalized.filtered.outsideWindow === 2],
  ["filters_replay_observation", normalized.filtered.replayObservation === 2],
  ["filters_blank_symbol", normalized.filtered.blankSymbol === 1],
];

const failed = issueChecks.filter(([, ok]) => !ok).map(([issue]) => issue);
assert(!failed.length, `issues=${failed.join(",")}`);

console.log(`[scorecard-daytrade-entry-contract] rawOk=true table=${hooks.TABLE_NAME} kept=${normalized.rows.length} first=${normalized.rows[0].symbol} filteredOld=${normalized.filtered.nonToday} filteredWindow=${normalized.filtered.outsideWindow} filteredReplayObservation=${normalized.filtered.replayObservation} filteredBlankSymbol=${normalized.filtered.blankSymbol} order=latest-first endpoint=/api/daytrade-entry-history source=supabase-only localFileRead=false`);
