'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {notificationCleanup}=require('./cleanup-extended-retention');
test('unreadable claims remain intact and deduplicate while eligible bodies compact',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cleanup-claims-'));
 const bad=path.join(root,'bad.json'),original=Buffer.alloc(669);fs.writeFileSync(bad,original);
 const healthy=path.join(root,'sent.json'),record={status:'sent',idempotencyKey:'old-delivery',payloadHash:'hash',recordedAt:'2020-01-01T00:00:00Z',body:'retired body'};fs.writeFileSync(healthy,JSON.stringify(record));
 const pending=path.join(root,'pending.json');fs.writeFileSync(pending,JSON.stringify({...record,status:'pending'}));
 const result=notificationCleanup(true,{contains:()=>false},root);
 assert.equal(result.compacted,1);assert.equal(result.protectedUnreadableCount,1);assert.equal(result.protectedReadbackOk,true);
 assert.deepEqual(fs.readFileSync(bad),original);assert.throws(()=>fs.openSync(bad,'wx'),{code:'EEXIST'});
 assert.equal(JSON.parse(fs.readFileSync(healthy)).idempotencyKey,record.idempotencyKey);
 assert.equal(JSON.parse(fs.readFileSync(healthy)).body,undefined);assert.equal(JSON.parse(fs.readFileSync(pending)).body,record.body);
 const verify=notificationCleanup(false,{contains:()=>false},root);assert.equal(verify.candidates,0);assert.deepEqual(verify.protectedUnreadable,result.protectedUnreadable);
});
test('a protected unreadable claim changing during cleanup fails closed',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cleanup-claims-'));
 fs.writeFileSync(path.join(root,'a.json'),Buffer.alloc(5));fs.writeFileSync(path.join(root,'b.json'),JSON.stringify({status:'sent',idempotencyKey:'key',payloadHash:'hash',recordedAt:'2020-01-01',body:'body'}));
 assert.throws(()=>notificationCleanup(false,{contains:()=>{fs.writeFileSync(path.join(root,'a.json'),'changed');return true;}},root),/protected_unreadable_claim_changed/);
});
