'use strict';
const assert=require('assert/strict'),{reference}=require('../lib/txf-reference-publication.cjs'),{hash}=require('../lib/mother-pool-module-write-set'),{FUGLE,TAIFEX}=require('../lib/mother-pool-futures-catalogue');
const date='2026-10-02',nowMs=Date.parse(date+'T09:00:00+08:00');
const html='證券代號 股票期貨<tr>'+['CA','南亞公司','1303','南亞','●','','','◎','','','','2000','',''].map(x=>'<td>'+x+'</td>').join('')+'</tr>';
const base={contract:'mother_pool_futures_catalogue_v1',trade_date:date,run_id:'test-reference',observed_at:date+'T00:00:00Z',fugle_url:FUGLE,taifex_url:TAIFEX,raw_taifex_html:html,raw_fugle:{date,type:'FUTURE',exchange:'TAIFEX',session:'REGULAR',data:[{symbol:'CAFC7',contractType:'S',endDate:'2027-03-17'},{symbol:'TXFJ6',type:'FUTURE',contractType:'I',startDate:'2026-07-16',endDate:'2026-10-21',settlementDate:'2026-10-21',openDatetime:date+'T08:45:00+08:00',closeDatetime:date+'T13:45:00+08:00'}]}};
function seal(s){s.source_hash=hash({fugle:s.raw_fugle,taifex:s.raw_taifex_html});return s;}
const valid=reference(seal(structuredClone(base)),{tradeDate:date,nowMs});assert.equal(valid.future_symbol,'TXFJ6');assert.equal(valid.contract_month,'2026-10');assert.equal(valid.valid_until,date+'T05:45:00.000Z');
const cases=[s=>s.raw_fugle.date='2026-10-01',s=>s.raw_fugle.session='AFTERHOURS',s=>s.raw_fugle.data[1].endDate='2026-10-01',s=>delete s.raw_fugle.date,s=>delete s.raw_fugle.data[1].endDate,s=>s.raw_fugle.data[1].symbol='MTXJ6',s=>s.raw_fugle.data=[],s=>s.raw_fugle.data.push({...s.raw_fugle.data[1],symbol:'TXFK6'}),s=>s.raw_fugle.data[1].openDatetime=date+'T15:00:00+08:00'];
for(const mutate of cases){const s=structuredClone(base);mutate(s);assert.throws(()=>reference(seal(s),{tradeDate:date,nowMs}));}
const expiry=structuredClone(base);expiry.raw_fugle.data[1].endDate=date;expiry.raw_fugle.data[1].settlementDate=date;expiry.raw_fugle.data[1].closeDatetime=date+'T13:30:00+08:00';assert.equal(reference(seal(expiry),{tradeDate:date,nowMs}).valid_until,date+'T05:30:00.000Z');
console.log('PASS TXF mapping normal, stale catalogue, expiry, rollover validity boundary, conflict, empty, missing dates, non-TXF, night and wrong session time');
