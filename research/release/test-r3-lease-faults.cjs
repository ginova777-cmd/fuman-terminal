'use strict';
const assert=require('assert/strict'),{readLease,assertBoundary}=require('./r3-lease-reader.cjs');
const expected={source_name:'source',writer_host_id:'host',writer_instance_id:'instance',trade_date:'2026-10-09'},at=Date.now();
const valid={...expected,lease_expires_at:new Date(at-60000).toISOString(),lease_remaining_seconds:0};
async function run(){let n=0;const query=async(row=valid,headers={},status=200)=>readLease({base:'https://example.invalid/rest/v1',expected,now:at,fetchImpl:async(u,o)=>{assert.equal(o.method,'GET');assert(!String(u).includes('/rpc/'));return new Response(JSON.stringify([row]),{status,headers:{date:new Date(at).toUTCString(),'content-range':'0-0/1',...headers}});}});
 assert.equal((await query()).status,'RELEASED');n++;
 assert.equal((await query({...valid,lease_expires_at:new Date(at+60000).toISOString(),lease_remaining_seconds:60})).status,'ACTIVE');n++;
 for(const row of [{...valid,writer_instance_id:'other'},{...valid,trade_date:'2026-10-08'},{...valid,lease_remaining_seconds:'0'},{...valid,lease_expires_at:'invalid'}]){assert.equal((await query(row)).status,'UNKNOWN');n++;}
 for(const headers of [{'content-range':'0-1/2'},{date:new Date(at-60000).toUTCString()}]){assert.equal((await query(valid,headers)).status,'UNKNOWN');n++;}
 assert.equal((await query(valid,{},403)).status,'UNKNOWN');n++;
 assert.equal((await readLease({base:'https://example.invalid/rest/v1',expected,fetchImpl:async()=>{throw Error('offline')}})).status,'UNKNOWN');n++;
 const b={lease:await query(),inventory:{complete:true,unknown_pids:[]},locks:{verified:true,owner_verified:true},writerExited:true};assertBoundary(b);n++;
 for(const bad of [{lease:{status:'CLAIM'}},{lease:{status:'ACTIVE'}},{lease:{status:'UNKNOWN'}},{lease:{...b.lease,checked_at:new Date(at-60000).toISOString()}},{writerExited:false},{inventory:{complete:true,unknown_pids:[123]}},{locks:{verified:true,owner_verified:false}}]){assert.throws(()=>assertBoundary({...b,...bad}));n++;}
 console.log(JSON.stringify({status:'PASS',cases:n,formal_http_requests:0,scope:'SCHEMA_AND_READBACK_FAULTS'}));
}
run().catch(e=>{console.error(e);process.exitCode=1;});
