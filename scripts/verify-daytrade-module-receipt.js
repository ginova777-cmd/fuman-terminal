'use strict';
// Independent verifier: boolean flags are insufficient; each round needs
// immutable DB and anon paginated readback artifacts.
const fs=require('fs'),path=require('path');
const arg=n=>{const x=process.argv.find(v=>v.startsWith(`--${n}=`));return x?x.slice(n.length+3):null;};
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const moduleId=arg('module'),out=arg('out'),r1=arg('round1'),r2=arg('round2');
if(!moduleId||!out||!r1||!r2)throw Error('module out round1 round2 are required');
const registry=read(path.join(__dirname,'..','data','contracts','mother-pool-a01-b24-module-registry-v1.json'));
const contract=registry.modules?.[moduleId];if(!contract)throw Error(`MODULE_NOT_IN_REGISTRY:${moduleId}`);
const {reconcile}=require('../lib/mother-pool-minute-side-reconciliation');
const failures=[];const rounds=[read(r1),read(r2)];
const {validRound,formulaOk,minuteSideFormulaOk}=require('../lib/verify-mother-pool-module-round').createVerifier(moduleId);
if(!rounds.every(validRound))failures.push('ROUND_SCHEMA_OR_DB_ANON_ARTIFACT_INVALID');
for(const rr of rounds){for(const side of ['db_readback','anon_readback']){for(const pg of (rr[side]?.pages||[])){for(const row of (pg.rows||[])){if(!formulaOk(moduleId,row)||!minuteSideFormulaOk(moduleId,row))failures.push('FORMULA_OR_UNIT_INVALID');}}}}
if(new Set(rounds.map(r=>r.trade_date)).size!==1)failures.push('TRADE_DATE_MISMATCH');
if(new Set(rounds.map(r=>r.canonical_run_id)).size!==1)failures.push('CANONICAL_MISMATCH');
if(new Set(rounds.map(r=>r.writer_run_id)).size!==2)failures.push('WRITER_RUN_ID_NOT_DISTINCT');
if(new Set(rounds.map(r=>r.run_id)).size!==2)failures.push('RUN_ID_NOT_DISTINCT');
if(new Set(rounds.map(r=>r.generation_id)).size!==2)failures.push('WRITER_GENERATION_NOT_DISTINCT');
if(new Set(rounds.map(r=>r.snapshot_generation)).size!==2||new Set(rounds.map(r=>r.mother_pool_run_id)).size!==2)failures.push('SNAPSHOT_ID_NOT_DISTINCT');
const times=rounds.map(r=>Date.parse(r.observed_at));if(times.some(t=>!Number.isFinite(t))||!(times[1]>times[0]))failures.push('ROUND_TIME_ORDER_INVALID');
let openingRange=null,closeout=false,closeoutAt=null;
if(moduleId==='B22'){openingRange=rounds[1].opening_range;for(const r of rounds)if(!require('../lib/verify-module-opening-range').validAll(r.opening_range,r.trade_date,r.requested_symbols))failures.push('B22_OPENING_RANGE_INVALID');}
if(moduleId==='B18'){closeout=rounds[1].closeout===true;closeoutAt=rounds[1].closeout_at||null;if(!closeout||!closeoutAt||String(closeoutAt).slice(0,10)!==rounds[1].trade_date||Date.parse(closeoutAt)<=times[1])failures.push('B18_CLOSEOUT_INVALID');}
const result={module_id:moduleId,contract,trade_date:rounds[0].trade_date||null,canonical_run_id:rounds[0].canonical_run_id||null,rounds_verified:rounds,opening_range:openingRange,closeout,closeout_at:closeoutAt,source_contract_ok:failures.length===0,db_readback_ok:failures.length===0,anon_readback_ok:failures.length===0,natural_evidence:failures.length===0,replay:false,synthetic:false,look_ahead:false,failed_checks:[...new Set(failures)],first_blocker:failures[0]||null,status:failures.length?'blocked':'complete',complete:failures.length===0,exit_code:failures.length?1:0,verified_by:'verify-daytrade-module-receipt.js',checked_at:new Date().toISOString()};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result,null,2));process.exitCode=result.exit_code;
