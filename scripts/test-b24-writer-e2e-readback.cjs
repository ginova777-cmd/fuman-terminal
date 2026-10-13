'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const runtime=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]);fs.mkdirSync(output,{recursive:true});
const results=[];async function test(name,fn){try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.stack});}}
(async()=>{
 const status=JSON.parse(fs.readFileSync(path.join(runtime,'db-source_status.json'))).find(r=>r.payload?.event_verification)?.payload;assert(status);
 const runnerFile=fs.readdirSync(path.join(runtime,'data/scan-receipts')).find(n=>n.startsWith('module-runner-process-'));
 const runner=JSON.parse(fs.readFileSync(path.join(runtime,'data/scan-receipts',runnerFile))),events=status.event_verification;
 await test('actual_writer_two_symbols_independent_ack_before_runner',async()=>{
  assert.equal(events.length,2);const start=Date.parse(runner.checked_at)-runner.elapsed_ms;
  for(const e of events){assert.equal(e.process.exit,0);assert.equal(e.outbox.results[0].status,'ISOLATED_ACKED');assert(Date.parse(e.outbox.results[0].sink_ack_at)<start);}
  assert.equal(runner.exit,2);assert.equal(status.module_verifier_runner.selected_modules_passed,false);
 });
 await test('actual_wrapper_terminal_does_not_claim_modules_complete',async()=>{
  const dir=path.join(runtime,'data/writer-terminals/2026-10-12'),terminal=JSON.parse(fs.readFileSync(path.join(dir,fs.readdirSync(dir).find(n=>n.endsWith('.json')))));
  assert.equal(terminal.formal_modules_complete,false);assert.equal(terminal.input.refresh.success,true);assert.equal(terminal.input.verifier.success,true);
 });
 const E=require('../lib/mother-pool-event-evidence.cjs'),r=E.read(runtime,events[0].receipt),b=E.read(runtime,r.bundle_ref);
 const params={root:runtime,bundleRef:r.bundle_ref,currentFile:path.join(runtime,'event-evidence/current.json'),directory:path.join(runtime,'event-outbox'),testClock:true};
 let calls=0;const sink={kind:'isolated',deliver:async()=>{calls++;throw Error('UNEXPECTED_DELIVERY');}};
 await test('actual_writer_event_replay_no_second_sink_call',async()=>{const v=await require('../lib/run-b24-event-verification.cjs').run({...params,clock:()=>events[0].completed_at,sink});assert.equal(v.outbox.results[0].reason,'OLD_OCCURRENCE');assert.equal(calls,0);});
 await test('actual_writer_expired_source_rejected',async()=>{const source=E.read(runtime,b.sources.B13.db)[0];await assert.rejects(()=>require('../lib/run-b24-event-verification.cjs').run({...params,clock:()=>new Date(Date.parse(source.source_updated_at)+120001).toISOString(),sink}),/SOURCE_FRESHNESS_120S/);assert.equal(calls,0);});
 const handoff=require('../lib/run-b24-pre-runner-handoff.cjs').run;
 await test('handoff_order',async()=>{const order=[];const x=await handoff({deadline:10,clock:()=>1,refresh:async()=>order.push('refresh'),prepare:async()=>{order.push('prepare');return {jobs:[]};}});assert.deepEqual(order,['refresh','prepare']);assert.equal(x.whole_round_acceptance,'NOT_EVALUATED');});
 await test('refresh_failure_never_prepares',async()=>{let n=0;await assert.rejects(()=>handoff({deadline:10,clock:()=>1,refresh:async()=>{throw Error('ACK_FAILURE');},prepare:async()=>n++}),/ACK_FAILURE/);assert.equal(n,0);});
 await test('deadline_after_refresh_never_prepares',async()=>{let t=1,n=0;await assert.rejects(()=>handoff({deadline:10,clock:()=>t,refresh:async()=>{t=10;},prepare:async()=>n++}),/EVENT_HANDOFF_DEADLINE/);assert.equal(n,0);});
 await test('missing_deadline_rejected',async()=>{await assert.rejects(()=>handoff({deadline:NaN,clock:()=>1}),/EVENT_DEADLINE_REQUIRED/);});
 const report={scope:'FULL_WRITER_PROCESS_WITH_ISOLATED_HTTP_FACADE',tested_pair:'B13+B22',passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results,writer_runtime:runtime,runner:{exit:runner.exit,elapsed_ms:runner.elapsed_ms,checked_at:runner.checked_at},event_acks:events.map(e=>e.outbox.results[0]),formal_execution:false};
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exitCode=report.failed?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
