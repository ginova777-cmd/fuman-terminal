'use strict';
const assert=require('node:assert/strict'),{completeZeroSource}=require('../lib/mother-pool-morning-zero-source'),stages=require('../lib/opening-report-stage-contract');
const map=require('./opening-report-0830-industry-map-contract').OPENING_REPORT_0830_INDUSTRY_MAP;
for(const stage of ['us_0820','asia_0850']){
 const e={aggregate:{priority_observation_mode:'positive_industry_top3'},all_industry_payloads:map.map(m=>{const leaders=m.overseas_leaders.filter(l=>stages.allowed(l.yahoo_symbol,stage)).map(l=>({...l,ok:true,percent:-1,source:'fixture',source_time:'2026-09-29T00:00:00Z'}));return {industry:m.industry,overseas_return_1d_pct:leaders.length?-1:null,overseas_leader_detection:{industry:m.industry,leaders,leader_count:leaders.length,valid_count:leaders.length,unavailable_count:0,detection_enabled:!!leaders.length,average_percent:leaders.length?-1:null}};})};
 const {hash}=require('../lib/mother-pool-module-write-set'),{verifyHandoff}=require('../lib/mother-pool-morning-evidence');
 const run='opening-report-20260929-'+stage;
 for(const p of e.all_industry_payloads)Object.assign(p,{date:'2026-09-29',stage,run_id:run+'-'+p.industry,positive_return_rank:null});
 Object.assign(e,{contract:'opening_report_handoff_raw_evidence_v1',stage,readback_role:'anon',industry_payloads:[],bridges:[],rows:[],requests:[],rows_sha256:hash([]),all_industry_payloads_sha256:hash(e.all_industry_payloads)});
 Object.assign(e.aggregate,{run_id:run,status:'BRIDGE_OK',industry_count:0});
 const receipt={contract:'opening-report-0830-mother-pool-handoff-ack-v2',complete:true,exitCode:0,db_readback_ok:true,trade_date:'2026-09-29',report_run_id:run,checked_at:'2026-09-29T01:00:00Z',accepted_symbols:[],accepted_readback_symbols:[],source_evidence:e};
 const opts={tradeDate:'2026-09-29',stage,asOf:'2026-09-29T01:01:00Z'};
 assert.deepEqual(verifyHandoff(receipt,opts),[]);
 const broken=structuredClone(receipt);broken.source_evidence.all_industry_payloads.pop();assert(verifyHandoff(broken,opts).length);
 const o={stage,checked:Date.parse('2026-09-29T01:00:00Z')};assert(completeZeroSource(e,o));
 for(const change of [p=>p.overseas_leader_detection.leaders.pop(),p=>p.overseas_leader_detection.leaders[0].ok=false,p=>p.overseas_leader_detection.leaders[0].percent=null,p=>p.overseas_leader_detection.leaders[0].source_time='2026-09-30T00:00:00Z',p=>p.overseas_return_1d_pct=1]){const bad=structuredClone(e);change(bad.all_industry_payloads.find(p=>p.overseas_leader_detection.leaders.length));assert.equal(completeZeroSource(bad,o),false);}
}
console.log('PASS both stages: complete nonpositive universe accepted; missing sources, invalid values and future evidence rejected');
