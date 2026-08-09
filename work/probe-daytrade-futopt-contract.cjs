const fs = require('fs');
const key = process.env.SUPABASE_ANON_KEY || fs.readFileSync('C:\\fuman-runtime\\secrets\\supabase-anon-key.txt', 'utf8').trim();
const base = 'https://cpmpfhbzutkiecccekfr.supabase.co/rest/v1/';
const resources = [
  ['v_fugle_daytrade_stock_future_live_contract', 'select=*&limit=5'],
  ['v_stock_future_live_contract', 'select=*&limit=5'],
  ['fugle_daytrade_futopt_quotes_live', 'select=*&order=updated_at.desc&limit=5'],
  ['futopt_tickers', 'select=*&limit=10'],
  ['strategy1_futopt_preopen_live_snapshot', 'select=*&limit=5'],
  ['fugle_preopen_snapshot', 'select=*&order=updated_at.desc&limit=5'],
  ['fugle_preopen_snapshot_history', 'select=*&order=updated_at.desc&limit=5'],
];

async function read(name, query) {
  const response = await fetch(`${base}${name}?${query}`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(12000) });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text.slice(0, 500); }
  return { status: response.status, rows: Array.isArray(body) ? body : [], body: Array.isArray(body) ? undefined : body };
}

(async () => {
  const result = {};
  for (const [name, query] of resources) {
    try {
      const readback = await read(name, query);
      result[name] = { status: readback.status, rows: readback.rows.length, sample: readback.rows.slice(0, 5), error: readback.body || '' };
    } catch (error) {
      result[name] = { status: 0, rows: 0, sample: [], error: error.message || String(error) };
    }
  }
  console.log(JSON.stringify(result, null, 2));
})().catch((error) => { console.error(error.stack || error.message || String(error)); process.exit(1); });
