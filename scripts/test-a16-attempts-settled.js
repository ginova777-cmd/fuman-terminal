'use strict';
const assert=require('node:assert/strict'),{hash}=require('../lib/mother-pool-a16-io'),{settled}=require('../lib/a16-attempts-settled');
const universe={trade_date:'2026-09-29',canonical_run_id:'c',symbols:['2330'],scope:'writer_active_symbols'};
const row={symbol:'2330',db_readback_ok:true,anon_readback_ok:true,verifier_passed:true,requested_count:1084,written_count:1084,readback_count:1084,payload_sha256:'a'.repeat(64),source_ready:false};
const summary={contract:'mother_pool_a16_writer_summary_v1',mode:'scheduled',trade_date:universe.trade_date,canonical_run_id:'c',universe_sha256:hash(universe),requested_symbols:['2330'],requested_count:1,attempted_count:1,rows:[row],rows_sha256:hash([row])};
assert.equal(settled(summary,universe),true); // Verified sample gaps stay gaps; do not re-fetch without cause.
for(const change of [{db_readback_ok:false},{anon_readback_ok:false},{verifier_passed:false},{readback_count:0},{symbol:'2317'}]){const rows=[{...row,...change}];assert.equal(settled({...summary,rows,rows_sha256:hash(rows)},universe),false);}
for(const change of [{trade_date:'2026-09-28'},{mode:'probe'},{rows_sha256:'bad'},{requested_symbols:['2317']}])assert.equal(settled({...summary,...change},universe),false);
assert.equal(require('../lib/a16-resume-budget').budget({attempts:2},summary).allowed,false);
console.log('PASS A16 failed readbacks do not settle warmup; verified sample gaps and legacy retry budget preserved');
