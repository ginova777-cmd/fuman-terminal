'use strict';
const assert=require('node:assert/strict');
const {freshFixture,materialize}=require('./test-mother-shared-water-evidence.cjs');
const {freeze}=require('../lib/mother-shared-water-freeze.cjs');
const {verifySeries}=require('../lib/mother-shared-water-series.cjs');
const {sha}=require('../lib/mother-shared-water-evidence.cjs');
const origin=Date.parse('2026-10-06T05:00:00Z');
function shift(value,ms){if(Array.isArray(value))return value.map(x=>shift(x,ms));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,shift(v,ms)]));if(typeof value==='string'&&/^2026-10-06T/.test(value))return new Date(Date.parse(value)+ms).toISOString();if(typeof value==='number'&&value>1e15)return value+ms*1000;return value;}
(async()=>{
 const samples=[];let expected;
 for(let i=0;i<=40;i++){
 const offset=i*15000,now=origin+offset,f=shift(freshFixture(),offset),b=materialize(f);
 const identity={...f.receipt,canonical_run_id:'canonical',mother_pool_run_id:'mother',snapshot_sequence:1,producer_version:'test-only',verification_run_id:'series-'+i};
 const capture={contract:'mother-shared-water-capture-v1',captured_at:new Date(now-4000).toISOString(),stored:true,authenticated:true,closed:false,connection_id:f.native.connection_id,rows:[{symbol:'1216',raw_utf8:b.raw.toString(),raw_sha256:sha(b.raw),transport_utf8:b.transport.toString(),transport_sha256:sha(b.transport)}]};
 const bundle=await freeze({identity,prioritySymbols:['1216'],snapshotBytes:Buffer.from(JSON.stringify({...identity,verification_run_id:undefined,status:'complete',complete:true,symbols:['1216']})),readCapture:async(options={})=>({...structuredClone(capture),captured_at:options.after?new Date(now+1).toISOString():capture.captured_at}),readback:async()=>({reader_role:'anon',complete:true,bytes:Buffer.from(JSON.stringify([f.publication.row]))}),writeCompletedAt:f.publication.write_completed_at,now:(()=>{let n=0;return ()=>now+(n++>1?2:0);})()});
 const bytes=Buffer.from(JSON.stringify(bundle.receipt));
 samples.push({readback_at:new Date(now+3).toISOString(),loaded:{transport_complete:true,receipt_bytes:bytes,resolve:ref=>bundle.blobs.get(ref),diagnostics:{run_id:identity.verification_run_id,receipt_sha256:sha(bytes)}}});
 expected={...identity,contract_version:'1.1.0',scope_definition_version:'full-priority-fixed-membership-v1',requested_symbols:['1216']};delete expected.verification_run_id;
 }
 const result=verifySeries(samples,{expected});assert.equal(result.evidence_continuity_verified,true,JSON.stringify(result.failed_checks));assert.equal(result.natural_acceptance,false);assert.equal(result.observed_duration_ms,600000);
 const gap=verifySeries(samples.filter((_,i)=>i<10||i>12),{expected});assert.equal(gap.evidence_continuity_verified,false);assert(gap.failed_checks.some(x=>x.startsWith('PUBLICATION_GAP:')));
 console.log(JSON.stringify({ok:true,cases:2,rounds:41,mode:'full_native_evidence_series_isolated',natural_acceptance:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
