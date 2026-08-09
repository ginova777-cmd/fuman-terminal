const fs = require('fs');
const key = process.env.SUPABASE_ANON_KEY || fs.readFileSync('C:\\fuman-runtime\\secrets\\supabase-anon-key.txt', 'utf8').trim();
const base = 'https://cpmpfhbzutkiecccekfr.supabase.co/rest/v1/';
const resources = [
  ['v_fugle_daytrade_stock_future_live_contract', 'select=trade_date,symbol,future_symbol,source_symbol,updated_at,contract_source,formal_quote_source&limit=1'],
  ['v_stock_future_live_contract', 'select=trade_date,symbol,future_symbol,underlying_symbol,near_month,updated_at,contract_source,formal_quote_source&limit=1'],
  ['fugle_daytrade_futopt_quotes_live', 'select=future_symbol,underlying_symbol,product,updated_at,source&limit=1'],
  ['futopt_tickers', 'select=symbol,name,near_one,near_month,end_date,updated_at&limit=1'],
  ['strategy1_futopt_preopen_live_snapshot', 'select=*&limit=1'],
  ['fugle_preopen_snapshot', 'select=trade_date,symbol,updated_at,session&limit=1'],
  ['fugle_preopen_snapshot_history', 'select=trade_date,symbol,observed_at,updated_at,session&limit=1'],
];

async function read(name, query) {
  const response = await fetch(`${base}${name}?${query}`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' }, signal: AbortSignal.timeout(12000) });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text.slice(0, 500); }
  return { status: response.status, contentRange: response.headers.get('content-range') || '', body };
}

(async () => {
  const result = {};
  for (const [name, query] of resources) {
    try {
      const item = await read(name, query);
      result[name] = { status: item.status, contentRange: item.contentRange, sample: Array.isArray(item.body) ? item.body[0] || null : null, error: Array.isArray(item.body) ? '' : item.body };
    } catch (error) {
      result[name] = { status: 0, contentRange: '', sample: null, error: error.message || String(error) };
    }
  }
  console.log(JSON.stringify(result, null, 2));
})().catch((error) => { console.error(error.stack || error.message || String(error)); process.exit(1); });
