'use strict';
// Upstream response fixtures for testing the MORNING consumer only.
// These are never evidence of Mother Pool execution or independent DB verification.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
function context(runtime){
  assert(path.resolve(runtime).startsWith(path.resolve(__dirname,'../outputs/morning-contract-20261018')+path.sep));
  const stage=process.env.FUMAN_MORNING_STAGE;assert(['us_0820','asia_0850'].includes(stage));
  const dir=path.join(runtime,'data/opening-report-stages',stage),date='2026-10-16',day='20261016';
  const source=JSON.parse(fs.readFileSync(path.join(dir,`opening-report-0830-overseas-leaders-${day}.json`)));
  return {dir,date,day,run:source.run_id};
}
function save(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2));return value;}
function handoff(runtime){
  const {dir,date,day,run}=context(runtime),file=path.join(dir,'scan-receipts',`opening-report-0830-mother-pool-handoff-ack-${day}.json`);
  return save(file,{scope:'isolated_upstream_response_fixture',contract:'opening-report-0830-mother-pool-handoff-ack-v2',ok:true,complete:true,db_readback_ok:true,first_blocker:null,trade_date:date,report_run_id:run,disposition_contract:'opening-report-handoff-dispositions-v1',accepted_count:0,accepted_readback_count:0,business_excluded_symbols:[],formal_candidate_count:0,formal_candidate_allowed:false,forbidden_publish_guard:true,missing_fields:[],checked_at:new Date(Date.now()-4000).toISOString(),receipt_path:file});
}
function persistence(runtime){
  const {dir,date,day,run}=context(runtime),scan=path.join(dir,'scan-receipts'),file=path.join(scan,`opening-report-0830-mother-pool-persistence-ack-${day}.json`),readback=path.join(scan,'isolated-persistence-readback.json');
  const times=[new Date(Date.now()-2000).toISOString(),new Date(Date.now()-1000).toISOString()];
  save(readback,{scope:'isolated_upstream_response_fixture',complete:true,db_readback_ok:true,trade_date:date,report_run_id:run,checked_at:new Date().toISOString(),db_readback_symbols:[]});
  const receipt=save(file,{scope:'isolated_upstream_response_fixture',contract:'opening-report-0830-mother-pool-persistence-ack-v1',complete:true,db_readback_ok:true,first_blocker:null,report_run_id:run,trade_date:date,required_writer_refreshes:2,writer_refreshes_observed:2,writer_refresh_timestamps:times,checked_at:new Date().toISOString(),missing_fields:[],db_readback_symbols:[],handoff_ack_receipt:path.join(scan,`opening-report-0830-mother-pool-handoff-ack-${day}.json`),persistence_readback_receipt:readback});
  const finalPath=path.join(dir,`opening-report-0830-final-receipt-${day}.json`),final=JSON.parse(fs.readFileSync(finalPath));
  Object.assign(final,{contract:'opening_report_0830_complete_v1',mother_pool_persistence_ack_receipt:file,mother_pool_persistence_ack:receipt,mother_pool_persistence_ack_ok:true,complete:false,status:'waiting_canonical_verifier',report_status:'WAITING_CANONICAL_VERIFIER',first_blocker:'canonical_verifier_pending',exitCode:0});save(finalPath,final);
  return receipt;
}
module.exports={handoff,persistence};
if(require.main===module)console.log(JSON.stringify(persistence(process.env.FUMAN_RUNTIME_DIR)));
