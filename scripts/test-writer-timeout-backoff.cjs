'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const b=require('./writer-database-backoff.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'writer-backoff-')),file=path.join(root,'state.json');
let now=Date.parse('2026-09-30T00:00:00Z');
assert.equal(b.check(file,now).blocked,false);
assert.equal(b.transient('writer_node_timeout_seconds=278'),true);
assert.equal(b.transient('writer_exit_1 schema mismatch'),false);
const timeoutFile=path.join(root,'timeout.json');
assert.equal(b.failure(timeoutFile,'writer_node_timeout_seconds=278',now).recorded,true);
assert.equal(b.check(timeoutFile,now+1000).blocked,true);
for(const delay of [60000,120000,240000,300000,300000]) {
 const s=b.failure(file,'quotes_HTTP_522: secret must not persist',now);
 assert.equal(s.until-now,delay);assert.equal(b.check(file,now+delay-1).blocked,true);
 assert.equal(b.check(file,now+delay).blocked,false);now+=delay;
}
assert.equal(fs.readFileSync(file,'utf8').includes('secret'),false);
assert.equal(b.failure(file,'schema missing column',now).recorded,false);
b.success(file,now);assert.equal(b.check(file,now).failures,0);
assert.equal(b.failure(file,'AbortError',now).until-now,60000);
assert.equal(b.failure(file,'fetch failed',now+86400000).failures,1);
fs.writeFileSync(file,'broken');assert.throws(()=>b.check(file,now),/STATE_INVALID/);
fs.writeFileSync(file,'{}');assert.throws(()=>b.check(file,now),/STATE_INVALID/);
console.log('PASS: persistent cooldown, expiry, cap, success reset, day recovery, classification, corrupt-state fail-closed, secret exclusion; no network');
