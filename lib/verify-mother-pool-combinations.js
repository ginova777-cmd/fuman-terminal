'use strict';
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
function combinations(events){
 const output=[];
 for(let i=0;i<events.length;i++){
  const root=events[i],members=[root];
  for(let j=0;j<events.length;j++)if(i!==j&&Math.abs(Date.parse(events[j].event_timestamp)-Date.parse(root.event_timestamp))<=180000)members.push(events[j]);
  if(members.length<2)continue;
  output.push({type:'EVENT_COMBINATION',symbol:root.symbol,trade_date:root.trade_date,canonical_run_id:root.canonical_run_id,event_combination:members.map(e=>e.type),event_sequence:members.map(e=>({event_id:e.event_id,event_timestamp:e.event_timestamp,time_difference_seconds:(Date.parse(e.event_timestamp)-Date.parse(root.event_timestamp))/1000})),same_bar_event:members.every(e=>Date.parse(e.event_timestamp)===Date.parse(root.event_timestamp)),formal_candidate_allowed:false,publish_allowed:false});
 }
 return output;
}
function verify(rows,receipt){try{
 const plan=receipt.writer_write_set.plan,source=plan.source_evidence,asOf=receipt.observed_at;
 if(plan.special_evidence?.window_seconds!==180)return false;
 const coverage=require('./mother-pool-combination-sources').inspect({identity:receipt,symbols:plan.requested_symbols,parents:source.parents,side:source.side,asOf});
 if(rows.length!==coverage.rows.length||new Set(rows.map(r=>r.symbol)).size!==rows.length)return false;
 for(const item of coverage.rows){
  const row=rows.find(r=>r.symbol===item.symbol),s=item.sources,events=[];
  if(item.status!=='SOURCE_ROWS_AVAILABLE'||!row||row.status!=='READY'||row.data_gap_reason!==null||!equal(row.data_gaps,[])||row.formal_candidate_allowed!==false||row.publish_allowed!==false)return false;
  const add=(id,type,time,contract)=>{
   const t=Date.parse(time),now=Date.parse(asOf);
   if(!Number.isFinite(t)||t>now||now-t>180000||new Date(t+28800000).toISOString().slice(0,10)!==receipt.trade_date)throw Error('EVENT_TIME');
   events.push({module_id:id,type,symbol:item.symbol,trade_date:receipt.trade_date,canonical_run_id:receipt.canonical_run_id,event_timestamp:time,event_id:[receipt.writer_run_id,item.symbol,id,type,time].join('|'),source_contract:contract,source_contract_ok:true});
  };
  for(const [id,type] of [['B12','VOLUME_SPIKE'],['B13','PRICE_SPIKE_UP'],['B19','PRICE_SPIKE_DOWN']]){
   if(!require('./verify-mother-pool-anomaly-row').verify(id,{...s[id],trade_date:receipt.trade_date},asOf))return false;
   if(s[id].event_detected)add(id,type,s[id].event_time,s[id].source_contract);
  }
  for(const [id,dir,type] of [['B14','outside','OUTSIDE_STRONG'],['B20','inside','INSIDE_STRONG']]){
   const r=s[id].source,p={...r,trade_date:receipt.trade_date,event_time:r.minute_start,baseline_value:r[dir+'_baseline_value'],baseline_sample_count:r[dir+'_baseline_sample_count'],dynamic_ratio:r[dir+'_dynamic_ratio'],side_state:r[dir+'_side_state']};
   if(!require('./verify-mother-pool-module-round').createVerifier(id).minuteSideFormulaOk(id,p))return false;
   const numerator=dir==='outside'?r.outside_1m:r.inside_1m,denominator=dir==='outside'?r.inside_1m:r.outside_1m;
   if(denominator>0&&numerator/denominator>=2)add(id,type,r.side_volume_timestamp,r.source_contract);
  }
  const point={...s.B23,trade_date:receipt.trade_date};
  if(!require('./verify-mother-pool-point-in-time').verify(point,asOf))return false;
  if(point.new_high)add('B23','NEW_INTRADAY_HIGH',point.event_time,point.source_contract);
  if(point.new_low)add('B23','NEW_INTRADAY_LOW',point.event_time,point.source_contract);
  const bars=s.B22.opening_range?.bars,start=Date.parse(receipt.trade_date+'T09:00:00+08:00');
  if(!Array.isArray(bars)||bars.length!==5||bars.some((b,i)=>b.symbol!==item.symbol||b.synthetic!==false||b.complete!==true||Date.parse(b.timestamp)!==start+i*60000||Date.parse(b.timestamp)+60000>Date.parse(asOf)||![b.high,b.low].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0)||b.high<b.low))return false;
  const high=Math.max(...bars.map(b=>b.high)),low=Math.min(...bars.map(b=>b.low));
  if(point.current_price>high)add('B22','OPENING_RANGE_BREAK_UP',asOf,'intraday_opening_range_v1');
  else if(point.current_price<low)add('B22','OPENING_RANGE_BREAK_DOWN',asOf,'intraday_opening_range_v1');
  const r=s.B21,v=require('./daytrade-volume-value-ranking').evaluateVolume(r.volume_evidence,receipt.trade_date,Date.parse(asOf)),a=require('./daytrade-trade-value-evidence').evaluateTradeValue(r.trade_value_evidence,receipt.trade_date,Date.parse(asOf));
  if(v.status!=='ready'||a.status!=='ready'||v.event_at!==a.event_at||v.volume_shares<=0)return false;
  const vw=a.trade_value_twd/v.volume_shares;
  if(typeof r.vwap!=='number'||Math.abs(r.vwap-vw)>1e-6||vw<=0)return false;
  const pct=(point.current_price-vw)/vw*100;
  add('B21',pct>0.05?'VWAP_ABOVE_VWAP':pct< -0.05?'VWAP_BELOW_VWAP':'VWAP_AT_VWAP',v.event_at,'intraday_vwap_v1');
  if(!equal(row.events,events)||row.event_count!==events.length||!equal(row.combinations,combinations(events))||row.combination_count!==combinations(events).length)return false;
 }
 return true;
}catch{return false;}}
module.exports={verify,combinations};
