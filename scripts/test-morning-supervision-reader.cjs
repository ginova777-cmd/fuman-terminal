'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const {inspect}=require('./read-morning-supervision.cjs');
const stages=require('../lib/opening-report-stage-contract');
const authority=require('../lib/opening-report-receipt-authority');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'morning-reader-test-')),date='2026-10-16',day='20261016';
const put=(stage,name,value)=>{const dir=stages.directory(root,stage);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name+'-'+day+'.json'),JSON.stringify(value));};
assert.equal(inspect(root,date).status,'DATA_GAP');
for(const stage of ['us_0820','asia_0850']){
  const run_id='isolated-'+stage,delivery_content_hash='test-hash';
  put(stage,'opening-report-0830-final-receipt',{date,stage,run_id,delivery_content_hash});
  const core={contract:'opening-report-morning-single-verifier-v1',trade_date:date,stage,run_id,delivery_content_hash,require_current:true,canonical_verifier:authority.CONTRACT.canonical_command,complete:true,status:'complete',exitCode:0,failed_checks:[],first_blocker:null};
  put(stage,'morning-content-verification',{...core,phase:'content',scope:'morning_source_content_only'});
  put(stage,'opening-report-morning-contract-verifier',{...core,phase:'delivery',scope:'stage_delivery'});
  put(stage,'opening-report-0830-wrapper-receipt',{trade_date:date,stage,run_id,mode:'isolated_backtest',execution_mode:'scheduled',recovery:false,complete:true,exitCode:0});
}
const initial=inspect(root,date);assert.equal(initial.status,'READ_COMPLETE');assert.equal(initial.events.length,0);assert.equal(initial.artifacts.length,8);assert(initial.artifacts.every(a=>/^[a-f0-9]{64}$/.test(a.sha256)));
// Mutating an input during the independent hash readback suppresses all events.
const original=fs.readFileSync;let reads=0;
fs.readFileSync=function(file,...args){const bytes=original.call(fs,file,...args);if(++reads===9)return Buffer.from('{}');return bytes;};
let changed;try{changed=inspect(root,date);}finally{fs.readFileSync=original;}
assert.equal(changed.status,'INPUT_CHANGED');assert.equal(changed.events.length,0);
const again=inspect(root,date);assert.deepEqual(again.artifacts,initial.artifacts);assert.equal(again.notifications_sent,0);assert.equal(again.natural_ledger_updated,false);
assert.throws(()=>inspect(root,'../bad'),/INVALID_DATE/);
console.log(JSON.stringify({scope:'isolated_supervision_reader',complete:true,checks:['missing_receipts','isolated_not_notified','eight_raw_hashes','mutation_fail_closed','read_only','invalid_date'],fixture_root:root,real_notifications_sent:0,real_natural_days:0}));
