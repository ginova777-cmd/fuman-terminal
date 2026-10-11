'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process'),assert=require('assert/strict');
const {select,revalidate,ENTRY,hash}=require('./collector-release-binding.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'dual-binding-')),prod=path.join(root,'repo'),authority=path.join(root,'authority.json');fs.mkdirSync(prod);
const git=(...a)=>cp.execFileSync('git',['-c','core.fsmonitor=false','-C',prod,...a],{windowsHide:true});
git('init');git('config','user.email','offline@example.invalid');git('config','user.name','Offline Test');git('config','core.autocrlf','false');fs.mkdirSync(path.join(prod,'scripts'));
const revisions=[];for(const text of ['old\n','new\n','unknown\n']){fs.writeFileSync(path.join(prod,ENTRY),text);git('add','.');git('commit','-m','fixture');revisions.push(git('rev-parse','HEAD').toString().trim());}
const c={prod,authority,expected:revisions[0],target:revisions[1],collector_release_bindings:{}};
for(const [i,stage] of ['expected','target'].entries()){const b=git('show',revisions[i]+':'+ENTRY);c.collector_release_bindings[stage]={release_sha:revisions[i],entry:ENTRY,blob_sha256:hash(b),runtime_sha256:hash(b)};}
c.collector_bindings_sha256=hash(JSON.stringify(c.collector_release_bindings));
const set=sha=>{git('checkout','--detach',sha);fs.writeFileSync(authority,JSON.stringify({productionRoot:prod,approvedProductionSha:sha}));};
const cases=[];function test(name,fn){fn();cases.push(name);}
test('old_stop',()=>{set(c.expected);assert.equal(select(c).stage,'expected');});
const proof=select(c);
test('new_start_and_rollback_stop',()=>{set(c.target);assert.equal(select(c).stage,'target');});
test('release_drift_between_observations',()=>assert.throws(()=>revalidate(c,proof),/CHANGED/));
test('old_restore',()=>{set(c.expected);assert.equal(select(c).runtime_sha256,c.collector_release_bindings.expected.runtime_sha256);});
test('unknown_release',()=>{set(revisions[2]);assert.throws(()=>select(c),/UNKNOWN/);set(c.expected);});
test('authority_drift',()=>{fs.writeFileSync(authority,JSON.stringify({productionRoot:prod,approvedProductionSha:c.target}));assert.throws(()=>select(c),/AUTHORITY_DRIFT/);set(c.expected);});
test('runtime_hash_wrong_for_release',()=>{const d=structuredClone(c);d.collector_release_bindings.expected.runtime_sha256=d.collector_release_bindings.target.runtime_sha256;d.collector_bindings_sha256=hash(JSON.stringify(d.collector_release_bindings));assert.throws(()=>select(d),/HASH_MISMATCH/);});
test('blob_hash_wrong',()=>{const d=structuredClone(c);d.collector_release_bindings.expected.blob_sha256='0'.repeat(64);d.collector_bindings_sha256=hash(JSON.stringify(d.collector_release_bindings));assert.throws(()=>select(d),/HASH_MISMATCH/);});
test('config_binding_unsealed',()=>{const d=structuredClone(c);d.collector_release_bindings.expected.runtime_sha256='0'.repeat(64);assert.throws(()=>select(d),/BINDINGS_HASH/);});
test('checkout_tamper',()=>{fs.writeFileSync(path.join(prod,ENTRY),'tampered');assert.throws(()=>select(c),/DIRTY/);});
console.log(JSON.stringify({status:'PASS',cases,formal_mutations:false,root}));
