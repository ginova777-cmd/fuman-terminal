'use strict';
const {previousSession}=require('./daytrade-preopen-history-calendar');
const {validateSnapshot}=require('./mother-pool-ma20-producer');
const {finite}=require('./daytrade-fast-candle-row');
function collect({identity,symbols,snapshot,calendar,rawEvidence,asOf}) {
  validateSnapshot(snapshot,identity,symbols,asOf);
  const now=Date.parse(asOf),hm=new Date(now+28800000).toISOString().slice(11,16);
  if(hm<'06:00'||hm>='09:00')throw Error('HISTORICAL_MA20_PREOPEN_ONLY');
  const dataDate=previousSession(calendar,identity.trade_date,asOf);
  const e=rawEvidence;
  if(e?.contract!=='daytrade_preopen_raw_rpc_evidence_v1'||e.observation_trade_date!==identity.trade_date
    ||e.source_rpc!=='get_fugle_daytrade_intraday_1m_latest_n'||!Array.isArray(e.rows)
    ||!Array.isArray(e.requested_symbols)||new Set(e.requested_symbols).size!==e.requested_symbols.length
    ||symbols.some(s=>!e.requested_symbols.includes(s))||!Number.isFinite(Date.parse(e.observed_at))
    ||Date.parse(e.observed_at)>now)throw Error('PREOPEN_RAW_EVIDENCE_REQUIRED');
  const rows=symbols.map(symbol=>{
    const raw=e.rows.filter(r=>r.symbol===symbol&&r.trade_date===dataDate)
      .sort((a,b)=>Date.parse(a.candle_time)-Date.parse(b.candle_time));
    const bars=raw.slice(-20),gaps=[];
    if(bars.length!==20)gaps.push('TWENTY_COMPLETED_BARS_REQUIRED');
    if(new Set(raw.map(r=>r.candle_time)).size!==raw.length)gaps.push('DUPLICATE_MINUTE');
    for(let i=0;i<bars.length;i++) {
      const b=bars[i],t=Date.parse(b.candle_time),seen=Date.parse(b.payload?.sourceCandleSeenAt),
        local=Number.isFinite(t)?new Date(t+28800000).toISOString():'',v=['open','high','low','close'].map(k=>finite(b[k]));
      if(b.source!=='fugle_daytrade_fast_sync:websocket_candles'||b.synthetic!==false||b.volume_strategy_usable!==true
        ||b.payload?.originalSource!=='fugle-ws-candles'||b.payload?.originalChannel!=='candles'
        ||b.payload?.candleOrigin!=='websocket_candle'||b.payload?.is_synthetic===true
        ||!Number.isFinite(t)||t%60000!==0||local.slice(0,10)!==dataDate
        ||local.slice(11,16)<'09:00'||local.slice(11,16)>'13:29'
        ||!Number.isFinite(seen)||seen<t+60000||seen>now||t+60000>now
        ||v.some(x=>x===null||x<=0)||v[1]<Math.max(v[0],v[2],v[3])||v[2]>Math.min(v[0],v[1],v[3])
        ||(i&&t-Date.parse(bars[i-1].candle_time)!==60000))gaps.push('INVALID_NATURAL_HISTORY');
    }
    const latest=bars.at(-1);
    if(!latest||new Date(Date.parse(latest.candle_time)+28800000).toISOString().slice(11,16)!=='13:29')gaps.push('PREVIOUS_SESSION_CLOSE_WINDOW_MISSING');
    const failures=[...new Set(gaps)],ready=failures.length===0;
    return {symbol,mode:'preopen_historical',data_date:dataDate,observation_trade_date:identity.trade_date,
      valid_bar_count:bars.length,natural_bars:bars,ma20:ready?bars.reduce((n,b)=>n+finite(b.close),0)/20:null,
      ready,data_gaps:failures,status:ready?'READY':'DATA_GAP',data_gap_reason:ready?null:failures.join('|'),
      source:'Fugle.persisted.websocket.candles',source_updated_at:latest?.payload?.sourceCandleSeenAt||e.observed_at,
      event_time:asOf,is_synthetic:false,replay:false,look_ahead:false};
  });
  const count=rows.filter(r=>r.ready).length,pct=count/symbols.length*100,missing=rows.filter(r=>!r.ready).map(r=>r.symbol);
  return ['A08','A09'].map(module_id=>({...identity,module_id,created_at:asOf,requested_symbols:[...symbols],
    source_evidence:{snapshot,calendar,rawEvidence:e,mode:'preopen_historical'},
    rows:rows.map(r=>({...r,source_contract:`preopen_${module_id.toLowerCase()}_${module_id==='A08'?'ma20':'ma20_coverage'}_receipt_v1`,
      ...(module_id==='A09'?{ready_count:count,checked_count:symbols.length,coverage_pct:pct,threshold_pct:90,not_ready_symbols:missing,
        status:pct>=90?'READY':'DATA_GAP',data_gap_reason:pct>=90?null:'MA20_COVERAGE_BELOW_90'}:{})}))}));
}
function verify(moduleId,rows,r) {try{
  const p=r.writer_write_set.plan,e=p.source_evidence;
  const expected=collect({identity:r,symbols:p.requested_symbols,snapshot:e.snapshot,calendar:e.calendar,rawEvidence:e.rawEvidence,asOf:r.observed_at}).find(x=>x.module_id===moduleId);
  if(!expected||rows.length!==expected.rows.length||new Set(rows.map(x=>x.symbol)).size!==rows.length)return false;
  return expected.rows.every(w=>{
    const row=rows.find(x=>x.symbol===w.symbol);
    return w.status==='READY'&&row&&Object.keys(w).every(k=>JSON.stringify(w[k])===JSON.stringify(row[k]));
  });
}catch{return false;}}
module.exports={collect,verify};
