'use strict';
function create(){
 const states=new Map(),fields=['trade_date','canonical_run_id','writer_run_id','generation_id'];
 return {async run(rows,write){
  const identity=rows[0]?.payload;
  if(!identity||fields.some(k=>typeof identity[k]!=='string'||!identity[k])||rows.some(r=>fields.some(k=>r.payload?.[k]!==identity[k])))throw Error('PRIORITY_ROUND_IDENTITY_INVALID');
  const key=JSON.stringify(fields.map(k=>identity[k])),previous=states.get(key);
  if(previous)throw Error(previous.status==='inflight'?'PRIORITY_ROUND_WRITE_INFLIGHT':'PRIORITY_ROUND_WRITE_UNCONFIRMED:'+previous.reason);
  states.set(key,{status:'inflight'});
  try{const result=await write();states.delete(key);return result;}
  catch(error){states.set(key,{status:'failed',reason:String(error?.message||error).slice(0,300)});throw error;}
 }};
}
module.exports={create};
