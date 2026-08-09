const fs = require('fs');
const { readFugleWebSocketQuotes } = require('C:\\fuman-terminal\\lib\\fugle-websocket-quotes');

const URL = 'https://cpmpfhbzutkiecccekfr.supabase.co';
const read = (file) => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; } };
const key = process.env.SUPABASE_ANON_KEY || read('C:\\fuman-runtime\\secrets\\supabase-anon-key.txt') || read('C:\\fuman-runtime\\secrets\\supabase-service-role-key.txt');
if (!key) throw new Error('missing Supabase read key');
const code = (value) => String(value || '').replace(/\D/g, '').slice(0, 4).padStart(4, '0');
const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const current = (row, ...names) => names.map((name) => row && row[name]).find((value) => value !== undefined && value !== null && value !== '');

async function readPaged(resource, query) {
  const rows = [];
  for (let offset = 0; offset < 10000; offset += 1000) {
    const response = await fetch(`${URL}/rest/v1/${resource}?${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${offset}-${offset + 999}` },
      signal: AbortSignal.timeout(10000),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`${resource} HTTP ${response.status}: ${body.slice(0, 200)}`);
    const page = body ? JSON.parse(body) : [];
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function main() {
  const [active, quotes, daily] = await Promise.all([
    readPaged('stock_tickers', 'select=symbol,market,stock_type,type,is_etf,is_suspended&order=symbol.asc'),
    readPaged('fugle_daytrade_quotes_live', 'select=symbol,price,open_price,previous_close,total_volume,change_percent,quote_seen_at,updated_at&order=symbol.asc'),
    readPaged('fugle_daytrade_daily_volume_avg', 'select=symbol,avg_volume5,avg5_volume,volume,trade_date,updated_at&order=symbol.asc'),
  ]);
  const activeSet = new Set(active.filter((row) => !row.is_etf && !row.is_suspended).map((row) => code(row.symbol)).filter(Boolean));
  const quoteMap = new Map(quotes.map((row) => [code(row.symbol), row]));
  const dailyMap = new Map(daily.map((row) => [code(row.symbol), row]));
  const cache = readFugleWebSocketQuotes({ maxAgeMs: 120000 });
  const wsRows = [...cache.quotes.entries()].map(([symbol, row]) => ({ symbol: code(symbol || row.code || row.symbol), row }));
  const merged = [...activeSet].map((symbol) => {
    const old = quoteMap.get(symbol) || {};
    const ws = cache.quotes.get(symbol) || {};
    const choose = (value, fallback, positiveOnly) => {
      const n = Number(value);
      if (Number.isFinite(n) && (!positiveOnly || n > 0)) return n;
      const p = Number(fallback);
      return Number.isFinite(p) ? p : 0;
    };
    return {
      symbol,
      price: choose(current(ws, 'close', 'price'), old.price, true),
      open: choose(current(ws, 'open', 'openPrice'), old.open_price, true),
      previousClose: choose(current(ws, 'previousClose', 'previous_close', 'referencePrice'), old.previous_close, true),
      volume: choose(current(ws, 'tradeVolume', 'total_volume'), old.total_volume, true),
      avg5: Number(dailyMap.get(symbol)?.avg_volume5 ?? dailyMap.get(symbol)?.avg5_volume ?? 0),
    };
  });
  const fieldCount = (rows, field) => rows.filter((row) => positive(row[field])).length;
  console.log(JSON.stringify({
    active: { rows: active.length, eligible: activeSet.size },
    supabaseQuotes: { rows: quotes.length, matched: quotes.filter((row) => activeSet.has(code(row.symbol))).length, price: fieldCount(quotes, 'price'), open: fieldCount(quotes, 'open_price'), previousClose: fieldCount(quotes, 'previous_close'), volume: fieldCount(quotes, 'total_volume') },
    dailyVolume: { rows: daily.length, avg5Positive: daily.filter((row) => positive(row.avg_volume5 ?? row.avg5_volume)).length, avg5Gt3000: daily.filter((row) => Number(row.avg_volume5 ?? row.avg5_volume) > 3000).length, matched: daily.filter((row) => activeSet.has(code(row.symbol))).length },
    websocketCache: { rows: wsRows.length, updatedAt: cache.payload?.updatedAt || '', price: wsRows.filter(({ row }) => positive(current(row, 'close', 'price'))).length, open: wsRows.filter(({ row }) => positive(current(row, 'open', 'openPrice'))).length, previousClose: wsRows.filter(({ row }) => positive(current(row, 'previousClose', 'previous_close', 'referencePrice'))).length, volume: wsRows.filter(({ row }) => positive(current(row, 'tradeVolume', 'total_volume'))).length },
    mergedActive: { rows: merged.length, price: fieldCount(merged, 'price'), open: fieldCount(merged, 'open'), previousClose: fieldCount(merged, 'previousClose'), volume: fieldCount(merged, 'volume'), avg5Gt3000: merged.filter((row) => row.avg5 > 3000).length, strictBaseShape: merged.filter((row) => row.price >= 10 && row.price <= 1000 && row.avg5 > 3000 && row.volume > 0).length },
  }, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message || String(error)); process.exit(1); });
