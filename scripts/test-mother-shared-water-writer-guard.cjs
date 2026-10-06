'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createGuard}=require('../lib/mother-shared-water-writer-guard.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shared-water-guard-')),file=path.join(dir,'backoff.json');
const time=Date.parse('2026-10-06T01:00:00Z');let lease={ok:true,status:'claimed',leaseExpiresAt:new Date(time+60000).toISOString()};
try{
 const guard=createGuard({backoffFile:file,lease:()=>lease,tradeDate:'2026-10-06',now:()=>time});assert.equal(guard(),true);
 lease={...lease,leaseExpiresAt:new Date(time+45000).toISOString()};assert.equal(guard(),false);
 lease={ok:true,status:'lease_optional',leaseExpiresAt:new Date(time+60000).toISOString()};assert.equal(guard(),false);
 lease.status='claimed';fs.writeFileSync(file,JSON.stringify({contract:'writer_database_backoff_v1',failures:1,until:time+60000}));assert.equal(guard(),false);
 assert.equal(createGuard({backoffFile:file,lease:()=>lease,tradeDate:'2026-10-05',now:()=>time})(),false);
 fs.writeFileSync(file,'invalid');assert.throws(guard,/BACKOFF_STATE_INVALID/);
 console.log(JSON.stringify({ok:true,cases:6,mode:'isolated_guard',network_requests:0}));
}finally{if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(dir);}
