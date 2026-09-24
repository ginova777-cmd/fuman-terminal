'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {atomic,hash}=require('../lib/mother-pool-a16-io');
const {readReferences,ensureWarmup,summaryFile}=require('../lib/mother-pool-a16-writer');
const {a19}=require('../lib/preopen-a15-a19');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'a16-test-')),tradeDate='2026-09-18',symbols=[{symbol:'2330'}];
const ctx={runtime,tradeDate,symbols},file=summaryFile(runtime,tradeDate),get=()=>readReferences(ctx)[0];
assert.equal(get().symbol,'2330');assert.equal(get().status,'DATA_GAP');
const rows=[{symbol:'2330',db_readback_ok:true,anon_readback_ok:true,verifier_passed:true,written_count:1084,readback_count:1084,source_ready:true}];
const summary={contract:'mother_pool_a16_writer_summary_v1',trade_date:tradeDate,canonical_run_id:'fugle_daytrade_source:20260918:canonical',generation:'test-only',mode:'scheduled',rows,rows_sha256:hash(rows)};
atomic(file,summary);assert.equal(get().status,'READY');assert.equal(a19({a16:[get()]}).complete,true);
for(const patch of [{mode:'acceptance_probe'},{trade_date:'2026-09-17'},{canonical_run_id:'wrong'},{rows_sha256:'bad'}]){atomic(file,{...summary,...patch});assert.equal(get().status,'DATA_GAP');}
const badRows=[{...rows[0],readback_count:1}];atomic(file,{...summary,rows:badRows,rows_sha256:hash(badRows)});assert.equal(get().status,'DATA_GAP');
const gapRows=[{...rows[0],source_ready:false,first_blocker:'SIDE_HISTORY_MISSING'}];atomic(file,{...summary,rows:gapRows,rows_sha256:hash(gapRows)});assert.equal(get().status,'INSUFFICIENT_SAMPLE');assert.equal(a19({a16:[get()]}).complete,false);
assert.equal(ensureWarmup({...ctx,root:'.',apply:true,now:new Date('2026-09-18T09:00:00+08:00')}).started,false);
assert.equal(ensureWarmup({...ctx,root:'.',apply:false,now:new Date('2026-09-18T06:00:00+08:00')}).started,false);
console.log('A16 Writer date, generation, readback, probe isolation and session guards passed; fixtures only');
