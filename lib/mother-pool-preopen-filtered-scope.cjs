'use strict';
const {isDeepStrictEqual}=require('node:util');
const eligibility=require('./mother-pool-preopen-volume-eligibility.cjs');
const sameSet=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&new Set(a).size===a.length&&new Set(b).size===b.length&&a.length===b.length&&a.every(s=>b.includes(s));
function verify(plan,{symbols,tradeDate,asOf}){
 try{
  const e=plan.source_evidence?.volume_eligibility;
  if(!['A04','A07','A15'].includes(plan.module_id)||!e||!sameSet(e.input_symbols,symbols)||!Array.isArray(e.evidence)||!sameSet(e.evidence.map(r=>r.symbol),symbols))return false;
  const dailyVolumeMap=new Map(e.evidence.map(r=>[r.symbol,{daily_volume_evidence:r.raw_daily_evidence,daily_ohlcv_read_at:r.read_at}]));
  const expected=eligibility.select({symbols:e.input_symbols,tradeDate,dailyVolumeMap,asOf});
  return isDeepStrictEqual(e,expected)&&sameSet(plan.requested_symbols,expected.requested_symbols);
 }catch{return false;}
}
module.exports={verify,sameSet};
