'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {atomic,hash}=require('../lib/mother-pool-a16-io');
const {readReferences,ensureWarmup,summaryFile}=require('../lib/mother-pool-a16-writer');
const {a19}=require('../lib/preopen-a15-a19');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'a16-test-')),tradeDate='2026-09-18',symbols=[{symbol:'2330'}];
const ctx={runtime,tradeDate,symbols},file=summaryFile(runtime,tradeDate),get=()=>readReferences(ctx)[0];
assert.equal(get().symbol,'2330');assert.equal(get().status,'DATA_GAP');
const rows=[{symbol:'2330',db_readback_ok:true,anon_readback_ok:true,verifier_passed:true,requested_count:1084,written_count:1084,readback_count:1084,payload_sha256:"a".repeat(64),source_ready:true}];
const summary={contract:'mother_pool_a16_writer_summary_v1',trade_date:tradeDate,canonical_run_id:'fugle_daytrade_source:20260918:canonical',generation:'test-only',mode:'scheduled',requested_symbols:['2330'],requested_count:1,attempted_count:1,rows,rows_sha256:hash(rows)};
atomic(file,summary);assert.equal(get().status,'READY');assert.equal(a19({a16:[get()]}).complete,false);
for(const patch of [{mode:'acceptance_probe'},{trade_date:'2026-09-17'},{canonical_run_id:'wrong'},{rows_sha256:'bad'}]){atomic(file,{...summary,...patch});assert.equal(get().status,'DATA_GAP');}
const badRows=[{...rows[0],readback_count:1}];atomic(file,{...summary,rows:badRows,rows_sha256:hash(badRows)});assert.equal(get().status,'DATA_GAP');
const gapRows=[{...rows[0],source_ready:false,first_blocker:'SIDE_HISTORY_MISSING'}];atomic(file,{...summary,rows:gapRows,rows_sha256:hash(gapRows)});assert.equal(get().status,'INSUFFICIENT_SAMPLE');assert.equal(a19({a16:[get()]}).complete,false);
assert.equal(ensureWarmup({...ctx,root:'.',apply:true,now:new Date('2026-09-18T09:00:00+08:00')}).started,false);
assert.equal(ensureWarmup({...ctx,root:'.',apply:false,now:new Date('2026-09-18T06:00:00+08:00')}).started,false);
console.log('A16 Writer date, generation, readback, probe isolation and session guards passed; fixtures only');
for(const patch of [{requested_count:0,written_count:0,readback_count:0},{requested_count:undefined},{payload_sha256:null},{anon_readback_ok:false}]){
 const invalid=[{...rows[0],...patch}];atomic(file,{...summary,rows:invalid,rows_sha256:hash(invalid)});assert.equal(get().status,'DATA_GAP');
}
for(const patch of [{attempted_count:2},{requested_symbols:['2317']},{rows:[rows[0],rows[0]],attempted_count:2,rows_sha256:hash([rows[0],rows[0]])}]){
 atomic(file,{...summary,...patch});assert.equal(get().status,'DATA_GAP');
}
console.log('PASS A16 rejects empty/missing counts, missing hash, absent anon proof and ambiguous summary sets');
