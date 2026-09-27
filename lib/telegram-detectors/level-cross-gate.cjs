'use strict';
const indicators=require('./level-cross-indicators.cjs');
const {touch}=require('./level-touch.cjs');
const CONTRACT='telegram_level_cross_gate_v1';
const key=e=>`${e.trade_date}:${e.stock_id}:${new Date(e.timestamp).toISOString()}:${e.event_type}`;
const iso=t=>new Date(t).toISOString();
const allowed=['VOLUME_ANOMALY_EVENT','PRICE_UP_ANOMALY_EVENT'];
function evaluate({event,bars,levelInput,now,requiredDirection,plan}){
 let selection;
 if(plan!==undefined){
  selection=require('./premarket-plan-contract.cjs').directionFor(plan,event.stock_id,{tradeDate:event.trade_date,now});
  if(!selection.direction)return {contract:CONTRACT,status:'source_missing',eligible:false,reason:selection.reason,matches:[],plan_run_id:plan?.run_id||null};
  if(requiredDirection!==undefined&&requiredDirection!==selection.direction)throw Error('PLAN_DIRECTION_CONFLICT');
  requiredDirection=selection.direction;
 }
 const start=Date.parse(event.timestamp),end=Date.parse(now),date=event.trade_date;
 if(!allowed.includes(event.event_type)||!Number.isFinite(start)||start%60000||!Number.isFinite(end)||start+60000>end)throw Error('INVALID_GATE_ORIGIN');
 const result={contract:CONTRACT,status:'waiting_touch',eligible:false,trigger_at:event.timestamp,touch_deadline:iso(start+180000),matches:[],missing_levels:[]};
 if(levelInput?.stock_id!==event.stock_id||levelInput?.trade_date!==date)throw Error('LEVEL_INPUT_IDENTITY');
 const sourceTime=Date.parse(levelInput.available_at);
 if(!Number.isFinite(sourceTime)||sourceTime>end)throw Error('LEVEL_SOURCE_NOT_AVAILABLE');
 if(requiredDirection!==undefined&&!['long','short'].includes(requiredDirection))throw Error('FIXED_DIRECTION_INVALID');
 const levelRows=indicators.levels(levelInput).filter(l=>requiredDirection===undefined||l.direction===requiredDirection);
 if(requiredDirection!==undefined)result.required_direction=requiredDirection;
 if(selection){result.plan_run_id=selection.plan_run_id;result.plan_sha256=selection.plan_sha256;}
 result.missing_levels=levelRows.filter(l=>l.status!=='ready').map(l=>l.id);
 const values=indicators.calculate({bars,stock_id:event.stock_id,trade_date:date,as_of:now}).rows;
 const prices=new Map(bars.map(b=>[Date.parse(b.timestamp),b]));
 const observations=[];
 for(const level of levelRows.filter(l=>l.status==='ready')){
  // First touch owns the deadline. Repeated touches never restart it.
  const hit=values.find(v=>v.valid&&indicators.withinWindow(event.timestamp,v.timestamp)&&Date.parse(v.timestamp)+60000>=sourceTime&&touch({level,bar:prices.get(Date.parse(v.timestamp)),previousClose:prices.get(Date.parse(v.timestamp)-60000)?.close}).matched);
  if(!hit)continue;
  observations.push({level_id:level.id,touch_at:hit.timestamp,cross_deadline:iso(Date.parse(hit.timestamp)+180000)});
  const cross=values.find(v=>v.valid&&indicators.withinWindow(hit.timestamp,v.timestamp)&&(level.direction==='long'?v.golden:v.death).length);
  if(cross)result.matches.push({level_id:level.id,direction:level.direction,price:level.price,touch_at:hit.timestamp,cross_at:cross.timestamp,indicators:level.direction==='long'?cross.golden:cross.death,range:touch({level,bar:prices.get(Date.parse(hit.timestamp)),previousClose:prices.get(Date.parse(hit.timestamp)-60000)?.close})});
 }
 result.observations=observations;
 // One notification per original anomaly, containing the earliest confirmed levels.
 if(result.matches.length){const first=Math.min(...result.matches.map(m=>Date.parse(m.cross_at)));result.matches=result.matches.filter(m=>Date.parse(m.cross_at)===first);result.confirmed_at=iso(first);result.status='confirmed';result.eligible=true;}
 else if(observations.length){result.status=end>=Math.max(...observations.map(o=>Date.parse(o.cross_deadline)))+60000?'expired':'waiting_cross';}
 else if(end>=start+240000)result.status=result.missing_levels.length===levelRows.length?'source_missing':'expired';
 return result;
}
function build({events,previous=[],contexts,now,tradeDate,plan}){
 const all=new Map();
 for(const entry of [...previous,...events.map(event=>({event}))]){
  const e=entry.event,t=Date.parse(e?.timestamp);
  if(e?.trade_date!==tradeDate||!allowed.includes(e?.event_type)||!Number.isFinite(t)||Date.parse(now)-t>8*60000)continue;
  const id=key(e);if(!all.has(id))all.set(id,entry);
 }
 const output=[],state=[],evidence=[];
 for(const [id,entry]of all){
  const event=entry.event,context=contexts[event.stock_id];
  // Preserve the source known when the anomaly was first observed.
  const levelInput=entry.levelInput||context?.levelInput;
  const bars=context?.bars||[];
  if(!levelInput){output.push({...event,gate:{contract:CONTRACT,status:'source_missing',eligible:false,reason:'LEVEL_CONTEXT_MISSING'}});state.push(entry);continue;}
  const proof={event_id:id,event,bars,levelInput,now,...(plan!==undefined?{plan}:{})};
  const gate=evaluate(proof);
  output.push({...event,gate});state.push({event,levelInput});evidence.push(proof);
 }
 return {events:output,state,evidence};
}
function verify(events,evidence){
 const failures=[];
 for(const event of events){
  const proof=evidence?.find(p=>p.event_id===key(event));
  if(!proof){failures.push('GATE_EVIDENCE_MISSING:'+key(event));continue;}
  try{const expected=evaluate(proof);if(JSON.stringify(expected)!==JSON.stringify(event.gate))failures.push('GATE_RECOMPUTE_MISMATCH:'+key(event));const raw={...event};delete raw.gate;if(JSON.stringify(raw)!==JSON.stringify(proof.event))failures.push('GATE_ORIGIN_MISMATCH:'+key(event));}catch{failures.push('GATE_RECOMPUTE_FAILED:'+key(event));}
 }
 return failures;
}
module.exports={CONTRACT,key,evaluate,build,verify};
