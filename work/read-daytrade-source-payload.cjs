const fs = require('fs');
const key = process.env.SUPABASE_ANON_KEY || fs.readFileSync('C:\\fuman-runtime\\secrets\\supabase-anon-key.txt', 'utf8').trim();
const url = 'https://cpmpfhbzutkiecccekfr.supabase.co/rest/v1/source_status?source_name=eq.fugle_daytrade_source&select=source_name,status,updated_at,payload&limit=1';
(async () => {
  const response = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
  const row = JSON.parse(body)[0] || {};
  const payload = row.payload || {};
  console.log(JSON.stringify({
    sourceName: row.source_name,
    status: row.status,
    updatedAt: row.updated_at,
    fields: {
      basePoolEligible: payload.base_pool_eligible_symbols,
      basePoolPending: payload.base_pool_pending_symbols,
      basePoolFailureCounts: payload.mother_pool_base_pool_failure_counts,
      basePoolPendingCounts: payload.mother_pool_base_pool_pending_counts,
      motherPool: payload.mother_pool_symbols,
      priority: payload.priority_pool_symbols,
      dailyVolumeRows: payload.daily_volume_rows,
      avgVolume5Eligible: payload.avg_volume5_eligible,
      avgVolume5Coverage: payload.avg_volume5_coverage,
      quoteRows: payload.quote_rows,
      freshQuotes: payload.fresh_quotes_120s,
      today1mSymbols: payload.today_1m_symbols,
      today1mRows: payload.today_1m_rows,
      failedChecks: payload.failed_checks,
    },
  }, null, 2));
})().catch((error) => { console.error(error.stack || error.message || String(error)); process.exit(1); });
