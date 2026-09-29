'use strict';
const assert=require('node:assert/strict'),{verify}=require('../lib/mother-pool-recovery-lease');
const expected={sourceName:'fugle_daytrade_source',hostId:'approved-host',instanceId:'writer-1',tradeDate:'2026-09-29',now:'2026-09-29T00:00:00Z'};
const row={source_name:expected.sourceName,writer_host_id:expected.hostId,writer_instance_id:expected.instanceId,trade_date:expected.tradeDate,lease_expires_at:'2026-09-29T00:00:01Z'};
assert.equal(verify([row],expected),true);
for(const field of ['source_name','writer_host_id','writer_instance_id','trade_date'])assert.throws(()=>verify([{...row,[field]:'other'}],expected),/OWNER_MISMATCH/);
for(const lease_expires_at of [expected.now,'invalid','2026-09-28T23:59:59Z'])assert.throws(()=>verify([{...row,lease_expires_at}],expected),/EXPIRED/);
for(const rows of [[],[row,row],null])assert.throws(()=>verify(rows,expected),/ROW_COUNT/);
console.log('PASS recovery lease: exact owner/date, expiry boundary, missing/duplicate lease fail closed');
