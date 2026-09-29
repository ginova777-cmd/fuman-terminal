'use strict';
const assert=require('node:assert/strict');
const {retainable}=require('../lib/mother-pool-a16-checkpoint');
const {hash,compact}=require('../lib/mother-pool-a16-io');
const receipt={complete:true,trade_date:'2026-09-29',canonical_run_id:'c',symbol:'1301',calculated_at:'2026-09-29T00:00:00Z',rows:Array.from({length:1084},()=>({value:1}))};
const sha=hash(compact(receipt));
const previous={complete:true,generation:'g',mode:'scheduled',verifier:{complete:true,verification_passed:true},db:{readback_contract:'a16_db_anon_v2',db_readback_ok:true,anon_readback_ok:true,written_count:1084,readback_count:1084,payload_sha256:sha,readback_evidence:['DB','ANON'].map(role=>({role,checked_at:'2026-09-29T00:01:00Z',trade_date:receipt.trade_date,canonical_run_id:'c',symbol:'1301',generation:'g',payload_sha256:sha,row_count:1}))}};
const check=p=>retainable(p,receipt,'g','scheduled','2026-09-29T00:02:00Z');
assert.equal(check(previous),true);
for(const patch of [{checked_at:'2026-09-28T23:59:00Z'},{checked_at:'2026-09-29T00:03:00Z'},{symbol:'1303'},{canonical_run_id:'other'},{trade_date:'2026-09-28'},{generation:'other'},{payload_sha256:'0'.repeat(64)},{row_count:0},{role:'DB'}]){const p=structuredClone(previous);Object.assign(p.db.readback_evidence[1],patch);assert.equal(check(p),false);}
const gap=structuredClone(previous),gapReceipt={...receipt,complete:false,first_blocker:'INSUFFICIENT_SAMPLE'};
gap.complete=false;gap.verifier.complete=false;gap.db.payload_sha256=hash(compact(gapReceipt));for(const e of gap.db.readback_evidence)e.payload_sha256=gap.db.payload_sha256;
assert.equal(retainable(gap,gapReceipt,'g','scheduled','2026-09-29T00:02:00Z'),true);
assert.equal(gapReceipt.complete,false);gap.verifier.verification_passed=false;assert.equal(retainable(gap,gapReceipt,'g','scheduled','2026-09-29T00:02:00Z'),false);
for(const patch of [{readback_count:1083},{written_count:0},{anon_readback_ok:false},{readback_evidence:[]}]){const p=structuredClone(previous);Object.assign(p.db,patch);assert.equal(check(p),false);}
console.log('PASS A16 checkpoint: original dual-read evidence required; identity, time, count, hash and incomplete evidence rejected');
