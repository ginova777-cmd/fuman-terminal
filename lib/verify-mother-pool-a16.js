'use strict';
const crypto=require('node:crypto');
const {adapt}=require('./mother-pool-historical-minute-adapter');
const {readMinuteSide}=require('./mother-pool-minute-side-source');
// Independent arithmetic/readback check; never calls the A16 runner.
function verify(receipt,{history,sideJournals={},symbol,tradeDate,canonicalRunId,asOf}) {
 const failed=[];const check=(ok,reason)=>{if(!ok)failed.push(reason);};
 check(receipt?.contract==='mother_pool_a16_same_minute_baseline_v1','CONTRACT');
 check(receipt?.symbol===symbol&&receipt?.trade_date===tradeDate&&receipt?.canonical_run_id===canonicalRunId,'IDENTITY');
 check(receipt?.formal_candidate_allowed===false&&receipt?.publish_allowed===false,'NO_PUBLICATION');
 check(receipt?.lookback_trading_days===20&&receipt?.minimum_samples===10,'SAMPLE_POLICY');
 let candles=[],sessions=[],sideRows=[];
 try {
  if(history?.symbol!==symbol||history.trade_date!==tradeDate||history.calendar_verified!==true||history.requested_sessions?.length!==20)throw Error();
  const hash=crypto.createHash('sha256').update(JSON.stringify(history.result.raw)).digest('hex');
  if(hash!==history.result.normalized.raw_sha256)throw Error();
  const a=adapt({response:history.result.raw,symbol,tradeDate,sessionDates:history.requested_sessions,fetchedAt:history.result.fetched_at,asOf});candles=a.rows;sessions=a.session_dates;
  check(receipt.provenance?.raw_sha256===hash,'RAW_HASH');
 }catch {failed.push('SOURCE_HISTORY_INVALID');}
 for(const date of sessions) {
  const j=sideJournals[date];if(!j)continue;
  const end=new Date(Math.min(Date.parse(date+'T23:59:59+08:00'),Date.parse(asOf))).toISOString();
  sideRows.push(...readMinuteSide({symbol,tradeDate:date,canonicalRunId:`fugle_daytrade_source:${date.replaceAll('-','')}:canonical`,asOf:end,trades:j.trades,side:j.side}).rows);
 }
 const expected=new Map(),minute=t=>new Date(Date.parse(t)+28800000).toISOString().slice(11,16);
 const add=(m,type,date,value)=>{const key=m+'/'+type;if(!expected.has(key))expected.set(key,[]);expected.get(key).push({trade_date:date,value});};
 const timeMap=new Map(candles.map(r=>[Date.parse(r.timestamp),r]));
 for(const r of candles){const m=minute(r.timestamp);add(m,'VOLUME',r.trade_date,1000*r.volume_raw);const p=timeMap.get(Date.parse(r.timestamp)-60000);if(m!=='09:00'&&p?.trade_date===r.trade_date)add(m,'ABS_RETURN',r.trade_date,100*Math.abs(r.close-p.close)/p.close);}
 for(const r of sideRows){const m=minute(r.timestamp);if(r.inside_1m>0)add(m,'OUTSIDE_STRENGTH',r.trade_date,r.outside_1m/r.inside_1m);if(r.outside_1m>0)add(m,'INSIDE_STRENGTH',r.trade_date,r.inside_1m/r.outside_1m);}
 const rows=receipt?.rows||[],seen=new Set(),allowed=new Set();
 for(let n=540;n<=810;n++)for(const t of ['VOLUME','ABS_RETURN','OUTSIDE_STRENGTH','INSIDE_STRENGTH'])allowed.add(String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')+'/'+t);
 check(rows.length===1084,'ROW_COUNT');
 for(const r of rows){const key=r.minute+'/'+r.baseline_type,values=(expected.get(key)||[]).sort((a,b)=>a.trade_date.localeCompare(b.trade_date)),nums=values.map(x=>x.value).sort((a,b)=>a-b),n=nums.length;const mid=n?(nums[Math.floor((n-1)/2)]+nums[Math.floor(n/2)])/2:null;
  check(allowed.has(key),'ROW_SCOPE');check(!seen.has(key),'DUPLICATE_ROW');seen.add(key);
  check(r.symbol===symbol&&r.trade_date===tradeDate&&r.canonical_run_id===canonicalRunId&&r.is_synthetic===false,'ROW_IDENTITY');
  check(r.unit===(r.baseline_type==='VOLUME'?'SHARES':r.baseline_type==='ABS_RETURN'?'PERCENT_POINTS':'RATIO'),'UNIT');
  check(r.sample_count===n,'SAMPLE_COUNT');check(Array.isArray(r.source_trade_dates)&&JSON.stringify([...r.source_trade_dates].sort())===JSON.stringify(values.map(x=>x.trade_date)),'SOURCE_DATES');
  const sampleRows=Array.isArray(r.samples)?r.samples.slice().sort((a,b)=>a.trade_date.localeCompare(b.trade_date)):[];
  check(sampleRows.length===n&&sampleRows.every((s,i)=>s.trade_date===values[i].trade_date&&typeof s.value==='number'&&Math.abs(s.value-values[i].value)<1e-9),'SAMPLE_VALUES');
  check(mid===null?r.baseline_value===null:typeof r.baseline_value==='number'&&Math.abs(r.baseline_value-mid)<=1e-9,'MEDIAN');
  const opening=r.minute==='09:00'&&r.baseline_type==='ABS_RETURN';const status=opening?'NOT_APPLICABLE':n<10?'INSUFFICIENT_SAMPLE':mid<=0?'BASELINE_ZERO':'READY';
  check(r.status===status,'ROW_STATUS');check(r.data_gap===!['READY','NOT_APPLICABLE'].includes(status),'GAP_FLAG');
 }
 check(receipt.ready_count===rows.filter(r=>r.status==='READY').length&&receipt.data_gap_count===rows.filter(r=>r.data_gap).length&&receipt.requested_count===rows.length,'TOTALS');
 const ready=rows.length===1084&&rows.every(r=>!r.data_gap);
 check(receipt.complete===ready&&receipt.status===(ready?'complete':'blocked'),'RECEIPT_STATUS');
 check(ready?receipt.failed_checks?.length===0&&receipt.first_blocker===null:receipt.failed_checks?.length>0&&!!receipt.first_blocker,'BLOCKER');
 return {contract:'mother_pool_a16_independent_verifier_v1',verification_passed:failed.length===0,failed_checks:[...new Set(failed)],source_ready:ready,complete:failed.length===0&&ready};
}
module.exports={verify};
