'use strict';
const assert=require('node:assert/strict');
const {evaluate,verify,staticMapping}=require('../lib/verify-mother-pool-industry-mapping');
const {collect}=require('../lib/mother-pool-industry-mapping-producer');
const date='2026-09-18',asOf=date+'T10:01:00+08:00';
function classification(symbol){const m=staticMapping();return {industry:'IC設計',industryParent:'半導體',classificationStatus:'ready',officialEvidence:{source_url:'https://mopsfin.twse.com.tw/opendata/t187ap03_L.csv',response_sha256:'a'.repeat(64),fetched_at:asOf,raw_row:{'出表日期':'1150918','公司代號':symbol,'產業別':'24'}},detailedEvidence:{symbol,industry:'CPU/ASIC/IP',source:'api/heatmap.js:BB_HEATMAP_GROUPS',version:m.version,valid_from:m.valid_from}};}
if(require.main===module){
 const c=classification('2454'),identity={trade_date:date,canonical_run_id:'canonical',writer_run_id:'w1'};
 assert.equal(evaluate({symbol:'2454',classification:c,tradeDate:date,asOf}).failed_checks.length,0);
 const plan=collect({identity,asOf,discovery:{...identity,requested_symbols:['2454','2330'],mapping_rows:[{symbol:'2454',classification:c}]}});
 assert.equal(plan.rows[0].status,'READY');assert.equal(plan.rows[1].status,'DATA_GAP');assert.equal(verify({...plan.rows[0],trade_date:date},asOf),true);
 for(const mutate of [x=>{x.officialEvidence.raw_row['公司代號']='wrong';},x=>{x.officialEvidence.raw_row['出表日期']='1150921';},x=>{x.officialEvidence.fetched_at=date+'T10:02:00+08:00';},x=>{x.officialEvidence.source_url='unknown';},x=>{x.officialEvidence.raw_row['產業別']='01';},x=>{x.detailedEvidence.version='b'.repeat(64);},x=>{x.detailedEvidence.industry='面板業';}]){const bad=structuredClone(c);mutate(bad);assert(evaluate({symbol:'2454',classification:bad,tradeDate:date,asOf}).failed_checks.length>0);}
 assert.equal(verify({...plan.rows[0],trade_date:date,industry_code:'01'},asOf),false);
 console.log(JSON.stringify({status:'passed',scope:'isolated',production_complete:false}));
}
module.exports={classification};
