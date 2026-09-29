'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const journal=require('../lib/daytrade-source-status-journal'),{writeWithAcknowledgement,acknowledgeStored}=require('../lib/daytrade-source-status-ack');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'source-status-intent-'));
const row={source_name:'isolated',trade_date:'2026-09-29',updated_at:'2026-09-29T01:00:00Z',payload:{trade_date:'2026-09-29',canonical_run_id:'c',writer_run_id:'w',generation_id:'g',values:[1,2,3]}};
(async()=>{
 let cp,writes=0,reads=0;
 const options={row,onPrepared:r=>{cp=journal.prepare(root,r);},onAcknowledged:a=>journal.confirm(cp,a),write:async expected=>{writes++;assert.deepEqual(journal.read(cp),expected);const error=Error('timeout');error.name='TimeoutError';throw error;},read:async()=>{reads++;return [structuredClone(row)];}};
 const ack=await writeWithAcknowledgement(options);assert.equal(ack.mode,'exact_readback_after_timeout');assert.equal(writes,1);assert.equal(reads,1);
 const receipt=JSON.parse(fs.readFileSync(cp.file+'.ack.json'));assert.equal(receipt.complete,false);assert.equal(receipt.scope,'source_status_write_only');
 await assert.rejects(writeWithAcknowledgement(options),/ALREADY_PREPARED/);assert.equal(writes,1);
 const second={...row,updated_at:'2026-09-29T01:01:00Z'};let pending;
 await assert.rejects(writeWithAcknowledgement({...options,row:second,onPrepared:r=>{pending=journal.prepare(root,r);cp=pending;},onAcknowledged:a=>journal.confirm(pending,a),read:async()=>[]}),/ROW_COUNT/);
 assert.deepEqual(journal.read(pending),second);assert.equal(fs.existsSync(pending.file+'.ack.json'),false);
 assert.throws(()=>journal.confirm(pending,{mode:'exact_readback_after_timeout',writer_run_id:'other',generation_id:'g',verified_after_timeout:true}),/ACK_IDENTITY/);
 const damaged={...pending,row_sha256:'0'.repeat(64)};assert.throws(()=>journal.read(damaged),/HASH_MISMATCH/);
 const writesBeforeRecovery=writes;
 const recovery=await acknowledgeStored({row:journal.read(pending),read:async()=>[{...second,updated_at:'2026-09-29T01:01:00+00:00'}]});
 assert.equal(recovery.mode,'exact_readback_after_interruption');journal.confirm(pending,recovery);assert.equal(writes,writesBeforeRecovery);
 for(const actual of [{...second,payload:{...second.payload,generation_id:'newer'}},{...second,payload:{...second.payload,values:[1,2]}},{...second,updated_at:'2026-09-29T01:02:00Z'}]){
  await assert.rejects(acknowledgeStored({row:second,read:async()=>[actual]}),/CONTENT_MISMATCH/);
 }
 await assert.rejects(acknowledgeStored({row:second,read:async()=>[]}),/ROW_COUNT/);
 await assert.rejects(acknowledgeStored({row:second,read:async()=>[second,second]}),/ROW_COUNT/);
 await assert.rejects(acknowledgeStored({row:second,read:async()=>{throw Error('READ_UNAVAILABLE');}}),/READ_UNAVAILABLE/);
 let attempted=false;await assert.rejects(writeWithAcknowledgement({row,onPrepared:async()=>{throw Error('DISK_FULL');},write:async()=>{attempted=true;},read:async()=>[]}),/DISK_FULL/);assert.equal(attempted,false);
 console.log('PASS durable intent precedes write, exact timeout acknowledgement, duplicate write prevention, unresolved intent retention, hash/identity rejection and failed journal blocks write. No DB I/O.');
})().catch(e=>{console.error(e);process.exitCode=1;});
