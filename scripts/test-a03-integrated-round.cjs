'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const runtime=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]);
const reader=require('../lib/daytrade-shared-evidence.cjs'),verifier=require('../lib/verify-mother-pool-module-round').createVerifier('A03');
const dir=path.join(runtime,'data/scan-receipts/modules');
const rounds=fs.readdirSync(dir).filter(n=>n.startsWith('a03-')&&!n.includes('verified')).map(n=>reader.read(path.join(dir,n),runtime)).filter(r=>r.db_readback&&r.anon_readback);
const results=[];function test(name,fn){try{fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.message});}}
test('original_writer_rounds_reverified',()=>{assert(rounds.length>=2);rounds.forEach(r=>assert(verifier.validRound(r)));});
for(const [name,change] of [
 ['wrong_run',r=>r.writer_write_set.plan.source_evidence.input.identity.writer_run_id='OTHER'],
 ['wrong_generation',r=>r.writer_write_set.plan.source_evidence.input.identity.generation_id='OTHER'],
 ['missing_ack',r=>delete r.writer_write_set.ack],
 ['uncommitted_ack',r=>r.writer_write_set.ack.committed=false],
 ['missing_proof',r=>delete r.writer_write_set.plan.source_evidence],
 ['missing_source_verifier',r=>delete r.writer_write_set.plan.source_evidence.input.independent.sources.morning_second.verifier],
 ['empty_rows',r=>r.writer_write_set.plan.rows=[]],
 ['content_drift',r=>r.writer_write_set.plan.rows[0].union_count=999],
 ['formal_authorized_flag',r=>r.writer_write_set.plan.source_evidence.production_authorized=true]
])test(name,()=>{const r=structuredClone(rounds[0]);change(r);let accepted=false;try{accepted=verifier.validRound(r);}catch{}assert.equal(accepted,false);});
test('actual_writer_runner_and_terminal',()=>{const status=JSON.parse(fs.readFileSync(path.join(runtime,'db-source_status.json'))).find(r=>r.payload?.module_verifier_runner).payload;assert.equal(status.module_verifier_runner.selected_modules_passed,true);assert.equal(status.module_verifier_runner.exit_code,0);assert.equal(JSON.parse(fs.readFileSync(path.join(runtime,'execution.json'))).exit,0);});
fs.mkdirSync(output,{recursive:true});const result={scope:'ISOLATED_A03_ACTUAL_WRITER_ROUNDS',passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results,formal_execution:false};fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));process.exitCode=result.failed?1:0;
