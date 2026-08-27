const fs = require('fs');
const path = require('path');

const view = process.env.DAYTRADE_SOURCE_HEALTH_READBACK_VIEW || 'v_fugle_daytrade_source_health_readback';
const url = (process.env.SUPABASE_URL || 'https://cpmpfhbzutkiecccekfr.supabase.co').replace(/\/+$/, '');
const tradeDate = (process.argv.find((arg) => arg.startsWith('--trade-date=')) || '').split('=').pop() || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
const symbol = ((process.argv.find((arg) => arg.startsWith('--symbol=')) || '').split('=').pop() || '').replace(/\D/g, '').slice(0, 4);

function secret() {
  for (const file of [path.join(process.cwd(), 'secrets', 'supabase-anon-key.txt'), 'C:/fuman-runtime/secrets/supabase-anon-key.txt']) {
    try { const value = fs.readFileSync(file, 'utf8').trim(); if (value) return value; } catch {}
  }
  return process.env.SUPABASE_ANON_KEY || process.env.FUMAN_SUPABASE_ANON_KEY || '';
}

async function main() {
  const key = secret();
  if (!key) throw new Error('supabase_anon_key_missing');
  const params = new URLSearchParams({
    select: 'trade_date,symbol,source_name,quote_seen_at,received_at,aggregate_last_updated,latest_candle_time,first_candle_time,last_candle_time,candle_count,data_gap,data_gap_reason,quote_age_seconds,intraday_1m_stale_seconds',
    trade_date: 'eq.' + tradeDate,
    limit: symbol ? '1' : '200',
  });
  if (symbol) params.set('symbol', 'eq.' + symbol);
  const response = await fetch(url + '/rest/v1/' + view + '?' + params, { headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' } });
  const text = await response.text();
  if (!response.ok) throw new Error(view + '_HTTP_' + response.status + ':' + text.slice(0, 300));
  const rows = JSON.parse(text || '[]');
  const list = Array.isArray(rows) ? rows : [];
  const health = list[0] || null;
  const failed_checks = [];
  if (symbol && !health) failed_checks.push('symbol_not_in_health_readback');
  if (health && String(health.trade_date) !== tradeDate) failed_checks.push('trade_date_mismatch');
  if (health && health.data_gap === true) failed_checks.push('data_gap:' + (health.data_gap_reason || 'unspecified'));
  console.log(JSON.stringify({ ok: failed_checks.length === 0, contract: 'daytrade_websocket_health_readback_readonly_v1', view, trade_date: tradeDate, symbol: symbol || null, rows: list.length, health, failed_checks, first_blocker: failed_checks[0] || null, read_only: true, auth: 'anon_or_publishable_key' }, null, 2));
  process.exitCode = failed_checks.length ? 1 : 0;
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, contract: 'daytrade_websocket_health_readback_readonly_v1', view, trade_date: tradeDate, symbol: symbol || null, failed_checks: ['health_readback_view_unreadable'], first_blocker: 'health_readback_view_unreadable', read_error: error.message, read_only: true, auth: 'anon_or_publishable_key' }, null, 2));
  process.exitCode = 1;
});
