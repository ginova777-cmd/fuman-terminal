'use strict';
const {map}=require('./native-contract.cjs');
const validator=require('../../lib/telegram-detectors/premarket-plan-contract.cjs');
const {hash,bytes}=require('../integration/offline-store.cjs');
function adapt({projection,daily,minutes,formalPlan=null,context}){
 const mapped=map(projection,context),unknown=new Set(mapped.unknown),s=mapped.symbol,date=context.tradeDate;
 const day=daily?.rows?.filter(r=>r.trade_date===date&&r.symbol===s)||[];
 const opening=minutes?.rows?.filter(r=>r.stock_id===s&&r.trade_date===date&&new Date(Date.parse(r.timestamp)+28800000).toISOString().slice(11,16)==='09:00')||[];
 const evidence={daily:daily?.raw??null,minutes:minutes?.raw??null,actual_open:projection.raw};
 const validRaw=x=>x&&Number.isSafeInteger(x.bytes)&&x.bytes>0&&/^[a-f0-9]{64}$/.test(x.sha256);
 if(!validRaw(daily?.raw)||!validRaw(minutes?.raw))unknown.add('DAILY_MINUTE_RAW_IDENTITY_UNKNOWN');
 const price=mapped.declared.actual_open?.price;
 const matched=day.length===1&&opening.length===1&&typeof price==='number'&&price>0&&day[0].open===price&&opening[0].open===price;
 if(!matched)unknown.add('OPEN_MISSING_OR_CONFLICT');
 const units={daily:day[0]?.volume_unit??null,minute:opening[0]?.volume_raw_unit??null};
 if(!units.daily||!units.minute)unknown.add('VOLUME_UNIT_UNKNOWN');
 // A recovery observation must not be renamed into an 08:59 premarket plan.
 const validation=formalPlan?validator.validate(formalPlan,{tradeDate:date,now:context.now}):{complete:false,failed_checks:['FORMAL_PLAN_NOT_PROVIDED'],first_blocker:'FORMAL_PLAN_NOT_PROVIDED'};
 const row=formalPlan?.rows?.find(r=>r.stock_id===s);
 if(row&&row.intraday_direction!==mapped.declared.direction)unknown.add('DIRECTION_CONFLICT');
 const candidate={source_contract:mapped.source_contract,source_hash:mapped.raw_sha256,stock_id:s,trade_date:date,base_date:context.baseDate,available_at:mapped.available_at,effective_at:mapped.effective_at,direction:mapped.declared.direction,
  levels:mapped.declared.levels.map((level,i)=>({level_id:level.level_id??null,ordinal:i,original:level,source:level.source??null,source_date:level.source_date??null,confirmed:level.confirmed??null,status:'UNVERIFIED_SOURCE_DECLARATION'}))};
 return {contract:'offline_actual_open_adapter_v1',status:'BLOCKED',formal_ready:false,plan_candidate:candidate,formal_plan:validation.complete?formalPlan:null,formal_plan_validation:validation,
  level_input:mapped.level_input_candidate,open_consistency:matched?'MATCH':'UNKNOWN_OR_CONFLICT',units,evidence,unknown:[...unknown],mapping_sha256:hash(bytes(candidate)),notifications_authorized:false,orders_authorized:false};
}
module.exports={adapt};
