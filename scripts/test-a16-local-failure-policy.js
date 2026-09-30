'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const policy=require('../lib/a16-local-failure-policy');
const files=new Map([['1216.json','original'],['1216-write-intent.json','immutable']]);
policy.saveArtifact({atomic:(f,x)=>files.set(path.basename(f),x),path,receiptDir:'isolated',symbol:'1216',artifact:{receipt:{trade_date:'2026-09-30'},generation:'test',mode:'test',complete:false},failure:'A16_WRITE_INTENT_CONFLICT',checkedAt:'2026-09-30T00:00:00Z'});
assert.equal(files.get('1216.json'),'original');
assert.equal(files.get('1216-write-intent.json'),'immutable');
assert.equal(files.get('1216-failure.json').complete,false);
const visited=[];
for(const [symbol,failure] of [['1216','A16_WRITE_INTENT_CONFLICT'],['1217',null],['1218','A16_DATABASE_HTTP_503'],['1219',null]]) {visited.push(symbol);if(policy.shouldStop(failure,200))break;}
assert.deepEqual(visited,['1216','1217','1218']);
for(const status of [401,403,429])assert.equal(policy.shouldStop('A16_WRITE_INTENT_CONFLICT',status),true);
for(const failure of ['TimeoutError','AbortError','unknown','A16_DB_READBACK_MISMATCH'])assert.equal(policy.shouldStop(failure,200),true);
assert.equal(policy.shouldStop(null,200),false);
console.log('PASS local conflict preserves original evidence and continues; service/unknown failure stops');
