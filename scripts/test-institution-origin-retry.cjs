'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {finalize}=require('./verify-institution-natural-origin.cjs'),link=require('../lib/institution-origin-link.cjs');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'origin-retry-')),file=path.join(tmp,'institution.json');
const r={runId:'institution-20261012-retry',marketDate:'20261012',status:'complete',complete:true,exitCode:0,total:1,scanned:1,triSurfaceStatus:'complete',recoveryReplay:false,naturalSlotComplete:false};for(const k of ['desktopRunId','mobileRunId','scorecardRunId'])r[k]=r.runId;
const good={naturalSlotComplete:true,recoveryReplay:false,naturalEvidenceStatus:'NATURAL_TRIGGER_VERIFIED'},bad={naturalSlotComplete:false,recoveryReplay:false,naturalEvidenceStatus:'TRIGGER_IDENTITY_UNVERIFIED'};
const before=JSON.stringify(r);fs.writeFileSync(file,before);
const run=proof=>finalize({file,run:r.runId,root:tmp,runtime:tmp,collect:()=>proof});
let passed=0;function check(name,fn){fn();passed++;console.log('PASS '+name);}
check('failed attempt leaves no consumable success',()=>{const x=run(bad);assert.equal(x.naturalSlotComplete,false);assert.ok(fs.existsSync(x.evidencePath));assert.equal(fs.existsSync(link.proofPath(file,r)),false);assert.equal(link.read(file,r).naturalSlotComplete,false);});
check('second failure preserves both attempts',()=>{run(bad);assert.equal(fs.readdirSync(path.join(tmp,'institution-origin-attempts')).length,2);});
check('same receipt recovers without scan or latest mutation',()=>{run(good);assert.equal(link.read(file,r).naturalSlotComplete,true);assert.equal(fs.readFileSync(file,'utf8'),before);});
check('success retry uses existing proof without recollect',()=>{const prior=fs.readFileSync(link.proofPath(file,r),'utf8');const x=finalize({file,run:r.runId,root:tmp,runtime:tmp,collect:()=>{throw Error('must not recollect');}});assert.equal(x.reused,true);assert.equal(fs.readFileSync(link.proofPath(file,r),'utf8'),prior);});
check('changed same-run receipt cannot borrow success',()=>{const changed={...r,matches:9};fs.writeFileSync(file,JSON.stringify(changed));run(bad);assert.equal(link.read(file,changed).naturalSlotComplete,false);});
check('recovery cannot publish natural proof',()=>{const recovery={...r,recoveryReplay:true};fs.writeFileSync(file,JSON.stringify(recovery));assert.equal(run(good).naturalSlotComplete,false);assert.equal(link.read(file,recovery).naturalSlotComplete,false);});
console.log(JSON.stringify({ok:true,passed,scope:'isolated_no_network_no_production',tmp}));
