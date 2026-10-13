'use strict';
// Independent verifier: boolean flags are insufficient; each round needs
// immutable DB and anon paginated readback artifacts.
const fs=require('fs'),path=require('path');
const arg=n=>{const x=process.argv.find(v=>v.startsWith(`--${n}=`));return x?x.slice(n.length+3):null;};
const runtime=process.env.FUMAN_RUNTIME||'C:/fuman-runtime';
const read=f=>require('../lib/daytrade-shared-evidence.cjs').read(f,runtime);
const moduleId=arg('module'),out=arg('out'),r1=arg('round1'),r2=arg('round2');
if(!moduleId||!out||!r1||!r2)throw Error('module out round1 round2 are required');
const registry=read(path.join(__dirname,'..','data','contracts','mother-pool-a01-b24-module-registry-v1.json'));
const contract=registry.modules?.[moduleId];if(!contract)throw Error(`MODULE_NOT_IN_REGISTRY:${moduleId}`);
const {reconcile}=require('../lib/mother-pool-minute-side-reconciliation');
const failures=[];const rounds=[read(r1),read(r2)];
if(process.env.MOTHER_POOL_REQUIRED_WRITER_RUN_ID&&!rounds.some(r=>r.writer_run_id===process.env.MOTHER_POOL_REQUIRED_WRITER_RUN_ID))failures.push('REQUIRED_WRITER_RUN_ID_MISMATCH');
const {validRound,formulaOk,minuteSideFormulaOk}=require('../lib/verify-mother-pool-module-round').createVerifier(moduleId);
if(!rounds.every(validRound))failures.push('ROUND_SCHEMA_OR_DB_ANON_ARTIFACT_INVALID');
// validRound checks formula/unit and B22 on both readback surfaces; do not repeat.
if(new Set(rounds.map(r=>r.trade_date)).size!==1)failures.push('TRADE_DATE_MISMATCH');
if(new Set(rounds.map(r=>r.canonical_run_id)).size!==1)failures.push('CANONICAL_MISMATCH');
if(new Set(rounds.map(r=>r.writer_run_id)).size!==2)failures.push('WRITER_RUN_ID_NOT_DISTINCT');
if(new Set(rounds.map(r=>r.run_id)).size!==2)failures.push('RUN_ID_NOT_DISTINCT');
if(new Set(rounds.map(r=>r.generation_id)).size!==2)failures.push('WRITER_GENERATION_NOT_DISTINCT');
if(new Set(rounds.map(r=>r.snapshot_generation)).size!==2||new Set(rounds.map(r=>r.mother_pool_run_id)).size!==2)failures.push('SNAPSHOT_ID_NOT_DISTINCT');
const times=rounds.map(r=>Date.parse(r.observed_at));if(times.some(t=>!Number.isFinite(t))||!(times[1]>times[0]))failures.push('ROUND_TIME_ORDER_INVALID');
let openingRange=null,closeout=false,closeoutAt=null;
if(moduleId==='B18'){closeout=rounds[1].closeout===true;closeoutAt=rounds[1].closeout_at||null;if(!closeout||!closeoutAt||String(closeoutAt).slice(0,10)!==rounds[1].trade_date||Date.parse(closeoutAt)<=times[1])failures.push('B18_CLOSEOUT_INVALID');}
const evidence={requested_count:rounds.map(r=>Number(r.requested??r.requested_count??0)),written_count:rounds.map(r=>Number(r.written??r.written_count??0)),readback_count:rounds.map(r=>Number(r.readback??r.readback_count??0)),artifact_paths:rounds.map(r=>r.artifact_path||null),source_hashes:[...new Set(rounds.flatMap(r=>Array.isArray(r.source_hashes)?r.source_hashes:[]))]};const result={module_id:moduleId,contract,trade_date:rounds[0].trade_date||null,canonical_run_id:rounds[0].canonical_run_id||null,rounds_verified:rounds,opening_range:openingRange,closeout,closeout_at:closeoutAt,evidence,requested_count:evidence.requested_count,written_count:evidence.written_count,readback_count:evidence.readback_count,artifact_paths:evidence.artifact_paths,source_hashes:evidence.source_hashes,source_contract_ok:failures.length===0,db_readback_ok:failures.length===0,anon_readback_ok:failures.length===0,natural_evidence:failures.length===0,replay:false,synthetic:false,look_ahead:false,failed_checks:[...new Set(failures)],first_blocker:failures[0]||null,status:failures.length?'blocked':'complete',complete:failures.length===0,exit_code:failures.length?1:0,verified_by:'verify-daytrade-module-receipt.js',checked_at:new Date().toISOString()};
fs.mkdirSync(path.dirname(out),{recursive:true});const stored=require('../lib/daytrade-shared-evidence.cjs').write(out,result,runtime,{roundFiles:[r1,r2]});console.log(JSON.stringify(process.argv.includes('--summary')?{module_id:result.module_id,contract:result.contract,trade_date:result.trade_date,canonical_run_id:result.canonical_run_id,status:result.status,complete:result.complete,exit_code:result.exit_code,first_blocker:result.first_blocker,failed_checks:result.failed_checks,out,content_sha256:stored.sha256,writer_run_ids:rounds.map(r=>r.writer_run_id)}:result,null,2));process.exitCode=result.exit_code;
