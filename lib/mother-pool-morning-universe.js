'use strict';
const {isDeepStrictEqual}=require('node:util');
const {hash}=require('./mother-pool-module-write-set');
const names=require('../scripts/opening-report-0830-industry-map-contract').OPENING_REPORT_0830_INDUSTRY_MAP.map(r=>r.industry);
function verifyUniverse(e,{tradeDate,stage,runId}){
 const all=e?.all_industry_payloads;
 if(!Array.isArray(all)||all.length!==names.length||new Set(all.map(p=>p?.industry)).size!==names.length||all.some(p=>!names.includes(p?.industry)))return ['HANDOFF_INDUSTRY_UNIVERSE_INCOMPLETE'];
 const errors=[];
 if(e.all_industry_payloads_sha256!==hash(all))errors.push('HANDOFF_INDUSTRY_UNIVERSE_HASH');
 if(all.some(p=>p.date!==tradeDate||p.stage!==stage||p.run_id!==runId+'-'+p.industry))errors.push('HANDOFF_INDUSTRY_UNIVERSE_IDENTITY');
 const ordered=names.map(name=>all.find(p=>p.industry===name));
 const positive=ordered.filter(p=>typeof p.overseas_return_1d_pct==='number'&&Number.isFinite(p.overseas_return_1d_pct)&&p.overseas_return_1d_pct>0).sort((a,b)=>b.overseas_return_1d_pct-a.overseas_return_1d_pct);
 if(all.some(p=>p.positive_return_rank!==(positive.findIndex(r=>r.industry===p.industry)>=0?positive.findIndex(r=>r.industry===p.industry)+1:null)))errors.push('HANDOFF_INDUSTRY_POSITIVE_RANK');
 for(const p of e.industry_payloads||[])if(!isDeepStrictEqual(p,all.find(r=>r.industry===p.industry)))errors.push('HANDOFF_SELECTED_SOURCE_MISMATCH');
 if(e.aggregate?.priority_observation_mode==='positive_industry_top3'){
  const expected=positive.slice(0,3).map(p=>p.industry).sort();
  const actual=(e.industry_payloads||[]).map(p=>p.industry).sort();
  if(!isDeepStrictEqual(actual,expected))errors.push('HANDOFF_TOP3_SET_MISMATCH');
 }
 return [...new Set(errors)];
}
module.exports={verifyUniverse};
