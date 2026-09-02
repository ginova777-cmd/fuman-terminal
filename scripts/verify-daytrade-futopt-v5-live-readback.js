const { serverSupabaseKey, serverSupabaseUrl } = require("../lib/server-supabase-key");

async function main() {
  const baseUrl = serverSupabaseUrl();
  const apiKey = serverSupabaseKey();
  const cutoff = new Date(Date.now() - 180000).toISOString();
  const url = new URL(`${baseUrl}/rest/v1/fugle_daytrade_futopt_quotes_live`);
  url.searchParams.set("select", "future_symbol,underlying_symbol,underlying_name,updated_at,last_price,change_percent,total_volume,product");
  url.searchParams.set("updated_at", `gte.${cutoff}`);
  url.searchParams.set("order", "change_percent.desc.nullslast");
  url.searchParams.set("limit", "1000");

  const response = await fetch(url, {
    headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`futopt_live_readback_http_${response.status}`);
  const rows = await response.json();
  const stockRows = rows.filter((row) => row.product === "STOCK_FUTURE" && /^\d{4}$/.test(String(row.underlying_symbol || "")));
  const txfRows = rows.filter((row) => row.product === "TXF" || /^TXF/i.test(String(row.future_symbol || "")));
  const readyRows = stockRows.filter((row) => Number(row.last_price || 0) > 0);
  const top20 = readyRows
    .slice()
    .sort((a, b) => Number(b.change_percent || 0) - Number(a.change_percent || 0))
    .slice(0, 20);
  const checks = {
    fresh_stock_rows_over_100: stockRows.length > 100,
    ready_rows_over_100: readyRows.length > 100,
    txf_rows_present: txfRows.length > 0,
    top20_has_multiple_rows: top20.length > 1,
  };
  const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  const result = {
    ok: failedChecks.length === 0,
    contract: "daytrade_futopt_v5_live_readback_v1",
    checked_at: new Date().toISOString(),
    freshness_cutoff: cutoff,
    futopt_total_rows: rows.length,
    futopt_stock_rows: stockRows.length,
    futopt_mapped_underlying_count: new Set(stockRows.map((row) => row.underlying_symbol)).size,
    txf_rows: txfRows.length,
    ready_rows: readyRows.length,
    sample_stock_futures_top20: top20,
    checks,
    failed_checks: failedChecks,
    first_blocker: failedChecks[0] || null,
    read_only: true,
  };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    contract: "daytrade_futopt_v5_live_readback_v1",
    first_blocker: error?.message || String(error),
    read_only: true,
  }, null, 2));
  process.exitCode = 1;
});
