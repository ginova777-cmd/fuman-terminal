'use strict';
// Read-only projection of a SAVED document; does not rewrite a formal plan.
const {Reader,Parser,DEFAULTS}=require('../../lib/mother-evidence-recovery-stream.cjs');
const planValidator=require('../../lib/telegram-detectors/premarket-plan-contract.cjs');
function project(file,symbol){
 const r=new Reader(file,128*1048576,DEFAULTS),p=new Parser(r,DEFAULTS),out={};
 const top=new Set(['contract','run_id','trade_date','base_date','frozen_at','activated_at','available_at','source','complete','status','purpose','evidence_sha256','rows_sha256']);
 function visit(keys,depth=0){if(depth>32)throw Error('DEPTH');p.units=0;p.ws();const c=r.peek(),name=keys.join('.');
  if(keys.length===1&&top.has(keys[0])){out[keys[0]]=p.value();return;}
  if(name==='rows'||name==='evidence.data.rows'){p.expect('[');p.ws();let selected=null,count=0;if(r.peek()!==']')for(;;){p.units=0;const row=p.value();count++;if(row.stock_id===symbol){if(selected)throw Error('DUPLICATE_SYMBOL');selected=row;}p.units=0;p.ws();if(r.peek()===']')break;p.expect(',');}p.expect(']');out[name]={count,selected};return;}
  if(c==='{'||c==='['){p.expect(c);p.ws();const end=c==='{'?'}':']',seen=new Set();let i=0;if(r.peek()!==end)for(;;){p.units=0;let key=String(i++);if(c==='{'){key=p.string();if(seen.has(key))throw Error('DUPLICATE_MEMBER');seen.add(key);p.ws();p.expect(':');}visit([...keys,key],depth+1);p.units=0;p.ws();if(r.peek()===end)break;p.expect(',');p.ws();}p.expect(end);}else p.value();
 }
 try{visit([]);p.units=0;p.ws();if(r.peek()!==undefined)throw Error('TRAILING_JSON');return {document:out,raw:r.finish(),source_path:file,symbol};}finally{r.close();}
}
function map(input,{tradeDate,baseDate,now}){
 const s=input.document,row=s.rows?.selected,data=s['evidence.data.rows']?.selected,unknown=[];
 if(s.contract!=='telegram_actual_open_recovery_v1'||s.trade_date!==tradeDate||s.base_date!==baseDate||!row||!data||row.stock_id!==input.symbol||data.stock_id!==input.symbol||data.base_date!==baseDate)throw Error('NATIVE_IDENTITY');
 if(s.complete!==true||s.status!=='complete')throw Error('SOURCE_INCOMPLETE');
 const effective=row.activated_at??s.activated_at??null;
 if(!Number.isFinite(Date.parse(now))||!Number.isFinite(Date.parse(effective))||Date.parse(effective)>Date.parse(now))throw Error('NATIVE_NOT_EFFECTIVE');
 if(new Date(Date.parse(effective)+28800000).toISOString().slice(0,10)!==tradeDate)throw Error('NATIVE_EFFECTIVE_DATE');
 const available=s.available_at??null;if(available===null)unknown.push('FIRST_AVAILABLE_AT_UNKNOWN');
 else if(!Number.isFinite(Date.parse(available))||Date.parse(available)>Date.parse(now))throw Error('SOURCE_AVAILABLE_TIME');
 unknown.push('FULL_BRANCH_ROWS_NOT_VERIFIED','ACTUAL_OPEN_RAW_EVENT_NOT_INDEPENDENTLY_VERIFIED','FORMAL_PLAN_CONTRACT_NOT_SATISFIED','VOLUME_UNIT_UNKNOWN','EMBEDDED_CANONICAL_HASH_NOT_VERIFIED');
 if(!s.source)unknown.push('TOP_LEVEL_SOURCE_UNKNOWN');
 const previous=k=>{const v=data.previous?.[k];if(data.previous?.date!==baseDate||typeof v!=='number'||!Number.isFinite(v)||v<=0){unknown.push('PREVIOUS_'+k.toUpperCase()+'_UNKNOWN');return null;}return v;};
 // Keep source facts. In particular activated_at is NOT available_at or 08:59.
 return {status:'PARTIAL',formal_ready:false,formal_plan:null,source_contract:s.contract,source:s.source??null,raw_sha256:input.raw.sha256,source_path:input.source_path,trade_date:tradeDate,base_date:baseDate,symbol:input.symbol,available_at:available,effective_at:effective,source_frozen_at:s.frozen_at??null,
  declared:{direction:row.intraday_direction??null,levels:row.strategy_levels??[],actual_open:row.actual_open??null,cost:data.cost??null,cost_evidence:data.cost_evidence??null,previous:data.previous??null,volume_unit:null},
  level_input_candidate:{stock_id:input.symbol,trade_date:tradeDate,available_at:available,open:null,cost:null,previous_close:previous('close'),previous_low:previous('low')},
  validation_scope:'PROJECTED_CANDIDATE_NOT_FULL_ORIGINAL_ROWS_HASH_CHECK',formal_validation:planValidator.validate({...s,rows:row?[row]:[]},{tradeDate,now}),unknown,notifications_authorized:false,orders_authorized:false};
}
module.exports={project,map};
