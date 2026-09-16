const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const base = 'https://cpmpfhbzutkiecccekfr.supabase.co/rest/v1/';
const key = fs.readFileSync('C:/fuman-runtime/secrets/supabase-anon-key.txt', 'utf8').trim();
async function get(table, select) {
  const rows = [], pages = [];
  for (let offset = 0; offset < 10000; offset += 500) {
    const response = await fetch(base + table + '?' + new URLSearchParams({ select, order: 'symbol.asc', limit: '500', offset: String(offset) }),
      { headers: { apikey: key, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`${table}:HTTP_${response.status}`);
    const chunk = await response.json(); pages.push({ offset, http: response.status, count: chunk.length }); rows.push(...chunk);
    if (chunk.length < 500) return { rows, pages };
  }
  throw new Error('pagination_limit');
}
(async () => {
  const master = await get('stock_tickers', 'symbol,name,market,stock_type,payload');
  const cachePath = 'C:/fuman-runtime/cache/intraday/fugle-daytrade-ws-quotes-v2.json';
  const raw = fs.readFileSync(cachePath, 'utf8');
  const cache = JSON.parse(raw.replace(/^\uFEFF/, ''));
  const quotes = new Map((cache.quotes || []).map(row => [row.code, row]));
  const rows = master.rows.map(row => {
    const p = row.payload || {}, q = quotes.get(row.symbol) || {};
    return { symbol: row.symbol, name: row.name, market: row.market, stock_type: row.stock_type,
      master: { official_present: p.official_present, official_issued_common_shares: p.official_issued_common_shares,
        stock_master_source: p.stock_master_source, stock_master_source_date: p.stock_master_source_date,
        stock_master_synced_at: p.stock_master_synced_at, stock_master_run_id: p.stock_master_run_id },
      volume: { value: q.tradeVolume ?? null, unit: q.totalVolumeUnit ?? null, available: q.totalVolumeAvailable ?? null,
        event_at: q.totalVolumeSourceEventAt ?? null, is_synthetic: q.isSynthetic ?? null, source: 'existing_fugle_collector_typed_cumulative_volume' } };
  });
  const result = { scope: 'anon_master_readback_and_local_collector_cache_readonly', checked_at: new Date().toISOString(),
    master_pages: master.pages, master_count: rows.length, master_positive_shares: rows.filter(r => r.master.official_issued_common_shares > 0).length,
    typed_volume_count: rows.filter(r => ['lots','shares'].includes(r.volume.unit) && r.volume.available === true).length,
    source_dates: [...new Set(rows.map(r => r.master.stock_master_source_date))],
    cache_sha256: crypto.createHash('sha256').update(raw).digest('hex'), rows,
    production_ranking_verified: false, live_freshness_verified: false };
  const file = path.join(__dirname, '../outputs/daytrade-turnover-source-audit.json');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, rows: undefined, file }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
