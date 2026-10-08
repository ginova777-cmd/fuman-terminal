'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path');const {build}=require('./native-resources.cjs'),{verifyResource}=require('./resource-provenance.cjs'),{hash,bytes}=require('./offline-store.cjs');
const symbol='2330',trade_date='2026-10-08',epoch='test',asOf='2026-10-08T13:00:00+08:00',raw={daily:[],intraday:[],levelInput:null,poolRow:{}};
const input={symbol,trade_date,epoch,asOf,...raw,sources:{symbol,trade_date,epoch,as_of:asOf,available_at:asOf,sha256:hash(bytes(raw)),source:'OFFLINE_EMPTY_SOURCE',version:'1'}};
const events=build(input);assert.equal(events.length,2);for(const e of events)verifyResource(e,{epoch,trade_date,asOf});assert.equal(events[0].payload.source_ready,false);
assert.throws(()=>build({...input,sources:{...input.sources,epoch:'bad'}}),/IDENTITY/);assert.throws(()=>verifyResource({...events[0],payload:{forged:true}},{epoch,trade_date,asOf}),/PROVENANCE/);
fs.writeFileSync(path.join(__dirname,'native-resource-tests.json'),JSON.stringify({status:'PASS',cases:3,scope:'original pure native formulas, empty-source UNKNOWN and source hash/as-of binding; populated source accuracy still requires evidence'},null,2));console.log('native source tests PASS');
