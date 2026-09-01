const fs = require("fs");
const path = require("path");
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
function readText(file) { try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; } }
const KEY = process.env.SUPABASE_ANON_KEY || process.env.FUMAN_SUPABASE_ANON_KEY || readText(path.join(RUNTIME_DIR, "secrets", "supabase-anon-key.txt"));
function arg(name, fallback = "") { const prefix = `--${name}=`; return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback; }
function taipeiDate() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function symbolsArg() { return [...new Set(String(arg("symbols", "2481,3211,3264")).split(/[,+]/).map((value) => value.replace(/\D/g, "").slice(0, 4)).filter((value) => /^\d{4}$/.test(value)))]; }
function positive(value) { const number = Number(value); return Number.isFinite(number) && number > 0; }
async function select(resource, params) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}?${new URLSearchParams(params)}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: "application/json" }, signal: AbortSignal.timeout(15000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${resource}_HTTP_${response.status}:${body.slice(0, 240)}`);
  return body ? JSON.parse(body) : [];
}
async function main() {
  if (!KEY) throw new Error("missing_supabase_anon_key");
  const tradeDate = arg("trade-date", taipeiDate());
  const producerPath = path.join(__dirname, "run-daytrade-near-one-source.js");
  if (!fs.existsSync(producerPath)) throw new Error("near_one_producer_missing");
  const symbols = symbolsArg();
  const filter = `in.(${symbols.join(",")})`;
  const [liveRows, contractRows, nearRows, snapshotRows] = await Promise.all([
    select("fugle_daytrade_futopt_quotes_live", { select: "future_symbol,underlying_symbol,last_price,change_percent,total_volume,updated_at,product,source", underlying_symbol: filter, order: "updated_at.desc", limit: "100" }),
    select("v_fugle_daytrade_stock_future_live_contract", { select: "*", trade_date: `eq.${tradeDate}`, symbol: filter, limit: "100" }),
    select("v_fugle_daytrade_near_one_contract", { select: "*", trade_date: `eq.${tradeDate}`, symbol: filter, limit: "100" }),
    select("v_fugle_daytrade_preopen_snapshot_contract", { select: "*", trade_date: `eq.${tradeDate}`, underlying_symbol: filter, limit: "100" }),
  ]);
  const latestLive = new Map();
  for (const row of liveRows) { const symbol = String(row.underlying_symbol || ""); if (!latestLive.has(symbol)) latestLive.set(symbol, row); }
  const contractBySymbol = new Map(contractRows.map((row) => [String(row.symbol || ""), row]));
  const nearBySymbol = new Map(nearRows.map((row) => [String(row.symbol || ""), row]));
  const snapshotCount = new Map();
  for (const row of snapshotRows) { const symbol = String(row.underlying_symbol || ""); snapshotCount.set(symbol, (snapshotCount.get(symbol) || 0) + 1); }
  const failures = [];
  const cases = symbols.map((symbol) => {
    const raw = latestLive.get(symbol) || null;
    const contract = contractBySymbol.get(symbol) || null;
    const near = nearBySymbol.get(symbol) || null;
    const futureSymbol = String(contract?.future_symbol || "").trim().toUpperCase();
    const lastPrice = Number(contract?.futopt_last_price);
    const totalVolume = Number(contract?.futopt_total_volume);
    const hasFutureContract = Boolean(contract) && Boolean(futureSymbol) && futureSymbol !== "TXF";
    const emptyShell = Boolean(contract) && (!hasFutureContract || !positive(lastPrice) || !positive(totalVolume));
    if (!contract) failures.push(`${symbol}:future_contract_missing`);
    if (contract && !hasFutureContract) failures.push(`${symbol}:future_symbol_missing_or_invalid`);
    if (contract && !positive(lastPrice)) failures.push(`${symbol}:futopt_last_price_not_positive`);
    if (contract && !positive(totalVolume)) failures.push(`${symbol}:futopt_total_volume_not_positive`);
    if (emptyShell) failures.push(`${symbol}:empty_future_contract_shell_row`);
    if (raw && !contract) failures.push(`${symbol}:live_quote_not_exposed_by_contract_view`);
    if (!near) failures.push(`${symbol}:near_one_contract_missing`);
    if (!(snapshotCount.get(symbol) > 0)) failures.push(`${symbol}:preopen_snapshot_missing`);
    return {
      symbol, has_future_contract: hasFutureContract, future_symbol: futureSymbol || null,
      futopt_last_price: Number.isFinite(lastPrice) ? lastPrice : null,
      futopt_change_percent: Number.isFinite(Number(contract?.futopt_change_percent)) ? Number(contract.futopt_change_percent) : null,
      futopt_total_volume: Number.isFinite(totalVolume) ? totalVolume : null,
      relative_to_txf_percent: Number.isFinite(Number(contract?.relative_to_txf_percent)) ? Number(contract.relative_to_txf_percent) : null,
      raw_live_present: Boolean(raw), contract_view_present: Boolean(contract), empty_shell_row: emptyShell,
      near_one_present: Boolean(near), preopen_snapshot_count: snapshotCount.get(symbol) || 0,
      source_status: hasFutureContract ? contract.source_status : "no_contract",
      reason_code: !contract ? "future_contract_missing" : (emptyShell ? "empty_future_contract_shell_row" : null),
    };
  });
  const output = { ok: failures.length === 0, producer_path: producerPath, producer_exists: true, contract: "daytrade_futopt_star_readback_readonly_v1", trade_date: tradeDate, checked_at: new Date().toISOString(), symbols, cases, failed_checks: failures, first_blocker: failures[0] || null, read_only: true };
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, contract: "daytrade_futopt_star_readback_readonly_v1", failed_checks: [error.message], first_blocker: error.message, read_only: true }, null, 2)); process.exitCode = 1; });