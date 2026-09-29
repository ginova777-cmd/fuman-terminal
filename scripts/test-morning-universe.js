'use strict';
const assert=require('node:assert/strict'),{hash}=require('../lib/mother-pool-module-write-set'),{verifyUniverse}=require('../lib/mother-pool-morning-universe');
const names=require('./opening-report-0830-industry-map-contract').OPENING_REPORT_0830_INDUSTRY_MAP.map(p=>p.industry);
const o={tradeDate:'2026-09-29',stage:'us_0820',runId:'r'};
const all=names.map((industry,i)=>({industry,date:o.tradeDate,stage:o.stage,run_id:'r-'+industry,overseas_return_1d_pct:15-i,positive_return_rank:i+1}));
const e={all_industry_payloads:all,all_industry_payloads_sha256:hash(all),industry_payloads:all.slice(0,3),aggregate:{priority_observation_mode:'positive_industry_top3'}};
assert.deepEqual(verifyUniverse(e,o),[]);
for(const change of [e=>e.all_industry_payloads.pop(),e=>e.all_industry_payloads[1]=e.all_industry_payloads[0],e=>e.all_industry_payloads[0].stage='asia_0850',e=>e.all_industry_payloads[0].positive_return_rank=3,e=>e.industry_payloads=e.all_industry_payloads.slice(1,4),e=>e.industry_payloads[0]={...e.industry_payloads[0],extra:true}]){const bad=structuredClone(e);change(bad);bad.all_industry_payloads_sha256=hash(bad.all_industry_payloads);assert(verifyUniverse(bad,o).length);}
console.log('PASS complete configured industry set, fixed identity, recomputed positive rank and selected source equality');
