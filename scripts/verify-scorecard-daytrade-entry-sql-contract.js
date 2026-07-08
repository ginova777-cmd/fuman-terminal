const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sqlPath = path.join(root, "ops", "public-slot", "DaytradePs1EntryHistory.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

function has(pattern) {
  return pattern.test(sql);
}

const checks = [
  ["create_table", /create table if not exists public\.fugle_daytrade_entry_history/i],
  ["trade_date_required", /trade_date\s+date\s+not null/i],
  ["entry_time_required", /entry_time\s+time without time zone\s+not null/i],
  ["symbol_required", /symbol\s+text\s+not null/i],
  ["entry_price_field", /entry_price\s+numeric/i],
  ["current_price_field", /current_price\s+numeric/i],
  ["strategy_label_field", /strategy_label\s+text\s+not null/i],
  ["source_field", /source\s+text\s+not null/i],
  ["created_at_field", /created_at\s+timestamp with time zone\s+not null/i],
  ["blank_symbol_check", /symbol_not_blank/i],
  ["replay_observation_check", /formal_source[\s\S]*replay[\s\S]*observation/i],
  ["regular_session_check", /regular_session[\s\S]*09:00:00[\s\S]*13:30:00/i],
  ["today_latest_index", /idx_fugle_daytrade_entry_history_today_latest/i],
  ["symbol_latest_index", /idx_fugle_daytrade_entry_history_symbol_latest/i],
  ["unique_formal_entry_index", /uq_fugle_daytrade_entry_history_formal_entry/i],
  ["rls_enabled", /alter table public\.fugle_daytrade_entry_history enable row level security/i],
  ["anon_authenticated_select_policy", /for select[\s\S]*to anon,\s*authenticated[\s\S]*using \(true\)/i],
  ["service_manage_policy", /for all[\s\S]*to service_role[\s\S]*with check \(true\)/i],
  ["grant_select", /grant select on public\.fugle_daytrade_entry_history to anon,\s*authenticated/i],
  ["grant_service_all", /grant all on public\.fugle_daytrade_entry_history to service_role/i],
];

const failed = checks.filter(([, ok]) => !ok).map(([issue]) => issue);
if (failed.length) {
  console.error(`[scorecard-daytrade-entry-sql-contract] rawOk=false issues=${failed.join(",")}`);
  process.exit(1);
}

console.log(`[scorecard-daytrade-entry-sql-contract] rawOk=true file=ops/public-slot/DaytradePs1EntryHistory.sql table=public.fugle_daytrade_entry_history fields=trade_date,entry_time,symbol,name,entry_price,current_price,strategy_label,note,source,created_at rls=enabled read=anon/authenticated write=service_role constraints=blank_symbol,replay_observation,regular_session indexes=today_latest,symbol_latest,unique_formal_entry`);
