'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert/strict');
const {verifyHandoff}=require('../lib/mother-pool-morning-evidence'),{hash}=require('../lib/mother-pool-module-write-set');
let source=fs.readFileSync(path.join(__dirname,'verify-opening-report-0830-mother-pool-handoff-ack.js'),'utf8');
source=source.replace('  const assertions =','  return {payload,bridge,db};\n  const assertions =');
const req=n=>require(n);req.main=null;const ctx={require:req,module:{exports:{}},__dirname,process,console,Date,Intl,Set,Map};vm.runInNewContext(source,ctx);
const f=JSON.parse(JSON.stringify(ctx.module.exports.fixture()));
const p=f.payload,run='opening-report-0830-20260908-us_0820-fixture';p.run_id=run+'-'+p.industry;p.priority_observation_basis='positive_industry_top3';p.priority_overseas_leaders=[{rank:1,symbol:'AAPL',percent:1,source_time:'2026-09-08T00:00:00Z'}];f.bridge.run_id=p.run_id;
const rows=['2049','2308'].map(symbol=>{const r=structuredClone(f.db);r.symbol=symbol;const e=r.payload.openingReport0830IndustryBias;e.report_run_id=run;e.run_id=run;e.linked_industries=[p.industry];e.observations=[{industry:p.industry,run_id:p.run_id,priority_observation_rank:1,priority_overseas_leaders:p.priority_overseas_leaders}];return r;});
const receipt={contract:'opening-report-0830-mother-pool-handoff-ack-v2',complete:true,exitCode:0,db_readback_ok:true,trade_date:p.date,report_run_id:run,checked_at:'2026-09-08T00:21:00Z',accepted_symbols:['2049','2308'],accepted_readback_symbols:['2049','2308'],source_evidence:{contract:'opening_report_handoff_raw_evidence_v1',stage:'us_0820',readback_role:'anon',aggregate:{run_id:run,status:'BRIDGE_OK',industry_count:1},industry_payloads:[p],bridges:[{receipt:f.bridge}],rows,rows_sha256:hash(rows),requests:[{http_status:200,role:'anon',row_count:2}]}};
const options={tradeDate:p.date,stage:'us_0820',asOf:'2026-09-08T00:22:00Z'};
assert.deepEqual(verifyHandoff(receipt,options),[]);
for(const mutate of [r=>delete r.source_evidence,r=>r.source_evidence.rows[0].market='SZ',r=>r.source_evidence.rows_sha256='wrong',r=>r.source_evidence.bridges=[],r=>r.accepted_symbols=['2049'],r=>r.checked_at='2026-09-08T00:23:00Z',r=>r.source_evidence.requests[0].http_status=503]){const r=structuredClone(receipt);mutate(r);assert(verifyHandoff(r,options).length>0);}
console.log('PASS raw handoff evidence: actual payload/bridge/row validators; missing, corrupt, wrong-set, future and HTTP evidence rejected');
