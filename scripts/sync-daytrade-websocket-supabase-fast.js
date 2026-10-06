"use strict";

const fs = require("fs");
const path = require("path");
const { isTwseTradingDay } = require("./twse-trading-day");

const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const CACHE = path.join(RUNTIME, "cache", "intraday");
const URL = String(process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const APPLY = process.argv.includes("--apply");

function readText(file) { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } }
function secret(name) { return String(process.env[name] || readText(path.join(RUNTIME, "secrets", name.toLowerCase().replace(/_/g, "-") + ".txt"))).trim(); }
function parseCache(name) {
  for (const file of [path.join(CACHE, name), path.join(CACHE, name + ".bak")]) {
    try { return JSON.parse(readText(file)); } catch { /* retry stable backup */ }
  }
  throw new Error(`cache_unreadable:${name}`);
}
function tradeDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}
function iso(value) { const time = Date.parse(String(value || "")); return Number.isFinite(time) ? new Date(time).toISOString() : null; }
function num(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function volumeUnit(q = {}) {
  const explicit = String(q.totalVolumeUnit || q.total_volume_unit || q.volumeUnit || q.volume_unit || "").toLowerCase();
  if (["lots", "shares"].includes(explicit)) return explicit;
  const market = String(q.market || "").toUpperCase();
  if (q.intradayOddLot === true || market === "ESB") return "shares";
  if (q.intradayOddLot === false || ["TSE", "OTC", "TIB"].includes(market)) return "lots";
  return "";
}
async function upsert(table, rows, conflict, onBatch = () => {}, guard = null, deadline = Infinity, ledger = null) {
  if(table==='fugle_daytrade_quotes_live'&&rows.length&&process.env.FUMAN_SHARED_WATER_ACCEPTANCE==='1'){
    return require('../lib/mother-shared-water-quote-lane.cjs').writerLane.run(rows,frozen=>upsertUnchecked(table,frozen,conflict,onBatch,guard,deadline,ledger));
  }
  return upsertUnchecked(table,rows,conflict,onBatch,guard,deadline,ledger);
}
async function upsertUnchecked(table, rows, conflict, onBatch = () => {}, guard = null, deadline = Infinity, ledger = null) {
  if (table === 'fugle_daytrade_quotes_live') rows = rows.map(require('../lib/daytrade-quote-liquidity-contract').normalizeQuoteLiquidity);
  if(ledger)rows=ledger.select(rows).pending;
  if (!rows.length) return 0;
  const key = secret("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("service_role_key_missing");
  let written = 0;
  for (let offset = 0; offset < rows.length; offset += 200) {
    if (guard && await guard() !== true) throw Error('QUOTE_ONLY_WRITER_GUARD_REJECTED');
    const timeoutMs=Math.min(30000,deadline-Date.now());
    if(timeoutMs<=0)throw Error('QUOTE_ONLY_PUBLICATION_DEADLINE');
    const response = await fetch(`${URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows.slice(offset, offset + 200)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`${table}_HTTP_${response.status}:${(await response.text()).slice(0, 240)}`);
    written += Math.min(200, rows.length - offset);
    if(ledger)ledger.acknowledge(rows.slice(offset,offset+200),new Date().toISOString());
    await onBatch(rows.slice(offset, offset + 200));
  }
  return written;
}

async function main({beforeQuoteRead,afterQuoteWrite,quotesOnly=false,recentCandles=false,canPublish,quoteLedger} = {}) {
  if(recentCandles&&!quotesOnly)throw Error('RECENT_CANDLES_REQUIRE_INCREMENTAL_MODE');
  if(quoteLedger&&!quotesOnly)throw Error('QUOTE_LEDGER_REQUIRES_QUOTE_ONLY_MODE');
  if (quotesOnly && APPLY && (typeof canPublish !== 'function' || await canPublish() !== true)) throw Error('QUOTE_ONLY_WRITER_GUARD_REQUIRED');
  const now = new Date();
  const date = tradeDate(now);
  const calendar = await isTwseTradingDay(now, { stateDir: path.join(RUNTIME, "state") });
  if (!calendar.isTradingDay) return console.log(JSON.stringify({ ok: true, skipped: true, reason: "market_calendar_non_trading_day", trade_date: date }));
  const quoteEvidenceContext = APPLY && beforeQuoteRead ? await beforeQuoteRead() : null;
  const quoteCache = parseCache("fugle-daytrade-ws-quotes-v2.json");
  // A closed 5-minute candle is verified shortly after its boundary. Keep
  // enough Fugle candle events to include all five source minutes plus normal
  // collector/writer delay; three minutes systematically dropped slots 1-2.
  const quotes = (quoteCache.quotes || []).filter((q) => require('../lib/mother-shared-water-quote-retention.cjs').retainQuote(q,{tradeDate:date,nowMs:now.getTime(),includeSameDayIdle:quotesOnly&&typeof beforeQuoteRead==='function'&&typeof afterQuoteWrite==='function'})).map((q) => {
    const totalVolume = num(q.tradeVolume);
    const totalVolumeUnit = volumeUnit(q);
    const totalVolumeSourceEventAt = iso(q.totalVolumeSourceEventAt || q.exchangeTime || q.quoteSeenAt);
    const totalVolumeAvailable = totalVolume !== null && totalVolume >= 0 && Boolean(totalVolumeUnit) && Boolean(totalVolumeSourceEventAt);
    return {
      symbol: String(q.code || q.symbol || ""), trade_date: date, name: q.name || String(q.code || ""), market: q.market || "",
      quote_seen_at: iso(q.quoteSeenAt || q.exchangeTime || q.receivedAt), updated_at: iso(q.receivedAt || q.quoteSeenAt),
      last_trade_time: iso(q.lastTradeTime || (q.quoteSource === "fugle-ws-trades" ? q.exchangeTime : null)),
      price: num(q.formalLastPrice ?? q.close), open_price: num(q.open), high_price: num(q.high), low_price: num(q.low), previous_close: num(q.prevClose),
      change_percent: num(q.percent), total_volume: totalVolume, trade_value: num(q.tradeValue), bid_price: num(q.bidPrice), bid_volume: num(q.bidSize),
      ask_price: num(q.askPrice), ask_volume: num(q.askSize), cumulative_bid_volume: num(q.cumulativeBidVolume), cumulative_ask_volume: num(q.cumulativeAskVolume),
      source: "fugle_websocket_fast_sync",
      payload: {
        quoteSource: q.quoteSource,
        turnoverVolumeEvidence: q.turnoverVolumeEvidence || null,
        tradeValueEvidence: q.tradeValueEvidence || null,
        exchangeTime: q.exchangeTime,
        fastSync: true,
        total_volume_unit: totalVolumeUnit || null,
        volume_unit: totalVolumeUnit || null,
        total_volume_raw_unit: totalVolumeUnit || null,
        total_volume_source_event_at: totalVolumeSourceEventAt,
        total_volume_available: totalVolumeAvailable,
        is_synthetic: false,
      },
    };
  }).filter((q) => /^\d{4}$/.test(q.symbol) && q.quote_seen_at);
  async function publishQuotes(result) {
    if (quotesOnly && await canPublish() !== true) throw Error('QUOTE_ONLY_WRITER_GUARD_REJECTED');
    const writtenSymbols=[];
    result.quotes_written = await upsert("fugle_daytrade_quotes_live", quotes, "symbol", batch=>writtenSymbols.push(...batch.map(q=>q.symbol)), quotesOnly ? canPublish : null, quotesOnly ? Date.now()+20000 : Infinity,quoteLedger);
    const acknowledgements=quoteLedger?quoteLedger.select(quotes.map(require('../lib/daytrade-quote-liquidity-contract').normalizeQuoteLiquidity)).acknowledged:[];
    result.quote_rows_reused=quoteLedger?acknowledgements.length-result.quotes_written:0;
    result.quote_write_completed_at = result.quotes_written>0 ? new Date().toISOString() : null;
    if (afterQuoteWrite) result.shared_water_acceptance = await afterQuoteWrite({
      context: quoteEvidenceContext, trade_date: date, quotes_written: result.quotes_written,
      written_symbols: writtenSymbols,
      quote_acknowledgements: acknowledgements,
      write_completed_at: result.quote_write_completed_at,
    });
  }
  if (quotesOnly) {
    const result={ok:true,mode:APPLY?'apply':'dry_run',scope:'quotes_only',trade_date:date,checked_at:now.toISOString(),quote_rows:quotes.length,quote_cache_updated_at:quoteCache.updatedAt,candles_processed:false,candle_backfill_complete:false};
    if(recentCandles){
      const file=path.join(CACHE,'fugle-daytrade-ws-candles-v2.json.recent.json');
      const stat=fs.statSync(file);if(!stat.isFile()||stat.size>16*1024*1024)throw Error('RECENT_CANDLE_READ_LIMIT');
      const text=fs.readFileSync(file,'utf8');if(Buffer.byteLength(text)>16*1024*1024)throw Error('RECENT_CANDLE_READ_LIMIT');
      const recent=JSON.parse(text),stamp=Date.parse(recent.updatedAt);
      if(recent.contract!=='daytrade-recent-candle-cache-v1'||!Array.isArray(recent.candles)||recent.candles.length>6000||recent.count!==recent.candles.length||recent.full_history_complete!==false||!Number.isFinite(stamp)||stamp>now.getTime()||tradeDate(new Date(stamp))!==date)throw Error('RECENT_CANDLE_CONTRACT_INVALID');
      const {mapNaturalCandle}=require('../lib/daytrade-fast-candle-row');
      const rows=recent.candles.map(c=>mapNaturalCandle(c,{tradeDate:date,nowMs:now.getTime(),maxSeenAgeMs:Infinity})).filter(Boolean).map(row=>({...row,source_channel:'candles',candle_origin:'websocket_candle',websocket_row:true,rest_repair_row:false,intraday_odd_lot:false,payload:{...row.payload,cacheUpdatedAt:recent.updatedAt}}));
      const deltaStore=require('../lib/daytrade-candle-delta'),checkpointPath=path.join(RUNTIME,'state','daytrade-fast-candle-delta.json');
      let checkpoint;try{checkpoint=JSON.parse(readText(checkpointPath));}catch{checkpoint=null;}
      const delta=deltaStore.selectDelta(rows,checkpoint,{tradeDate:date,target:URL+'/fugle_daytrade_intraday_1m',nowMs:now.getTime()});
      const plan=require('../lib/daytrade-fast-write-plan.cjs').plan(delta.pending,{nowMs:now.getTime()});
      Object.assign(result,{scope:'quotes_and_recent_candles',candles_processed:true,candle_cache_updated_at:recent.updatedAt,candle_cache_age_ms:now.getTime()-stamp,candle_rows:rows.length,candle_rejected_or_not_due:recent.candles.length-rows.length,candle_selected:plan.rows.length,candle_deferred:plan.deferred,candles_written:0});
      if(APPLY){let acknowledged=delta.checkpoint;result.candles_written=await upsert('fugle_daytrade_intraday_1m',plan.rows,'symbol,candle_time',batch=>{
        const next=deltaStore.acknowledge(acknowledged,batch);fs.mkdirSync(path.dirname(checkpointPath),{recursive:true});const temporary=checkpointPath+'.'+process.pid+'.tmp';fs.writeFileSync(temporary,JSON.stringify(next),'utf8');fs.renameSync(temporary,checkpointPath);acknowledged=next;
      },canPublish,Date.now()+12000);}
    }
    if (APPLY) await publishQuotes(result);
    // Do not overwrite the complete quote+candle sync receipt with a quote-only result.
    return result;
  }
  const candleCache = parseCache("fugle-daytrade-ws-candles-v2.json");
  const { mapNaturalCandle } = require('../lib/daytrade-fast-candle-row');
  // Same-day history can catch up after a write outage. Keep original receive
  // times and require proven natural, closed bars; never mark missing flags true.
  const candles = (candleCache.candles || []).map(c => {
    const row = mapNaturalCandle(c, { tradeDate: date, nowMs: now.getTime(), maxSeenAgeMs: Infinity });
    return row ? { ...row, source_channel: 'candles', candle_origin: 'websocket_candle', websocket_row: true,
      rest_repair_row: false, intraday_odd_lot: false,
      payload: { ...row.payload, cacheUpdatedAt: candleCache.updatedAt } } : null;
  }).filter(Boolean);
  const deltaStore = require('../lib/daytrade-candle-delta');
  const checkpointPath = path.join(RUNTIME, 'state', 'daytrade-fast-candle-delta.json');
  let checkpoint;
  try { checkpoint=JSON.parse(readText(checkpointPath)); } catch { checkpoint=null; }
  const delta = deltaStore.selectDelta(candles, checkpoint, {tradeDate:date,target:URL+'/fugle_daytrade_intraday_1m',nowMs:now.getTime()});
  const writePlan = require('../lib/daytrade-fast-write-plan.cjs').plan(delta.pending,{nowMs:now.getTime()});
  const result = { ok: true, mode: APPLY ? "apply" : "dry_run", trade_date: date, checked_at: now.toISOString(), quote_rows: quotes.length, candle_rows: candles.length, quote_cache_updated_at: quoteCache.updatedAt, candle_cache_updated_at: candleCache.updatedAt };
  result.candle_delta_pending = delta.pending.length;
  result.candle_delta_unchanged = delta.unchanged;
  result.candle_not_due = delta.not_due;
  result.candle_write_mode = writePlan.mode;
  result.candle_selected = writePlan.rows.length;
  result.candle_deferred = writePlan.deferred;
  result.candle_backfill_complete = false;
  if (APPLY) {
    await publishQuotes(result);
    let acknowledged = delta.checkpoint;
    result.candles_written = await upsert("fugle_daytrade_intraday_1m", writePlan.rows, "symbol,candle_time", batch => {
      const next = deltaStore.acknowledge(acknowledged,batch);
      fs.mkdirSync(path.dirname(checkpointPath),{recursive:true});
      const temporary=checkpointPath+'.'+process.pid+'.tmp';
      fs.writeFileSync(temporary,JSON.stringify(next),'utf8');
      fs.renameSync(temporary,checkpointPath);
      acknowledged=next;
    });
    result.candle_backfill_complete = writePlan.deferred === 0;
    const stateFile = path.join(RUNTIME, "state", "daytrade-fast-supabase-sync.json");
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ ...result, completed_at: new Date().toISOString() }, null, 2) + "\n", "utf8");
  }
  console.log(JSON.stringify(result));
  return result;
}

module.exports = { runFastSync: main };
if (require.main === module) main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
