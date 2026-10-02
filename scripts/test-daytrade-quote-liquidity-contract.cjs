const assert=require('node:assert/strict');
const {normalizeQuoteLiquidity:n}=require('../lib/daytrade-quote-liquidity-contract');
const e={value:7523,unit:'lots',event_at:'2026-10-02T05:24:58.348Z',source:'fugle.websocket.aggregates.total.tradeVolume',is_synthetic:false};
const row={symbol:'3163',trade_date:'2026-10-02',quote_seen_at:'2026-10-02T05:29:36.701Z',total_volume:1,payload:{total_volume_source_event_at:'2026-10-02T05:27:01.216Z',turnoverVolumeEvidence:e,tradeValueEvidence:{...e,value:5235218000,unit:'TWD',source:'fugle.websocket.aggregates.total.tradeValue'}}};
const x=n(row);assert.equal(x.total_volume,7523);assert.equal(x.payload.total_volume_source_event_at,e.event_at);assert.equal(x.quote_seen_at,row.quote_seen_at);assert.equal(x.payload.trade_value_unit,'TWD');assert.deepEqual(n(x),x);
for(const mutation of [{value:null},{value:''},{value:true},{value:-1},{unit:null},{is_synthetic:true},{is_synthetic:null},{event_at:'2026-10-01T02:00:00Z'},{source:'test'}]){const r=n({...row,payload:{turnoverVolumeEvidence:{...e,...mutation}}});assert.equal(r.total_volume,null);assert.equal(r.payload.total_volume_available,false);}
const zero=n({...row,payload:{turnoverVolumeEvidence:{...e,value:0}}});assert.equal(zero.total_volume,0);assert.equal(zero.payload.total_volume_available,true);
assert.equal(n({...row,payload:{}}).total_volume,null);
assert.equal(row.total_volume,1);
console.log('PASS: source time, no timestamp refresh, same-day identity, missing/type/unit/synthetic rejection, natural zero, immutable input and idempotence');
