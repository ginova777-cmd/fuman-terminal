'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict'),cp=require('child_process');
const {finalize}=require('./verify-institution-natural-origin.cjs'),link=require('../lib/institution-origin-link.cjs');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'origin-race-')),file=path.join(tmp,'institution.json');
const r={runId:'institution-20261012-test',marketDate:'20261012',status:'complete',complete:true,exitCode:0,total:2,scanned:2,triSurfaceStatus:'complete',recoveryReplay:false,naturalSlotComplete:false};for(const k of ['desktopRunId','mobileRunId','scorecardRunId'])r[k]=r.runId;
let passed=0;function test(name,fn){fn();passed++;console.log('PASS '+name);}
const proof={naturalSlotComplete:true,recoveryReplay:false,naturalEvidenceStatus:'VERIFIED'};
function run(receipt=r,collect=()=>proof){return finalize({file,run:receipt.runId,root:tmp,runtime:tmp,collect});}
test('post-comparison write cannot overwrite newer latest',()=>{
 fs.writeFileSync(file,JSON.stringify(r));const write=fs.writeFileSync;let inserted=false;
 fs.writeFileSync=function(p,...args){if(String(p).endsWith('.tmp')&&!inserted){inserted=true;write(file,JSON.stringify({...r,runId:'newer'}));}return write(p,...args);};
 try{run();}finally{fs.writeFileSync=write;}
 assert.equal(inserted,true);assert.equal(JSON.parse(fs.readFileSync(file)).runId,'newer');assert.equal(link.read(file,JSON.parse(fs.readFileSync(file))).naturalSlotComplete,false);
});
test('original exact receipt joins immutable proof',()=>assert.equal(link.read(file,r).naturalSlotComplete,true));
test('same run changed content rejects evidence',()=>assert.equal(link.read(file,{...r,matches:1}).naturalSlotComplete,false));
test('existing evidence cannot be replaced',()=>{fs.writeFileSync(file,JSON.stringify(r));const before=fs.readFileSync(link.proofPath(file,r),'utf8');assert.equal(run().reused,true);assert.equal(fs.readFileSync(link.proofPath(file,r),'utf8'),before);});
test('collect-time switch fails without writing latest',()=>{const fresh={...r,matches:27};fs.writeFileSync(file,JSON.stringify(fresh));assert.throws(()=>run(fresh,()=>{fs.writeFileSync(file,JSON.stringify({...r,runId:'next'}));return proof;}),/changed_during/);assert.equal(JSON.parse(fs.readFileSync(file)).runId,'next');});
test('actual TOM reader joins same receipt only',()=>{fs.writeFileSync(file,JSON.stringify(r));const manifest=path.join(tmp,'manifest.json');fs.writeFileSync(manifest,JSON.stringify({tasks:[{task:'institution',receipt:file,expected:{date:'2026-10-12'}}]}));const invoke=()=>JSON.parse(cp.execFileSync(process.execPath,[path.join(__dirname,'read-tom-strategy-receipts.cjs'),manifest],{encoding:'utf8'}));assert.equal(invoke().rows[0].complete,true);fs.writeFileSync(file,JSON.stringify({...r,matches:1,naturalSlotComplete:true}));assert.equal(invoke().rows[0].complete,false);});
console.log(JSON.stringify({ok:true,passed,scope:'isolated_no_network_no_production',tmp}));
