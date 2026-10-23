"use strict";

const fs = require("fs");
const path = require("path");
const { isTwseTradingDay } = require("./twse-trading-day");

const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const CACHE = path.join(RUNTIME, "cache", "intraday");
const URL = String(process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const APPLY = process.argv.includes("--apply");

function readText(file) { try { return require('../lib/supply-round-context.cjs').text(file,()=>fs.readFileSync(file,"utf8")); } catch { return ""; } }
function secret(name) { return String(process.env[name] || readText(path.join(RUNTIME, "secrets", name.toLowerCase().replace(/_/g, "-") + ".txt"))).trim(); }
function parseCache(name, context = null) {
  if(context?.fixedSource && context.cache)return context.cache;
  for (const file of [path.join(CACHE, name), path.join(CACHE, name + ".bak")]) {
    try {
      const raw=readText(file),sha=require('node:crypto').createHash('sha256').update(raw).digest('hex');
      if(context && context.cacheSha===sha && context.cacheFile===file)return context.cache;
      const value=require('../lib/supply-round-context.cjs').parse(file,raw);
      if(context){context.cacheSha=sha;context.cacheFile=file;context.cache=value;context.mapped=null;}
      if(context?.fixedSource)context.boundSource=require('../lib/daytrade-candle-bound-source.cjs').capture(RUNTIME,raw,Date.now());
      return value;
    } catch { /* retry stable backup */ }
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
async function upsert(table, rows, conflict, onBatch = () => {}, control = null) {
  if (table === 'fugle_daytrade_quotes_live') rows = rows.map(require('../lib/daytrade-quote-liquidity-contract').normalizeQuoteLiquidity);
  if (!rows.length) return 0;
  const key = secret("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("service_role_key_missing");
  let written = 0;
  for (let offset = 0; offset < rows.length; offset += 200) {
    if(control && (Date.now()>=control.deadline || !control.canWrite())) throw Error('QUOTE_CHECKPOINT_WRITE_GUARD');
    const response = await require('../lib/writer-operation-trace.cjs').request(`${URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows.slice(offset, offset + 200)),
      signal: AbortSignal.timeout(control ? Math.max(1, Math.min(30000, control.deadline-Date.now())) : 30000),
    },{step:table === 'fugle_daytrade_quotes_live'?'live_quote_write':'stock_candle_write',deadline:control?.deadline||Date.now()+30000,symbolCount:new Set(rows.slice(offset,offset+200).map(r=>r.symbol)).size,fetchImpl:fetch});
    if (!response.ok) throw new Error(`${table}_HTTP_${response.status}:${(await response.text()).slice(0, 240)}`);
    written += Math.min(200, rows.length - offset);
    await onBatch(rows.slice(offset, offset + 200));
    if(control?.progress)await control.progress();
  }
  return written;
}

function mapCandleCache(candleCache,date,nowMs) {
  const { mapNaturalCandle } = require('../lib/daytrade-fast-candle-row');
  // Same-day history can catch up after a write outage. Keep original receive
  // times and require proven natural, closed bars; never mark missing flags true.
  return (candleCache.candles || []).map(c => {
    const row = mapNaturalCandle(c, { tradeDate: date, nowMs: nowMs, maxSeenAgeMs: Infinity });
    return row ? { ...row, source_channel: 'candles', candle_origin: 'websocket_candle', websocket_row: true,
      rest_repair_row: false, intraday_odd_lot: false,
      payload: { ...row.payload, cacheUpdatedAt: candleCache.updatedAt } } : null;
  }).filter(Boolean);
}

async function quoteWrite(rows,control) {
 if(!require('../lib/supply-round-context.cjs').active())return {written:await upsert('fugle_daytrade_quotes_live',rows,'symbol',()=>{},control),reused:0};
 return require('../lib/supply-round-context.cjs').write({sink:URL+'/rest/v1/fugle_daytrade_quotes_live',rows:rows.map(require('../lib/daytrade-quote-liquidity-contract').normalizeQuoteLiquidity),
 guard:()=>Number.isFinite(control?.deadline)&&Date.now()<control.deadline&&control.canWrite(),
 send:batch=>upsert('fugle_daytrade_quotes_live',batch,'symbol',()=>{},control)});
}
async function main(options = {}) {
  require('../lib/supply-round-context.cjs').refresh();
  const now = new Date();
  const date = tradeDate(now);
  if(options.quoteOnly === true && (!options.calendar || options.calendar.trade_date !== date || typeof options.calendar.isTradingDay !== 'boolean')) throw Error('QUOTE_CHECKPOINT_CALENDAR_REQUIRED');
  const calendar = options.quoteOnly === true ? options.calendar : await isTwseTradingDay(now, { stateDir: path.join(RUNTIME, "state") });
  if (!calendar.isTradingDay) return console.log(JSON.stringify({ ok: true, skipped: true, reason: "market_calendar_non_trading_day", trade_date: date }));
  const quoteCache = parseCache("fugle-daytrade-ws-quotes-v2.json");
  const candleCache = options.quoteOnly === true ? null : parseCache("fugle-daytrade-ws-candles-v2.json",options.drainContext);
  // A closed 5-minute candle is verified shortly after its boundary. Keep
  // enough Fugle candle events to include all five source minutes plus normal
  // collector/writer delay; three minutes systematically dropped slots 1-2.
  const cutoff = Date.now() - 15 * 60 * 1000;
  const quotes = (quoteCache.quotes || []).filter((q) => Date.parse(q.quoteSeenAt || q.exchangeTime || q.receivedAt) >= cutoff).map((q) => {
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
  if(options.quoteOnly === true) {
    if(options.apply !== true) return {ok:true,mode:'dry_run',quote_only:true,trade_date:date,quotes_written:0};
    if(!Number.isFinite(options.deadline) || typeof options.canWrite!=='function') throw Error('QUOTE_CHECKPOINT_CONTROL_REQUIRED');
    const ack=await quoteWrite(quotes,options); const quotes_written=ack.written;
    return {ok:true,mode:'apply',quote_only:true,trade_date:date,quotes_written,quotes_reused:ack.reused,quotes_acknowledged:ack.acknowledged,quote_confirmation_scope:ack.confirmation_scope,quote_cache_updated_at:quoteCache.updatedAt};
  }
  const deadline = Number(options.deadline) || Number(process.env.FUMAN_DAYTRADE_WRITER_DEADLINE_MS) || Date.now()+300000;
  const writeControl = {deadline,canWrite:()=>Date.now()<deadline&&(!options.canWrite||options.canWrite()),progress:options.progress};
  const context = options.drainContext;
  const candles = context?.mapped && context.mappedDate===date && (context.fixedSource || now.getTime()<context.nextEligibility)
    ? context.mapped : mapCandleCache(candleCache,date,context?.boundSource?Date.parse(context.boundSource.as_of):now.getTime());
  if(context && context.mapped!==candles){
    context.mapped=candles;context.mappedDate=date;context.nextEligibility=Infinity;
    for(const c of candleCache.candles||[])for(const t of [Date.parse(c.candleTime||c.date)+60000,Date.parse(c.candleSeenAt)])if(t>now.getTime())context.nextEligibility=Math.min(context.nextEligibility,t);
  }
  const deltaStore = require('../lib/daytrade-candle-delta');
  return require('../lib/daytrade-history-write-guard.cjs').withSnapshot(RUNTIME,candles,deltaStore.fingerprint,async historyGuard=>{
  const guardedProgress=async()=>{if(options.progress)await options.progress();historyGuard.assertCurrent();};
  const originalCanWrite=writeControl.canWrite;
  writeControl.canWrite=()=>{historyGuard.assertCurrent();return originalCanWrite();};
  writeControl.progress=guardedProgress;
  const checkpointPath = path.join(RUNTIME, 'state', 'daytrade-fast-candle-delta.json');
  const bytesHash = raw => require('node:crypto').createHash('sha256').update(raw).digest('hex');
  const cacheHash=context?.cacheSha || bytesHash(JSON.stringify(candleCache));
  const snapshotFile=path.join(RUNTIME,'state/daytrade-mother-pool-snapshot-latest.json');
  const boundSnapshotRaw=readText(snapshotFile);
  const sourceHash = bytesHash(JSON.stringify({date,target:URL,round:process.env.FUMAN_CANDLE_SYNC_RUN_ID||null,cacheHash,count:candles.length,snapshotHash:bytesHash(boundSnapshotRaw)}));
  const checkpointRaw=readText(checkpointPath);
  const checkpointHash = bytesHash(checkpointRaw);
  const reused = Boolean(context && context.sourceHash === sourceHash && context.checkpointHash === checkpointHash);
  let checkpoint;
  if(reused&&context.checkpoint)checkpoint=context.checkpoint;
  else try { checkpoint=JSON.parse(checkpointRaw); } catch { checkpoint=null; }
  if(APPLY && !reused){
    const store=require('../lib/mother-pool-receipt-current.cjs');
    store.atomicJson(path.join(RUNTIME,'state/daytrade-fast-supabase-sync.json'),{ok:false,status:'FINAL_CONTENT_CHECK_IN_PROGRESS'});

    const matches=await require('../lib/daytrade-candle-content-readback.cjs').readback({rows:candles,url:URL+'/rest/v1/fugle_daytrade_intraday_1m',headers:{apikey:secret('SUPABASE_SERVICE_ROLE_KEY'),Authorization:'Bearer '+secret('SUPABASE_SERVICE_ROLE_KEY')},deadline,progress:guardedProgress});
    if(checkpoint?.hashes)for(const row of candles){const k=row.symbol+'|'+row.candle_time;if(!matches.has(k)){delete checkpoint.hashes[k];if(checkpoint.save_evidence)delete checkpoint.save_evidence[k];}}
  }
  const delta = reused && context.pending
    ? {pending:context.pending,unchanged:candles.length-context.pending.length,not_due:0,checkpoint:{contract:deltaStore.CONTRACT,trade_date:date,target:URL+'/fugle_daytrade_intraday_1m',hashes:{...checkpoint.hashes}}}
    : deltaStore.selectDelta(candles, checkpoint, {tradeDate:date,target:URL+'/fugle_daytrade_intraday_1m',nowMs:now.getTime()});
  const writePlan = require('../lib/daytrade-fast-write-plan.cjs').plan(delta.pending,{nowMs:now.getTime(),bounded:options.boundedHistory===true});
  const result = { ok: true, mode: APPLY ? "apply" : "dry_run", trade_date: date, checked_at: now.toISOString(), quote_rows: quotes.length, candle_rows: candles.length, quote_cache_updated_at: quoteCache.updatedAt, candle_cache_updated_at: candleCache.updatedAt };
  if(context?.boundSource)result.candle_source_snapshot=context.boundSource;
  result.candle_delta_pending = delta.pending.length;
  result.candle_delta_unchanged = delta.unchanged;
  result.candle_not_due = delta.not_due;
  result.candle_write_mode = writePlan.mode;
  result.candle_selected = writePlan.rows.length;
  result.candle_deferred = writePlan.deferred;
  result.candle_backfill_complete = false;
  result.drain_initial_readback_reused = reused;
  if (APPLY) {
    const proofStore=require('../lib/mother-pool-receipt-current.cjs');
    const syncId=require('node:crypto').randomUUID(),roundId=process.env.FUMAN_CANDLE_SYNC_RUN_ID || syncId;
    const target=URL+'/fugle_daytrade_intraday_1m';
    const evidence=checkpoint?.trade_date===date && checkpoint?.target===target ? {...checkpoint.save_evidence} : {};
    result.sync_id=syncId;result.wrapper_run_id=roundId;
    const stateFile=path.join(RUNTIME,'state','daytrade-fast-supabase-sync.json');
    proofStore.atomicJson(stateFile,{...result,ok:false,status:'IN_PROGRESS'});
    const quoteAck=await quoteWrite(quotes,writeControl);
    result.quotes_written=quoteAck.written;result.quotes_reused=quoteAck.reused;result.quotes_acknowledged=quoteAck.acknowledged;result.quote_confirmation_scope=quoteAck.confirmation_scope;
    let acknowledged = delta.checkpoint;
    const checkpointJson=require('../lib/daytrade-checkpoint-json.cjs').create(acknowledged,evidence);
    require('../lib/daytrade-candle-write-intent.cjs').beforeWrite({runtime:RUNTIME,rows:writePlan.rows,writer:'fast-sync'});
    result.candles_written = await upsert("fugle_daytrade_intraday_1m", writePlan.rows, "symbol,candle_time", batch => {
      // This map is owned by this invocation. Avoid cloning all prior hashes
      // for every 200-row ACK; durable replacement still occurs for every batch.
      // Any persistence failure propagates before context/Proof publication.
      const next = acknowledged;
      for(const row of batch)next.hashes[row.symbol+'|'+row.candle_time]=deltaStore.fingerprint(row);
      // Only a successful HTTP ACK may create this provenance; legacy hashes alone do not.
      for(const row of batch) evidence[row.symbol+'|'+row.candle_time]={hash:deltaStore.fingerprint(row),trade_date:date,target,
        sync_id:syncId,wrapper_run_id:roundId,acknowledged_at:new Date().toISOString(),status:'HTTP_ACKNOWLEDGED'};
      next.save_evidence=evidence;
      fs.mkdirSync(path.dirname(checkpointPath),{recursive:true});
      const temporary=checkpointPath+'.'+process.pid+'.tmp';
      fs.writeFileSync(temporary,checkpointJson(batch.map(row=>row.symbol+'|'+row.candle_time)),'utf8');
      fs.renameSync(temporary,checkpointPath);
      acknowledged=next;
    },writeControl);
    result.candle_backfill_complete = writePlan.deferred === 0;
    const committedKeys=new Set();
    for(const row of writePlan.rows){const k=row.symbol+'|'+row.candle_time;if(acknowledged.hashes[k]!==deltaStore.fingerprint(row))throw Error('CANDLE_ACK_INCOMPLETE');committedKeys.add(k);}
    const remaining={pending:delta.pending.filter(row=>!committedKeys.has(row.symbol+'|'+row.candle_time))};
    result.candle_pending_after=remaining.pending.length;
    // Deferred batches cannot publish a verified Proof. Read the complete fixed
    // source once all real ACKs are durable, rather than after every partial pass.
    const finalMatches=remaining.pending.length===0&&writePlan.deferred===0
      ? await require('../lib/daytrade-candle-content-readback.cjs').readback({rows:candles,url:URL+'/rest/v1/fugle_daytrade_intraday_1m',headers:{apikey:secret('SUPABASE_SERVICE_ROLE_KEY'),Authorization:'Bearer '+secret('SUPABASE_SERVICE_ROLE_KEY')},deadline,progress:guardedProgress})
      : new Map();
    if (context) {
      context.sourceHash = sourceHash;
      context.checkpointHash = bytesHash(readText(checkpointPath));
      context.checkpoint = {...acknowledged,save_evidence:evidence};
      context.pending = remaining.pending;
    }
    if(remaining.pending.length===0&&writePlan.deferred===0&&finalMatches.size!==candles.length)throw Error('CANDLE_FINAL_CONTENT_MISMATCH');
    if(context && remaining.pending.length===0 && bytesHash(context.boundSource?require('../lib/daytrade-candle-bound-source.cjs').read(RUNTIME,context.boundSource):readText(context.cacheFile))!==context.cacheSha)throw Error('CANDLE_SOURCE_CHANGED_DURING_FINAL_READBACK');
    if(remaining.pending.length===0 && readText(snapshotFile)!==boundSnapshotRaw)throw Error('CANDLE_SNAPSHOT_CHANGED_DURING_FINAL_READBACK');
    result.final_content_readback_verified=remaining.pending.length===0&&writePlan.deferred===0&&finalMatches.size===candles.length;
    let snapshotRaw='';try{snapshotRaw=fs.readFileSync(path.join(RUNTIME,'state','daytrade-mother-pool-snapshot-latest.json'),'utf8')}catch{}
    const proof=proofStore.makeCandleProof({rows:candles,evidence,tradeDate:date,target,snapshotRaw,roundId,syncId,
      pending:remaining.pending.length,deferred:writePlan.deferred,now:Date.now()});
    const proofRaw=JSON.stringify(proof);const hash=proofStore.hashBytes(proofRaw);
    const proofFile=path.join(RUNTIME,'state','candle-save-proofs',hash+'.json');
    proofStore.atomicJson(proofFile,proof);
    result.candle_save_proof={sha256:hash,status:proof.status,reason:proof.reason};
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    proofStore.atomicJson(stateFile,{ ...result, completed_at: new Date().toISOString() });
  }
  historyGuard.assertCurrent();
  console.log(JSON.stringify(result));
  return result;
  });
}


async function runLatestCandleSync(control) {
  require('../lib/supply-round-context.cjs').refresh();
  const now=Date.now(),date=tradeDate();
  if(control.apply!==true)return {status:'SKIPPED_READ_ONLY',complete:false};
  if(!Number.isFinite(control.deadline)||control.deadline<=now||typeof control.canWrite!=='function'||!control.canWrite())throw Error('LATEST_CANDLE_WRITE_GUARD');
  const snapshot=JSON.parse(fs.readFileSync(path.join(RUNTIME,'state/daytrade-mother-pool-snapshot-latest.json'),'utf8'));
  if(snapshot.complete!==true||!Array.isArray(snapshot.symbols)||!snapshot.run_id)throw Error('LATEST_CANDLE_SNAPSHOT_REQUIRED');
  if(snapshot.trade_date!==date){
    if(/^\d{4}-\d{2}-\d{2}$/.test(snapshot.trade_date)&&snapshot.trade_date<date)return {status:'WAITING_CURRENT_MOTHER_POOL_SNAPSHOT',complete:false,snapshot_trade_date:snapshot.trade_date,trade_date:date,written:0};
    throw Error('LATEST_CANDLE_SNAPSHOT_REQUIRED');
  }
  const wanted=new Set(snapshot.symbols),latest=new Map(),cache=parseCache('fugle-daytrade-ws-candles-v2.json');
  for(const raw of cache.candles||[]){if(!wanted.has(String(raw.symbol||raw.code||'')))continue;for(const row of mapCandleCache({updatedAt:cache.updatedAt,candles:[raw]},date,now)){if(!latest.has(row.symbol)||row.candle_time>latest.get(row.symbol).candle_time)latest.set(row.symbol,row);}}
  const minimum=control.minimumClosedMinute?Date.parse(control.minimumClosedMinute):-Infinity;
  if(Number.isNaN(minimum))throw Error('LATEST_CANDLE_FRONTIER_INVALID');
  const rows=[...latest.values()].filter(r=>Date.parse(r.candle_time)>=minimum);
  if(!rows.length)return {status:'WAITING_NATURAL_CANDLES',complete:false,missing_symbols:[...wanted].filter(symbol=>!latest.has(symbol)),no_new_completed_minute_symbols:[...wanted].filter(symbol=>latest.has(symbol))};
  require('../lib/daytrade-history-write-guard.cjs').beforeLiveWrite(RUNTIME,rows);
  const writeStartedAt=new Date().toISOString();
  require('../lib/daytrade-candle-write-intent.cjs').beforeWrite({runtime:RUNTIME,rows,writer:'writer'});
  const written=await upsert('fugle_daytrade_intraday_1m',rows,'symbol,candle_time',()=>{},control);
  const writeAcknowledgedAt=new Date().toISOString(),readbackStartedAt=new Date().toISOString(),publication=new Map();
  const key=secret('SUPABASE_SERVICE_ROLE_KEY');
  const matches=await require('../lib/daytrade-candle-content-readback.cjs').readback({rows,url:URL+'/rest/v1/fugle_daytrade_intraday_1m',headers:{apikey:key,Authorization:'Bearer '+key},deadline:control.deadline,onRows:(actual,at)=>{for(const row of actual)publication.set(row.symbol+'|'+new Date(row.candle_time).toISOString(),{db_written_at:row.payload?.db_written_at||null,version_first_written_at:row.payload?.version_first_written_at||null,readback_completed_at:at});}});
  if(written!==rows.length||matches.size!==rows.length)throw Error('LATEST_CANDLE_READBACK_MISMATCH');
  const latestTime=rows.map(r=>r.candle_time).sort().at(-1);
  return {status:'LATEST_ROWS_READBACK_VERIFIED',scope:control.minimumClosedMinute?'new_natural_completed_frontier_per_snapshot_symbol':'latest_natural_closed_minute_per_snapshot_symbol',mother_pool_run_id:snapshot.run_id,requested_symbols:wanted.size,written,no_new_completed_minute_symbols:[...wanted].filter(symbol=>latest.has(symbol)&&Date.parse(latest.get(symbol).candle_time)<minimum),latest_closed_candle_time:latestTime,readback_completed_at:new Date().toISOString(),timings:rows.map(r=>({symbol:r.symbol,candle_time:r.candle_time,bar_end_at:new Date(Date.parse(r.candle_time)+60000).toISOString(),source_received_at:r.payload.sourceCandleSeenAt,writer_selected_at:new Date(now).toISOString(),write_started_at:writeStartedAt,write_acknowledged_at:writeAcknowledgedAt,readback_started_at:readbackStartedAt,...publication.get(r.symbol+'|'+r.candle_time)})),missing_symbols:[...wanted].filter(symbol=>!latest.has(symbol)),complete:false};
}

module.exports = { runLatestCandleSync, mapCandleCache, runFastSync: main, runQuoteSync: control => main({...control,quoteOnly:true}) };
async function runCli() {
  if (!process.argv.includes('--quote-only')) return main();
  // The minute wrapper publishes fresh native quote fields before the main Writer.
  // Full candle backlog drain remains a separate explicit mode; never run it in
  // front of the same round's primary candle/status publication budget.
  const now = new Date();
  const calendar = await isTwseTradingDay(now, { stateDir: path.join(RUNTIME, 'state') });
  const deadline = Date.now() + 15000;
  return main({quoteOnly:true,apply:APPLY,calendar:{trade_date:tradeDate(now),isTradingDay:calendar.isTradingDay},
    deadline,canWrite:()=>Date.now()<deadline});
}
if (require.main === module) runCli().catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });

