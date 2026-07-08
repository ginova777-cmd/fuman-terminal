const { serverSupabaseKey, serverSupabaseUrl } = require("../lib/server-supabase-key");

const TABLE = "fugle_daytrade_entry_history";
const FULL_TABLE = "public.fugle_daytrade_entry_history";
const FIELDS = [
  "trade_date",
  "entry_time",
  "symbol",
  "name",
  "entry_price",
  "current_price",
  "strategy_label",
  "note",
  "source",
  "created_at",
];

function todayTaipeiDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function seconds(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return -1;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function hasReplayObservation(row) {
  return [row.source, row.strategy_label].some((value) => {
    const text = String(value || "").toLowerCase();
    return text.includes("replay") || text.includes("observation");
  });
}

async function supabaseFetch(pathname) {
  const url = serverSupabaseUrl();
  const key = serverSupabaseKey();
  if (!url || !key) throw new Error("missing_supabase_credentials");
  const response = await fetch(`${url}/rest/v1/${pathname}`, {
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      accept: "application/json",
      "cache-control": "no-store",
    },
  });
  const body = await response.text();
  let json = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    json = null;
  }
  return { status: response.status, ok: response.ok, json, body };
}

async function main() {
  const today = todayTaipeiDate();
  const params = new URLSearchParams();
  params.set("select", FIELDS.join(","));
  params.set("trade_date", `eq.${today}`);
  params.append("entry_time", "gte.09:00:00");
  params.append("entry_time", "lte.13:30:00");
  params.set("order", "entry_time.desc,created_at.desc");
  params.set("limit", "50");
  const response = await supabaseFetch(`${TABLE}?${params.toString()}`);
  const rows = Array.isArray(response.json) ? response.json : [];
  const issues = [];
  if (!response.ok) issues.push(`http_status_${response.status}`);
  if (!Array.isArray(response.json)) issues.push("payload_not_array");
  for (const [index, row] of rows.entries()) {
    for (const field of FIELDS) {
      if (!(field in row)) issues.push(`row_${index}_missing_${field}`);
    }
    if (row.trade_date !== today) issues.push(`row_${index}_old_trade_date_${row.trade_date || "missing"}`);
    const key = seconds(row.entry_time);
    if (key < seconds("09:00:00") || key > seconds("13:30:00")) issues.push(`row_${index}_outside_window_${row.entry_time || "missing"}`);
    if (!String(row.symbol || "").trim()) issues.push(`row_${index}_blank_symbol`);
    if (hasReplayObservation(row)) issues.push(`row_${index}_replay_observation`);
    if (index > 0 && seconds(rows[index - 1].entry_time) < key) issues.push(`row_${index}_order_not_latest_first`);
  }
  if (issues.length) {
    console.error(`[scorecard-daytrade-entry-supabase] rawOk=false table=${FULL_TABLE} tradeDate=${today} issues=${issues.join(",")} rows=${rows.length} status=${response.status} body=${String(response.body || "").slice(0, 240)}`);
    process.exit(1);
  }
  console.log(`[scorecard-daytrade-entry-supabase] rawOk=true table=${FULL_TABLE} tradeDate=${today} rows=${rows.length} fields=${FIELDS.join(",")} window=09:00:00-13:30:00 order=entry_time.desc,created_at.desc formalFilter=replay_observation_absent`);
}

main().catch((error) => {
  console.error(`[scorecard-daytrade-entry-supabase] rawOk=false error=${error.stack || error.message || error}`);
  process.exit(1);
});
