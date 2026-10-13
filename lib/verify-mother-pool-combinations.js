'use strict';
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
function combinations(events,asOf){
 const hash=x=>require('node:crypto').createHash('sha256').update(JSON.stringify(x)).digest('hex');
 const count=new Map();for(const e of events)count.set(e.event_id,(count.get(e.event_id)||0)+1);
 const ordered=events.filter(e=>count.get(e.event_id)===1&&!['B14','B20'].includes(e.module_id)&&['long','short'].includes(e.direction)&&e.source_contract_ok===true&&Date.parse(e.event_timestamp)<=Date.parse(asOf)).sort((a,b)=>Date.parse(a.event_timestamp)-Date.parse(b.event_timestamp)||a.event_id.localeCompare(b.event_id));
 const out=[];
 for(let i=0;i<ordered.length;i++)for(let j=i+1;j<ordered.length;j++){
 const a=ordered[i],b=ordered[j],delta=(Date.parse(b.event_timestamp)-Date.parse(a.event_timestamp))/1000;
 if(a.type===b.type||(a.underlying_event_id||a.event_id)===(b.underlying_event_id||b.event_id)||a.symbol!==b.symbol||a.trade_date!==b.trade_date||a.canonical_run_id!==b.canonical_run_id||delta>180||Date.parse(asOf)-Date.parse(b.event_timestamp)>180000)continue;
 const ds=[...new Set([a.direction,b.direction].filter(d=>d!=='neutral'))];if(!ds.length)continue;
 const nearby=ordered.filter(e=>e.symbol===a.symbol&&e.trade_date===a.trade_date&&e.canonical_run_id===a.canonical_run_id&&Math.abs(Date.parse(e.event_timestamp)-Date.parse(b.event_timestamp))<=180000);
 const conflicting=new Set(nearby.map(e=>e.direction).filter(d=>d!=='neutral')).size>1,direction=conflicting?null:ds[0],status=conflicting?'DIRECTION_CONFLICT':'ELIGIBLE';
 const same=Math.floor(Date.parse(a.event_timestamp)/60000)===Math.floor(Date.parse(b.event_timestamp)/60000);
 out.push({type:'EVENT_COMBINATION',symbol:a.symbol,trade_date:a.trade_date,canonical_run_id:a.canonical_run_id,direction,status,event_id:hash([a.trade_date,a.symbol,direction,a.event_id,b.event_id]),event_timestamp:b.event_timestamp,event_price:b.event_price??null,event_combination:[a.type,b.type],event_sequence:[a,b].map(e=>({event_id:e.event_id,event_timestamp:e.event_timestamp,type:e.type})),same_bar_event:same,matched_windows:[...(same?[0]:[]),...(delta<=60?[60]:[]),180],eligible_for_notifier:!conflicting,formal_candidate_allowed:false,publish_allowed:false});
 }return out;
}
function verify(rows,receipt){try{
 const plan=receipt.writer_write_set.plan,source=plan.source_evidence,asOf=receipt.observed_at;
 if(plan.special_evidence?.window_seconds!==180)return false;
 const coverage=require('./mother-pool-combination-sources').inspect({identity:receipt,symbols:plan.requested_symbols,parents:source.parents,side:source.side,asOf});
 if(rows.length!==coverage.rows.length||new Set(rows.map(r=>r.symbol)).size!==rows.length)return false;
 for(const item of coverage.rows){
  const row=rows.find(r=>r.symbol===item.symbol),s=item.sources,events=[];
  if(item.status!=='SOURCE_ROWS_AVAILABLE'||!row||row.status!=='READY'||row.data_gap_reason!==null||!equal(row.data_gaps,[])||row.formal_candidate_allowed!==false||row.publish_allowed!==false)return false;
  const add=(id,type,time,contract,direction=null,event_price=null,event_id=null)=>{
   const t=Date.parse(time),now=Date.parse(asOf);
   if(!Number.isFinite(t)||t>now||now-t>180000||new Date(t+28800000).toISOString().slice(0,10)!==receipt.trade_date)throw Error('EVENT_TIME');
   const r=s[id];const calculation_evidence=['B12','B13','B19'].includes(id)?{baseline_method:r.baseline_method,baseline_value:r.baseline_value,sample_count:r.sample_count,ratio:r.ratio,value:id==='B12'?r.latest_volume:r.return_1m}:id==='B22'?{level:r.tongzi.levels.P2,reference_bar_hash:r.tongzi.levels.bar_hash,crossing:r.tongzi.events.find(e=>e.event_id===event_id)}:id==='B21'?{vwap:r.vwap,volume:r.volume_evidence,trade_value:r.trade_value_evidence}:{high:r.day_high_so_far,low:r.day_low_so_far,current_price:r.current_price};
   events.push({calculation_evidence,ratio:id==='B12'?r.ratio:null,module_id:id,type,symbol:item.symbol,trade_date:receipt.trade_date,canonical_run_id:receipt.canonical_run_id,event_timestamp:time,event_id:event_id||[receipt.trade_date,item.symbol,id,type,time].join('|'),direction,event_price,source_contract:contract,source_contract_ok:true});
  };
  for(const [id,type] of [['B12','VOLUME_SPIKE'],['B13','PRICE_SPIKE_UP'],['B19','PRICE_SPIKE_DOWN']]){
   if(!require('./verify-mother-pool-anomaly-row').verify(id,{...s[id],trade_date:receipt.trade_date},asOf))return false;
   if(s[id].event_detected)add(id,type,s[id].event_time,s[id].source_contract,id==='B13'?'long':id==='B19'?'short':'neutral',s[id].current?.at(-1)?.close??null);
  }
  const point={...s.B23,trade_date:receipt.trade_date};
  if(!require('./verify-mother-pool-point-in-time').verify(point,asOf))return false;
  if(point.new_high)add('B23','NEW_INTRADAY_HIGH',point.event_time,point.source_contract,'long',point.current_price);
  if(point.new_low)add('B23','NEW_INTRADAY_LOW',point.event_time,point.source_contract,'short',point.current_price);
  if(!require('./verify-mother-pool-tongzi').verify(s.B22,{...receipt,observed_at:asOf}))return false;
  for(const e of s.B22.tongzi.events)if(Date.parse(asOf)-Date.parse(e.event_timestamp)<=180000)add('B22',e.type,e.event_timestamp,e.source_contract,e.direction,e.event_price,e.event_id);
  const r=s.B21,v=require('./daytrade-volume-value-ranking').evaluateVolume(r.volume_evidence,receipt.trade_date,Date.parse(asOf)),a=require('./daytrade-trade-value-evidence').evaluateTradeValue(r.trade_value_evidence,receipt.trade_date,Date.parse(asOf));
  if(v.status!=='ready'||a.status!=='ready'||v.event_at!==a.event_at||v.volume_shares<=0)return false;
  const vw=a.trade_value_twd/v.volume_shares;
  if(typeof r.vwap!=='number'||Math.abs(r.vwap-vw)>1e-6||vw<=0)return false;
  const pct=(point.current_price-vw)/vw*100;
  add('B21',pct>0.05?'VWAP_ABOVE_VWAP':pct< -0.05?'VWAP_BELOW_VWAP':'VWAP_AT_VWAP',v.event_at,'intraday_vwap_v1',pct>0.05?'long':pct< -0.05?'short':null,point.current_price);
  const expectedCombinations=combinations(events,asOf);
  if(!equal(row.events,events)||row.event_count!==events.length||!equal(row.combinations,expectedCombinations)||row.combination_count!==expectedCombinations.length)return false;
 }
 return true;
}catch{return false;}}
function verifySurfaces(db,anon,receipt){try{
 // Both surfaces share the same immutable parent evidence. Recompute once,
 // then require every independently checked output field on both surfaces.
 if(!verify(db,receipt)||anon.length!==db.length)return false;
 const fields=['symbol','status','data_gap_reason','data_gaps','formal_candidate_allowed','publish_allowed','events','event_count','combinations','combination_count'];
 const bySymbol=new Map(anon.map(row=>[row.symbol,row]));if(bySymbol.size!==anon.length)return false;
 return db.every(row=>{const other=bySymbol.get(row.symbol);return other&&fields.every(field=>equal(row[field],other[field]));});
}catch{return false;}}
module.exports={verify,verifySurfaces,combinations};
