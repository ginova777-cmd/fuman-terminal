'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),assert=require('assert');
const {validate,revalidate}=require('./junction-stop-identity.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'mp-stop-identity-')),physical=path.join(root,'physical'),alias=path.join(root,'prod');fs.mkdirSync(physical);fs.symlinkSync(physical,alias,'junction');
const name='fugle-futopt-websocket-collector.js',entry=path.join(physical,name);fs.writeFileSync(entry,'fixture');
const owner={contract:'futopt-stop-control-v1',pid:123,creation_time:'2026-10-09T00:00:00.1234567Z',epoch:'12345678-1234-1234-1234-123456789abc',entry,executable:process.execPath};
const input={owner,identity:{...owner},process:{pid:123,creation_time:owner.creation_time,executable:process.execPath,entry:path.join(alias,name),alive:true},approvedRoot:alias,approvedHash:crypto.createHash('sha256').update('fixture').digest('hex'),observedAt:1000};
const before=JSON.stringify(owner),frozen=validate(input,1000),cases=['junction_same_file'];assert.equal(revalidate(frozen,input,1000).stop_authorized,false);
function bad(name,change){const c=structuredClone(input);change(c);assert.throws(()=>validate(c,1000));cases.push(name)}
bad('PID',c=>c.process.pid++);bad('CreationDate',c=>c.process.creation_time='wrong');bad('epoch',c=>c.identity.epoch='other');bad('executable',c=>c.process.executable='other');bad('approved_hash',c=>c.approvedHash='0'.repeat(64));bad('dead_process',c=>c.process.alive=false);bad('stale',c=>c.observedAt=-10000);
const other=path.join(root,'other');fs.mkdirSync(other);fs.writeFileSync(path.join(other,name),'fixture');bad('same_basename_and_hash_other_file',c=>c.process.entry=path.join(other,name));
// Remove only the fixture junction, never its target tree.
fs.unlinkSync(alias);fs.symlinkSync(other,alias,'junction');assert.throws(()=>revalidate(frozen,{...input,owner:{...owner,entry:path.join(other,name)},identity:{...owner,entry:path.join(other,name)}},1000));cases.push('junction_retarget');
fs.unlinkSync(alias);fs.symlinkSync(physical,alias,'junction');fs.writeFileSync(entry,'changed');assert.throws(()=>revalidate(frozen,input,1000));cases.push('hash_drift');
assert.equal(JSON.stringify(owner),before);cases.push('owner_unchanged');
console.log(JSON.stringify({status:'PASS',cases,scope:'ISOLATED_IDENTITY_NOT_STOP_E2E',request_sent:false,fixture:root}));
