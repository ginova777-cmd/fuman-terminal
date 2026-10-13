'use strict';
// Isolated contract fixtures only; these are never natural acceptance evidence.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {hash}=require('../lib/mother-pool-module-write-set');
const {createVerifier}=require('../lib/verify-mother-pool-module-round');
const closure=require('../lib/mother-pool-preopen-closure');
const registry=require('../data/contracts/mother-pool-a01-b24-module-registry-v1.json');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'preopen-parent-contract-'));
const dir=path.join(runtime,'data','scan-receipts','modules');fs.mkdirSync(dir,{recursive:true});
const identity={trade_date:'2026-10-13',canonical_run_id:'fixture-c',writer_run_id:'fixture-w',generation_id:'fixture-g',mother_pool_run_id:'fixture-m',snapshot_generation:'fixture-s',snapshot_sequence:1};
const asOf='2026-10-13T00:59:30Z',symbols=['2330','2317'];
function parent(parentSymbols=symbols){
 const evidence={observed_at:'2026-10-13T00:58:00Z',stock_tickers:parentSymbols.map(symbol=>({symbol,name:'TEST_ONLY',market:'TWSE',stock_type:'COMMONSTOCK',payload:{stock_master_contract:'mops_official_stock_master_v1',stock_master_source:'MOPS_OPEN_DATA_TWSE_TPEX',official_present:true,stock_master_run_id:'TEST_ONLY',stock_master_source_date:identity.trade_date,stock_master_synced_at:'2026-10-13T00:00:00Z'}})),stock_universe:parentSymbols.map(symbol=>({symbol,is_active:true,payload:{}}))};
 const rows=require('../lib/mother-pool-eligibility-source').collect({identity,evidence,asOf:evidence.observed_at}).rows.map(row=>({...row,...identity}));
 const plan={created_at:'2026-10-13T00:58:00Z',requested_symbols:parentSymbols,data_gap_symbols:[],rows};
 const writer_write_set={...identity,module_id:'A02',contract:'mother_pool_module_write_set_v1',plan,plan_hash:hash(plan),ack:{plan_hash:hash(plan),committed:true,committed_at:'2026-10-13T00:58:30Z',written_symbols:parentSymbols}};
 const surface={query_identity:identity,missing:[],extra:[],pages:[{query_identity:identity,page_index:0,page_size:500,offset:0,http_status:200,content_range:`0-${rows.length-1}/${rows.length}`,rows}]};
 return {...identity,module_id:'A02',contract:registry.modules.A02,run_id:'fixture-r',observed_at:'2026-10-13T00:58:00Z',captured_at:'2026-10-13T00:59:10Z',status:'verified',source_contract_ok:true,db_readback_ok:true,anon_readback_ok:true,failed_checks:[],natural_evidence:true,synthetic:false,replay:false,look_ahead:false,requested:rows.length,written:rows.length,readback:rows.length,unique_symbols:rows.length,writer_write_set,db_readback:surface,anon_readback:structuredClone(surface)};
}
let count=0;const failures=[];
function check(name,round,expected){
 const file=path.join(dir,'a02-fixture.json'),bytes=JSON.stringify(round);fs.writeFileSync(file,bytes);
 const ref={file,sha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex')};
 for(const moduleId of ['A14','A19']){
  const result=closure.collect({moduleId,identity,symbols,references:{A02:ref},asOf,runtime});
  const actual=result.rows[0].dependencies.A02;
  if((expected==='READY'?actual.status:actual.reason)!==expected)failures.push({moduleId,name,actual,expected});
  assert.equal(result.rows[0].status,'DATA_GAP','Other absent parents must prevent overall READY');
  count++;
 }
}
try{
 assert.equal(createVerifier('A02').validRound(parent()),true,'Use the real unchanged parent verifier');
 check('same set reordered',parent([...symbols].reverse()),'READY');
 const different=parent(['1101','1102']);assert.equal(createVerifier('A02').validRound(different),true);
 check('valid parent for different universe',different,'PARENT_SYMBOL_SET_MISMATCH');
 check('partial parent',parent(['2330']),'PARENT_SYMBOL_SET_MISMATCH');
 check('extra parent',parent([...symbols,'1101']),'PARENT_SYMBOL_SET_MISMATCH');
 check('wrong trade date',{...parent(),trade_date:'2026-10-12'},'PARENT_IDENTITY_MISMATCH');
 check('different writer',{...parent(),writer_run_id:'other'},'PARENT_IDENTITY_MISMATCH');
 check('late capture',{...parent(),captured_at:'2026-10-13T01:00:00Z'},'PARENT_TIME_INVALID');
 check('future observation',{...parent(),observed_at:'2026-10-13T01:00:00Z'},'PARENT_TIME_INVALID');
 check('observation after capture',{...parent(),observed_at:'2026-10-13T00:59:20Z'},'PARENT_TIME_INVALID');
 check('invalid observation',{...parent(),observed_at:'invalid'},'PARENT_VERIFIER_FAILED');
 const futureAck=parent();futureAck.writer_write_set.ack.committed_at='2026-10-13T01:00:00Z';
 check('future commit',futureAck,'PARENT_TIME_INVALID');
 console.log(JSON.stringify({ok:failures.length===0,fixture_only:true,checks:count,failures,natural_acceptance:false}));
 assert.equal(failures.length,0,'All closure contract cases must pass');
}finally{fs.rmSync(runtime,{recursive:true,force:true});}
