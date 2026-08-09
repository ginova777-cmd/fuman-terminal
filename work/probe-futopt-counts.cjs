const fs = require('fs');
const key = process.env.SUPABASE_ANON_KEY || fs.readFileSync('C:\\fuman-runtime\\secrets\\supabase-anon-key.txt', 'utf8').trim();
const base = 'https://cpmpfhbzutkiecccekfr.supabase.co/rest/v1/';
const resources = [
  ['v_fugle_daytrade_stock_future_live_contract', 'select=trade_date,symbol,future_symbol,source_symbol,updated_at&limit=1'],
  ['v_stock_future_live_contract', 'select=trade_date,symbol,future_symbol,underlying_symbol,updated_at&limit=1'],
  ['fugle_daytrade_futopt_quotes_live', 'select=future_symbol,underlying_symbol,updated_at&limit=1'],
  ['futopt_tickers', 'select=*&limit=1'],
  ['strategy1_futopt_preopen_live_snapshot', 'select=trade_date,symbol,updated_at&limit=1'],
];
(async () => {
  const out = {};
  for (const [name, query] of resources) {
    const response = await fetch(`${base}${name}?${query}`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' }, signal: AbortSignal.timeout(12000) });
    const text = await response.text();
    let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = text.slice(0, 400); }
    out[name] = { status: response.status, contentRange: response.headers.get('content-range') || '', sample: Array.isArray(body) ? body[0] || null : null, error: Array.isArray(body) ? '' : body };
  }
  console.log(JSON.stringify(out, null, 2));
})().catch((error) => { console.error(error.stack || error.message || String(error)); process.exit(1); });
