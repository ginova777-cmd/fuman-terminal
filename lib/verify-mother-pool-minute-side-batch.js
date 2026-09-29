'use strict';
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
function verify(actual,expected,{role,dbReadback}={}){
 const failures=[];
 if(role!=='anon'||dbReadback!==true)failures.push('ANON_READBACK_REQUIRED');
 if(!actual||stable(actual)!==stable(expected))failures.push('SAME_BATCH_MISMATCH');
 const b=actual||{},rows=Array.isArray(b.details)?b.details:[],now=Date.parse(b.as_of);
 const taipeiDate=t=>Number.isFinite(t)?new Date(t+28800000).toISOString().slice(0,10):null;
 if(b.contract!=='mother_pool_minute_side_batch_v1'||!Number.isFinite(now)
  ||!/^\d{4}-\d{2}-\d{2}$/.test(b.trade_date||'')||taipeiDate(now)!==b.trade_date
  ||b.canonical_run_id!==`fugle_daytrade_source:${String(b.trade_date).replaceAll('-','')}:canonical`
  ||!b.mother_pool_run_id||!Number.isInteger(b.snapshot_sequence)||b.snapshot_sequence<1)failures.push('IDENTITY_INVALID');
 if(!Array.isArray(b.details)||!Number.isInteger(b.requested)||b.requested<0
  ||rows.length!==b.requested||new Set(rows.map(x=>x?.symbol)).size!==rows.length)failures.push('COUNT_OR_DUPLICATE');
 for(const r of rows){
  if(!r||typeof r!=='object'||Array.isArray(r)||!/^\d{4}$/.test(r.symbol||'')){
   failures.push('ROW_INVALID');continue;
  }
  if(r.status==='DATA_GAP'){if(!r.reason)failures.push('GAP_REASON_MISSING');continue;}
  if(r.status!=='SOURCE_READY'){failures.push('STATUS_INVALID');continue;}
  const m=r.latest||{},start=Date.parse(m.timestamp),event=Date.parse(m.side_volume_timestamp),age=(now-event)/1000;
  if(m.stock_id!==r.symbol||m.trade_date!==b.trade_date||m.aggregation!=='ONE_MINUTE'
    ||m.volume_unit!=='LOTS'||m.is_synthetic!==false||m.complete!==true
    ||m.classification_source!=='Fugle.aggregates.total.exact_trade_counter_boundaries'
    ||!m.start_boundary_identity||!m.end_boundary_identity)failures.push('NATIVE_SOURCE_INVALID:'+r.symbol);
  if(!Number.isFinite(start)||taipeiDate(start)!==b.trade_date||taipeiDate(event)!==b.trade_date||start%60000!==0||start+60000>now||!Number.isFinite(event)
    ||event<start||event>=start+60000||age<0||age>120||r.side_event_age_seconds!==age)failures.push('EVENT_TIME_INVALID:'+r.symbol);
  const quantities=['outside_1m','inside_1m','unknown_1m','total_1m'];
  if(quantities.some(k=>typeof m[k]!=='number'||!Number.isFinite(m[k])||m[k]<0)
    ||m.total_1m!==m.outside_1m+m.inside_1m+m.unknown_1m)failures.push('SIDE_ARITHMETIC_INVALID:'+r.symbol);
  const rolling=r.rolling_20m_rows;
  if(!Array.isArray(rolling)||rolling.length>20||r.rolling_20m_observed_count!==rolling.length
   ||r.rolling_20m_missing_count!==20-rolling.length){failures.push('ROLLING_WINDOW_COUNTS_INVALID:'+r.symbol);continue;}
  const seen=new Set();let previous=-Infinity;
  for(const bar of rolling){
   if(!bar||typeof bar!=='object'){failures.push('ROLLING_ROW_INVALID:'+r.symbol);continue;}
   const t=Date.parse(bar.timestamp),e=Date.parse(bar.side_volume_timestamp);
   if(!Number.isFinite(t)||t%60000!==0||t<start-20*60000||t>=start||t<=previous||seen.has(t)
    ||taipeiDate(t)!==b.trade_date||!Number.isFinite(e)||e<t||e>=t+60000)
    failures.push('ROLLING_TIME_INVALID:'+r.symbol);
   seen.add(t);previous=t;
   if(bar.stock_id!==r.symbol||bar.trade_date!==b.trade_date||bar.aggregation!=='ONE_MINUTE'
    ||bar.volume_unit!=='LOTS'||bar.is_synthetic!==false||bar.complete!==true
    ||bar.classification_source!=='Fugle.aggregates.total.exact_trade_counter_boundaries'
    ||!bar.start_boundary_identity||!bar.end_boundary_identity)
    failures.push('ROLLING_SOURCE_INVALID:'+r.symbol);
   if(quantities.some(k=>typeof bar[k]!=='number'||!Number.isFinite(bar[k])||bar[k]<0)
    ||bar.total_1m!==bar.outside_1m+bar.inside_1m+bar.unknown_1m)
    failures.push('ROLLING_ARITHMETIC_INVALID:'+r.symbol);
  }
  const baseline=r.rolling_baseline;
  if(baseline?.method!=='ROLLING_20M_MEDIAN'||baseline?.minimum_samples!==10)
   failures.push('ROLLING_BASELINE_CONTRACT_INVALID:'+r.symbol);
  for(const [name,numerator,denominator] of [['outside','outside_1m','inside_1m'],['inside','inside_1m','outside_1m']]){
   const values=[];let zeroCount=0,invalidCount=0;
   for(const bar of rolling){
    const n=bar?.[numerator],d=bar?.[denominator];
    if(typeof n!=='number'||!Number.isFinite(n)||n<0||typeof d!=='number'||!Number.isFinite(d)||d<0){invalidCount++;continue;}
    if(d===0){zeroCount++;continue;}
    if(Number.isFinite(n/d))values.push(n/d);else invalidCount++;
   }
   values.sort((a,b)=>a-b);
   const count=values.length;
   const median=count<10?null:count%2?values[(count-1)/2]:values[count/2-1]/2+values[count/2]/2;
   const status=invalidCount?'DATA_GAP':count<10?'INSUFFICIENT_SAMPLE':median<=0?'BASELINE_ZERO':'READY';
   const reported=baseline?.[name];
   if(!reported||reported.sample_count!==count||reported.zero_denominator_count!==zeroCount
    ||reported.invalid_count!==invalidCount||reported.baseline!==median||reported.status!==status)
    failures.push('ROLLING_BASELINE_MISMATCH:'+r.symbol+':'+name);
  }
 }
 if(rows.filter(x=>x?.status==='SOURCE_READY').length!==b.source_ready)failures.push('READY_COUNT_INVALID');
 if(b.publish_allowed!==false||b.creates_order!==false||b.baseline_verified!==false)failures.push('SOURCE_ONLY_GUARD_INVALID');
 const failed=[...new Set(failures)];
 return {contract:'mother_pool_minute_side_readback_v1',trade_date:b.trade_date,mother_pool_run_id:b.mother_pool_run_id,
  snapshot_sequence:b.snapshot_sequence,as_of:b.as_of,status:failed.length?'blocked':'SOURCE_READBACK_VERIFIED',
  complete:false,readback_verified:failed.length===0,baseline_verified:false,failed_checks:failed,first_blocker:failed[0]||null,
  requested:b.requested,source_ready:b.source_ready,read_role:role,exit_code:failed.length?1:0};
}
module.exports={verify};
