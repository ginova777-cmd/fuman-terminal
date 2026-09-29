'use strict';
const {isDeepStrictEqual}=require('node:util');
function verify(expected,actual){
 if(!Array.isArray(expected)||!expected.length||expected.length>500||new Set(expected.map(r=>r.symbol)).size!==expected.length)throw Error('PRIORITY_ACK_PLAN_INVALID');
 const identity=['trade_date','canonical_run_id','writer_run_id','generation_id'];
 const first=expected[0];
 if(expected.some(r=>!/^\d{4}$/.test(r.symbol)||!Number.isFinite(Date.parse(r.updated_at))||identity.some(k=>typeof r.payload?.[k]!=='string'||!r.payload[k]||r.payload[k]!==first.payload[k])))throw Error('PRIORITY_ACK_IDENTITY_INVALID');
 if(!Array.isArray(actual)||actual.length!==expected.length||new Set(actual.map(r=>r.symbol)).size!==actual.length)throw Error('PRIORITY_ACK_SET_MISMATCH');
 const rows=new Map(actual.map(r=>[r.symbol,r]));
 for(const row of expected){const found=rows.get(row.symbol);if(!found)throw Error('PRIORITY_ACK_MISSING_SYMBOL');
  for(const key of Object.keys(row))if(!Object.hasOwn(found,key)||!isDeepStrictEqual(key==='updated_at'?Date.parse(row[key]):row[key],key==='updated_at'?Date.parse(found[key]):found[key]))throw Error('PRIORITY_ACK_CONTENT_MISMATCH:'+key);
 }
 return {mode:'exact_priority_readback_after_timeout',written:expected.length,writer_run_id:first.payload.writer_run_id,generation_id:first.payload.generation_id};
}
module.exports={verify};
