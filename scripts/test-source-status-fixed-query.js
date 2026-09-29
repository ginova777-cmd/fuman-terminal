'use strict';
const assert=require('node:assert/strict');
const {fixedReadQuery}=require('../lib/daytrade-source-status-ack');
const row={source_name:'a&b',trade_date:'2026-09-29',updated_at:'2026-09-29T01:00:00Z',payload:{trade_date:'2026-09-29',canonical_run_id:'c:1',writer_run_id:'w&x',generation_id:'g+1'}};
const query=new URLSearchParams(fixedReadQuery(row));
for(const key of Object.keys(row.payload))assert.equal(query.get('payload->>'+key),'eq.'+row.payload[key]);
assert.equal(query.get('source_name'),'eq.a&b');assert.equal(query.get('limit'),'2');
assert.equal(query.get('select'),Object.keys(row).join(','));
for(const key of Object.keys(row.payload)){const bad=structuredClone(row);delete bad.payload[key];assert.throws(()=>fixedReadQuery(bad),/IDENTITY_MISSING/);}
assert.throws(()=>fixedReadQuery({...row,trade_date:'2026-09-28'}),/IDENTITY_INVALID/);
const fs=require('node:fs');assert(fs.readFileSync(require.resolve('./run-daytrade-source-writer'),'utf8').includes("require('../lib/daytrade-source-status-ack').fixedReadQuery(row)"));
console.log('PASS fixed source-status server-side identity filters, complete projection, encoding and actual Writer wiring');
