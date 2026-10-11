'use strict';
const fs=require('fs'),path=require('path'),{normalize}=require('../lib/tom-acceptance.cjs');
const registry=require('../lib/tom-strategy-map.cjs');
// Explicit inputs only: no scans, network, directory-wide inventory or scheduler changes.
const manifestPath=process.argv[2];if(!manifestPath)throw Error('manifest_required');
if(fs.statSync(manifestPath).size>262144)throw Error('manifest_too_large');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8').replace(/^\uFEFF/,''));
const asOf=process.argv.find(a=>a.startsWith('--as-of='))?.slice(8);
if(asOf){if(manifest.asOfDate!==asOf)throw Error('manifest_date_mismatch');manifest.requireFormalMapping=true;}
if(!Array.isArray(manifest.tasks)||manifest.tasks.length===0||manifest.tasks.length>64)throw Error('bounded_task_manifest_required');
if(new Set(manifest.tasks.map(t=>t.task)).size!==manifest.tasks.length)throw Error('duplicate_task');
for(const t of manifest.tasks)if(!t.task||!t.expected||!/^\d{4}-\d{2}-\d{2}$/.test(t.expected.date)||typeof t.receipt!=='string')throw Error('invalid_task_manifest');
let totalBytes=0;
const rows=manifest.tasks.map(t=>{const policyMapping=registry[t.task];if(policyMapping?.scope==='REMOTE_UNVERIFIED')return {...normalize(t.task,null,t.expected),verification:'REMOTE_UNVERIFIED',first_blocker:null,excludedFromDailyDenominator:true,evidence_path:null,readError:null,receiptRead:false,mapping:policyMapping};if(policyMapping?.scope==='PAUSED_BY_USER'||require('../lib/module-usage-policy.cjs').isPaused(t.task))return {...normalize(t.task,null,{...t.expected,paused:true}),excludedFromDailyDenominator:true,evidence_path:t.receipt,readError:null,receiptRead:false,mapping:policyMapping||null};let receipt=null;let readError=null;try{const size=fs.statSync(t.receipt).size;totalBytes+=size;if(size>4*1024*1024||totalBytes>16*1024*1024)throw Error('receipt_read_budget_exceeded');receipt=JSON.parse(fs.readFileSync(t.receipt,'utf8').replace(/^\uFEFF/,''));}catch(e){readError=e.code==='ENOENT'?'receipt_missing':'receipt_unreadable';}const r={...normalize(t.task,receipt,t.expected),evidence_path:t.receipt,readError};const mapping=registry[t.task];if(mapping?.scope==='UNVERIFIED'||(!mapping&&manifest.requireFormalMapping===true))return {...r,complete:false,verification:'UNVERIFIED',first_blocker:'formal_scope_unverified',mapping};if(mapping?.receipt&&path.basename(t.receipt)!==mapping.receipt&&manifest.requireFormalMapping===true)return {...r,complete:false,verification:'UNVERIFIED',first_blocker:'final_receipt_mapping_mismatch',mapping};return {...r,mapping:mapping||null};});
console.log(JSON.stringify({contract:'tom-strategy-observation-v1',scope:'receipt_only',rows,complete:rows.every(r=>(r.mapping?.scope==='REMOTE_UNVERIFIED'&&r.excludedFromDailyDenominator===true)||r.complete||['PAUSED_BY_USER','NOT_DUE','SKIPPED_NON_TRADING_DAY'].includes(r.verification)),networkCalls:0,scannerStarted:false},null,2));



