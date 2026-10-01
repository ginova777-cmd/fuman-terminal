'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createCircuit,recoverTimedOutWrite}=require('./module-persistence-circuit.cjs');
const {transient}=require('./writer-database-backoff.cjs');
(async()=>{
 const ack={committed:true,plan_hash:'exact'};
 assert.equal(await recoverTimedOutWrite(async()=>ack),ack);
 let timeout;
 try{await recoverTimedOutWrite(async()=>{throw Error('MODULE_ACK_ROUND_COUNT');});}catch(e){timeout=e;}
 assert.equal(timeout.name,'TimeoutError');assert.equal(timeout.cause.message,'MODULE_ACK_ROUND_COUNT');
 assert(transient(timeout.message));
 const source=fs.readFileSync(require.resolve('./run-daytrade-source-writer.js'),'utf8').replace(/\r\n/g,'\n');
 const begin=source.indexOf('      for(const queued of inputs){'),end=source.indexOf('      const sideFile=',begin);
 assert(begin>0&&end>begin);
 const loop=source.slice(begin,end);
 // Execute the real Writer batch loop; only database I/O is replaced.
 for(const error of [timeout,Error('MODULE_RPC_HTTP_503'),TypeError('fetch failed'),Error('schema invalid'),null]){
  const moduleCircuit=createCircuit(),calls=[],result={payload:{module_persistence_errors:[]}};
  const frozenModuleInputs=['A03','A04','A05'].map(module_id=>({module_id}));
  const context={moduleCircuit,result,inputs:frozenModuleInputs,frozenModuleInputs,
   persistModuleInput:async input=>{moduleCircuit.assertHealthy();calls.push(input.module_id);if(error&&input.module_id==='A03'){moduleCircuit.record(error);throw error;}return ack;}};
  await vm.runInNewContext('(async()=>{'+loop+';moduleCircuit.assertHealthy();})()',context).catch(e=>{assert.equal(e,error);});
  const blocked=error&&transient(`${error.name}: ${error.message}`);
  assert.deepEqual(calls,blocked?['A03']:['A03','A04','A05']);
  assert.equal(moduleCircuit.blocked,Boolean(blocked));
 }
 const afterLoop=source.slice(end,source.indexOf('  writeModuleProducerReceipts',end));
 assert(afterLoop.includes('moduleCircuit.assertHealthy();'));
 assert(source.includes("moduleCircuit.record(error);recordModule({stage:'failed'"));
 assert(source.includes("recoverTimedOutWrite(async()=>{"));
 assert(source.includes('  moduleCircuit.assertHealthy();\n  // Independent module verification'));
 console.log('PASS: actual Writer loop stops after unconfirmed timeout/503/network failure; no later module writes; exact recovered ACK accepted; semantic gaps stay explicit; wrapper recognizes cooldown. No network.');
})().catch(e=>{console.error(e);process.exitCode=1;});
