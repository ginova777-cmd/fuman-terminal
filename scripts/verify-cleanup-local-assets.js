"use strict";
const fs=require('fs'),lib=require('./cleanup-local-assets');
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','');
const file=process.argv.find(x=>x.startsWith('--receipt='))?.slice(10)||`C:/fuman-runtime/status/cleanup-local-assets-${date}.json`;
try{const p=JSON.parse(fs.readFileSync(file,'utf8'));const result=lib.verify(p);if(!Number.isFinite(Date.parse(p.checkedAt))||Date.parse(p.checkedAt)>Date.now()||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(p.checkedAt)).replaceAll('-','')!==date){result.ok=false;result.issues.push('receipt_not_current');}
if(!process.argv.some(x=>x.startsWith('--receipt='))){const parent=JSON.parse(fs.readFileSync(`C:/fuman-runtime/status/runtime-retention-${date}.json`,'utf8'));if(parent.applied!==true||parent.localAssets?.runId!==p.runId||lib.hash(JSON.stringify(parent.localAssets))!==lib.hash(JSON.stringify(p))){result.ok=false;result.issues.push('runtime_parent_receipt_mismatch');}}
console.log(JSON.stringify({...result,receipt:file},null,2));if(!result.ok)process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}
