"use strict";
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
const root=process.env.MORNING_TEST_SOURCE_ROOT||path.resolve(__dirname,'..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'morning-stage-reconstruction-'));
process.env.FUMAN_RUNTIME_DIR=dir;process.env.FUMAN_MORNING_STAGE='asia_0850';
const map=require(path.join(root,'scripts/opening-report-0830-industry-map-contract')).OPENING_REPORT_0830_INDUSTRY_MAP;
const date='2026-09-16',day='20260916',run='opening-report-0830-20260916-asia_0850-fixture';
const reports=path.join(dir,'data/opening-report-stages/asia_0850'),state=path.join(dir,'state');fs.mkdirSync(reports,{recursive:true});fs.mkdirSync(state,{recursive:true});
const write=(f,v)=>fs.writeFileSync(f,JSON.stringify(v));
write(path.join(reports,`opening-report-0830-final-receipt-${day}.json`),{date,run_id:run,stage:'asia_0850',priority_observation_mode:'positive_industry_top3',priority_observations:[],overseas_sources_ok:true});
for(const stage of ['us_0820','asia_0850'])for(const row of map)write(path.join(state,`opening_report_0830.industry_bias.${stage}.${row.industry}.json`),{date,source:'opening_report_0830',stage,run_id:(stage==='asia_0850'?run:'opening-report-0830-20260916-us_0820-fixture')+'-'+row.industry,industry:row.industry,mapped_symbols:[],confidence:0.5});
const api=require(path.join(root,'api/market-ai-live')).__test,clock={date,ymd:day,time:'08:50:00',seconds:31800};
assert.equal(api.readOpeningMorningReport(clock).industry_bias.count,15,'two stages must not produce 30 industries');
for(const row of map){const f=path.join(state,`opening_report_0830.industry_bias.asia_0850.${row.industry}.json`),p=JSON.parse(fs.readFileSync(f));p.run_id='stale-'+row.industry;write(f,p);}
write(path.join(reports,`overseas-leaders-0830-${day}.json`),{date,run_id:'old-run',industries:map.map(row=>({industry:row.industry,average_percent:1}))});
const stale=api.readOpeningMorningReport(clock);assert.equal(stale.industry_bias.count,0);assert.equal(stale.ok,false,'old frozen batch must not restore current result');
console.log(JSON.stringify({ok:true,cross_stage_30_rows_rejected:true,stale_state_and_frozen_batch_rejected:true}));
