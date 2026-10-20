'use strict';
// Only real acknowledged writes can refresh the fast-sync receipt. Exceptions
// propagate to the existing Writer failure/backoff path; there is no retry here.
async function refreshRound({ apply, dryRun, tradeDate, run, calendar, refreshLive, observedAt = new Date(), historyControl = null }) {
  if (!apply || dryRun) return { status: 'SKIPPED_READ_ONLY' };
  const deadline = Number(process.env.FUMAN_DAYTRADE_WRITER_DEADLINE_MS) || Date.now() + 300000;
  // Owned by this invocation only. Durable ACK state remains on disk; restarting
  // the Writer creates a fresh context and independently checks saved content.
  const drainContext = {fixedSource:true};
  let lastLive=0;
  const nextBatch = async () => { if (Date.now() >= deadline) throw Error("FINAL_CANDLE_DRAIN_DEADLINE"); if(refreshLive && Date.now()-lastLive>=45000){await refreshLive();lastLive=Date.now();} return run({deadline, drainContext}); };
  let result;
  const pendingResult = (reason, extra={}) => ({status:'BACKFILL_PENDING',reason,trade_date:tradeDate,complete:false,publication_acknowledged:false,formal_entry_allowed:false,...extra});
  const liveCheck = async () => {
    const live=await refreshLive();
    if(live?.quotes_acknowledged!==true || live?.stock_candles_verified!==true)throw Error('BACKFILL_LIVE_HEALTH_NOT_ACKNOWLEDGED');
    return live;
  };
  if(historyControl?.cooldown===true)return pendingResult('HISTORY_COOLDOWN',{live_refresh:await liveCheck()});
  try { result = await nextBatch(); }
  catch(error){
    if(error.code==='CANDLE_HISTORY_SOURCE_SUPERSEDED'){
      if(!refreshLive)throw error;
      return pendingResult('HISTORY_SOURCE_SUPERSEDED',{live_refresh:await liveCheck()});
    }
    // A single slow history operation is not proof of a database outage. One
    // bounded live check must succeed before isolating it; failed live checks
    // propagate to the unchanged global database backoff. No retry of history.
    if(!historyControl || !refreshLive || !['TimeoutError','AbortError'].includes(error.name) || !String(error.writerOperation?.step||'').includes('content_readback'))throw error;
    return pendingResult('HISTORY_READBACK_TIMEOUT',{operation:error.writerOperation,live_refresh:await liveCheck()});
  }
  // No natural preopen quotes is a pending condition, never a publication ACK.
  // Require the current trading calendar and local session, not a caller flag.
  const localDate = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(observedAt));
  if (calendar?.trade_date === tradeDate && calendar.is_open === true && calendar.session === 'preopen'
    && localDate === tradeDate && require('./daytrade-module-session.cjs').session(observedAt) === 'PREOPEN'
    && result?.ok === true && result.mode === 'apply' && result.trade_date === tradeDate
    && result.quote_rows === 0 && result.quotes_written === 0
    && result.candle_rows === 0 && result.candles_written === 0 && result.candle_pending_after === 0) {
    return {status:'NATURAL_PENDING',reason:'PREOPEN_NO_NATURAL_QUOTES',trade_date:tradeDate,
      complete:false,publication_acknowledged:false,formal_entry_allowed:false,source_result:result};
  }
  // Drain distinct deferred batches, never retry a failed request. The Writer
  // process retains its existing outer deadline. Require strict progress.
  let pending = Number(result?.candle_pending_after);
  if(historyControl && pending>0){
    if(result?.ok!==true||result.mode!=='apply'||result.trade_date!==tradeDate||!Number.isInteger(pending)||!Number.isInteger(result.candles_written)||result.candles_written<0)throw Error('FINAL_WATER_REFRESH_NOT_ACKNOWLEDGED');
    return pendingResult('BOUNDED_HISTORY_BATCH',{pending,source_result:result,live_refresh:await liveCheck()});
  }
  const maximumPasses = Math.max(1, Number(result?.candle_rows) || 1);
  for (let pass = 1; pending > 0 && pass < maximumPasses; pass++) {
    if (result?.ok !== true) throw Error('FINAL_WATER_REFRESH_NOT_ACKNOWLEDGED');
    try{result = await nextBatch();}
    catch(error){
      if(error.code!=='CANDLE_HISTORY_SOURCE_SUPERSEDED'||!refreshLive)throw error;
      return pendingResult('HISTORY_SOURCE_SUPERSEDED',{live_refresh:await liveCheck()});
    }
    const next = Number(result?.candle_pending_after);
    if (!Number.isInteger(next) || next < 0 || next >= pending) throw Error('FINAL_CANDLE_DRAIN_NO_PROGRESS');
    pending = next;
  }
  if (!result || result.ok !== true || result.mode !== 'apply' || result.trade_date !== tradeDate
    || !Number.isInteger(result.quotes_written) || result.quotes_written < 1
    || !Number.isInteger(result.candles_written) || result.candles_written < 0
    || result.candle_pending_after !== 0 || result.final_content_readback_verified !== true) {
    throw Error('FINAL_WATER_REFRESH_NOT_ACKNOWLEDGED');
  }
  return { status: 'WRITTEN_PENDING_VERIFICATION', trade_date: result.trade_date,
    quotes_written: result.quotes_written, candles_written: result.candles_written,
    candle_deferred: result.candle_deferred, complete: false };
}
async function refresh(options){
  const runtime=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime';
  return require('./daytrade-history-write-guard.cjs').withScope(runtime,()=>refreshRound(options));
}
module.exports = { refresh };
