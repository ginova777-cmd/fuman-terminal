'use strict';
const {adapt}=require('./mother-pool-historical-minute-adapter');
const crypto=require('node:crypto');
const {readMinuteSide}=require('./mother-pool-minute-side-source');
const CONTRACT='mother_pool_a16_same_minute_baseline_v1';
const TYPES=['VOLUME','ABS_RETURN','OUTSIDE_STRENGTH','INSIDE_STRENGTH'];
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const median=xs=>{const a=xs.slice().sort((a,b)=>a-b),n=a.length;return n?n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2:null;};
const local=t=>new Date(Date.parse(t)+28800000).toISOString();
function build({symbol,tradeDate,canonicalRunId,asOf,history,sideJournals={}}) {
 if(!/^\d{4}$/.test(symbol)||canonicalRunId!==`fugle_daytrade_source:${tradeDate.replaceAll('-','')}:canonical`||!Number.isFinite(Date.parse(asOf)))throw Error('A16_IDENTITY_INVALID');
 let candles=[],sessions=[],provenance=null,error=null;
 try {
  if(history?.contract!=='mother_pool_historical_minute_fetch_evidence_v1'||history.symbol!==symbol||history.trade_date!==tradeDate||history.calendar_verified!==true||history.result?.status!=='HISTORY_FETCHED'||history.requested_sessions?.length!==20||!history.calendar||!Number.isFinite(Date.parse(history.calendar.checked_at))||Date.parse(history.calendar.checked_at)>Date.parse(asOf)||!/^[a-f0-9]{64}$/.test(history.calendar.sha256||''))throw Error('HISTORICAL_ARTIFACT_INVALID');
  if(digest(history.result.raw)!==history.result.normalized?.raw_sha256)throw Error('HISTORICAL_RAW_HASH_MISMATCH');
  const normalized=adapt({response:history.result.raw,symbol,tradeDate,sessionDates:history.requested_sessions,fetchedAt:history.result.fetched_at,asOf});
  candles=normalized.rows;sessions=normalized.session_dates;
  provenance={source:'Fugle.historical.candles.1',raw_sha256:normalized.raw_sha256,calendar_sha256:history.calendar.sha256,fetched_at:normalized.fetched_at};
 }catch(e){error=e.message;}
 const sideRows=[],side_provenance=[];
 for(const date of sessions) {
  const j=sideJournals[date];if(!j)continue;
  const end=new Date(Math.min(Date.parse(`${date}T23:59:59+08:00`),Date.parse(asOf))).toISOString();
  const result=readMinuteSide({symbol,tradeDate:date,canonicalRunId:`fugle_daytrade_source:${date.replaceAll('-','')}:canonical`,asOf:end,trades:j.trades,side:j.side});
  sideRows.push(...result.rows);
  side_provenance.push({trade_date:date,journal_sha256:digest(j),status:result.status,valid_minutes:result.rows.length,data_gap_count:result.data_gaps.length,data_gap_reasons:[...new Set(result.data_gaps.map(g=>g.reason))]});
 }
 const byTime=new Map(candles.map(r=>[Date.parse(r.timestamp),r])),rows=[];
 for(let n=540;n<=810;n++) {
  const minute=String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
  const matching=candles.filter(r=>local(r.timestamp).slice(11,16)===minute);
  for(const baseline_type of TYPES) {
   const samples=[];
   for(const r of matching) {
    if(baseline_type==='VOLUME')samples.push({trade_date:r.trade_date,value:r.volume_raw*1000});
    if(baseline_type==='ABS_RETURN'&&minute!=='09:00') {
     const prev=byTime.get(Date.parse(r.timestamp)-60000);
     if(prev?.trade_date===r.trade_date)samples.push({trade_date:r.trade_date,value:Math.abs((r.close-prev.close)/prev.close*100)});
    }
   }
   for(const r of sideRows.filter(r=>local(r.timestamp).slice(11,16)===minute)) {
    if(baseline_type==='OUTSIDE_STRENGTH'&&r.inside_1m>0)samples.push({trade_date:r.trade_date,value:r.outside_1m/r.inside_1m});
    if(baseline_type==='INSIDE_STRENGTH'&&r.outside_1m>0)samples.push({trade_date:r.trade_date,value:r.inside_1m/r.outside_1m});
   }
   // OHLCV never substitutes for provider-classified native side journals.
   const side=baseline_type.endsWith('STRENGTH'),opening=baseline_type==='ABS_RETURN'&&minute==='09:00';
   const value=median(samples.map(s=>s.value));
   const status=opening?'NOT_APPLICABLE':error?'DATA_GAP':samples.length<10?'INSUFFICIENT_SAMPLE':value<=0?'BASELINE_ZERO':'READY';
   const reason=opening?'OPEN_GAP_ONLY':error|| (samples.length<10?(side?'INSUFFICIENT_NATIVE_SIDE_SAMPLE':'INSUFFICIENT_SAMPLE'):value<=0?'BASELINE_ZERO':null);
   rows.push({symbol,trade_date:tradeDate,canonical_run_id:canonicalRunId,minute,baseline_type,baseline_value:value,sample_count:samples.length,source_trade_dates:samples.map(s=>s.trade_date),samples,unit:baseline_type==='VOLUME'?'SHARES':baseline_type==='ABS_RETURN'?'PERCENT_POINTS':'RATIO',status,reason,data_gap:!['READY','NOT_APPLICABLE'].includes(status),is_synthetic:false});
  }
 }
 const failed_checks=[...new Set(rows.filter(r=>r.data_gap).map(r=>`${r.baseline_type}:${r.reason}`))];
 return {contract:CONTRACT,symbol,trade_date:tradeDate,canonical_run_id:canonicalRunId,calculated_at:asOf,scope:'A16_SAME_MINUTE_BASELINES',lookback_trading_days:20,minimum_samples:10,session_dates:sessions,provenance,side_provenance,rows,requested_count:rows.length,ready_count:rows.filter(r=>r.status==='READY').length,data_gap_count:rows.filter(r=>r.data_gap).length,failed_checks,first_blocker:failed_checks[0]||null,status:failed_checks.length?'blocked':'complete',complete:failed_checks.length===0,formal_candidate_allowed:false,publish_allowed:false};
}
module.exports={build,CONTRACT,TYPES};
