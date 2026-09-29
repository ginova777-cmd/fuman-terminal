'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const producer=require('../lib/mother-pool-daytrade-ratio'),official=require('../lib/mother-pool-official-daytrade-source');
function fixture(){
 const f=require('./test-mother-previous-ohlc').fixture(),date='2026-09-17',reports={};
 for(const market of ['TWSE','TPEX']){const payload={date:'20260917',stat:'OK',tables:[{fields:['證券代號','當日沖銷交易成交股數'],data:f.symbols.map(symbol=>[symbol,'500,000'])}]};reports[market]={market,source_date:date,source_url:official.urls(date)[market],http_status:200,fetched_at:'2026-09-18T06:00:00+08:00',payload,payload_sha256:official.digest(payload)};}
 return {...f,activeSymbols:f.symbols.map(symbol=>({symbol,market:'TWSE'})),officialSource:{source_date:date,reports}};
}
function round(f,plan){return {...f.identity,observed_at:f.asOf,writer_write_set:{plan}};}
if(require.main===module)(async()=>{
 let checks=0;const f=fixture(),p=producer.collect(f);assert(producer.verify(p.rows,round(f,p)));assert.equal(p.rows[0].daytrade_ratio_pct,50);assert.equal(p.rows[0].matched,true);checks++;
 for(const [name,change] of [['missing official',x=>x.officialSource.reports={}],['wrong source date',x=>x.officialSource.source_date='2026-09-16'],['zero total',x=>x.dailyVolumeMap.get('2330').daily_volume_evidence.rows[0].volume_lots=0],['future read',x=>x.dailyVolumeMap.get('2330').daily_ohlcv_read_at='2026-09-18T07:00:00+08:00'],['missing stock',x=>{x.officialSource.reports.TWSE.payload.tables[0].data=[];x.officialSource.reports.TWSE.payload_sha256=official.digest(x.officialSource.reports.TWSE.payload);}],['wrong url',x=>x.officialSource.reports.TWSE.source_url='https://other.invalid'],['tampered raw',x=>x.officialSource.reports.TWSE.payload.tables[0].data[0][1]='999'],['duplicate daily',x=>{const v=x.dailyVolumeMap.get('2330');v.daily_volume_evidence.rows.push(v.daily_volume_evidence.rows[0]);}]]){const x=fixture();change(x);const plan=producer.collect(x);assert(!producer.verify(plan.rows,round(x,plan)),name);checks++;}
 const low=fixture();low.officialSource.reports.TWSE.payload.tables[0].data[0][1]='499,999';low.officialSource.reports.TWSE.payload_sha256=official.digest(low.officialSource.reports.TWSE.payload);const lp=producer.collect(low);assert(producer.verify(lp.rows,round(low,lp)));assert.equal(lp.rows[0].matched,false);checks++;
 const corrupt=structuredClone(p);corrupt.rows[0].daytrade_ratio_pct=99;assert(!producer.verify(corrupt.rows,round(f,corrupt)));checks++;
 let requests=0;const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'a05-source-')),calendar=f.dailyVolumeMap.get('2330').daily_volume_evidence.calendar;
 const request=async url=>{requests++;return {status:200,json:async()=>f.officialSource.reports[url.includes('twse.com')?'TWSE':'TPEX'].payload};};
 await official.read({tradeDate:f.identity.trade_date,calendar,runtime,request,clock:()=>f.asOf});await official.read({tradeDate:f.identity.trade_date,calendar,runtime,request,clock:()=>f.asOf});assert.equal(requests,2);checks++;
 let errors=0;const badRuntime=fs.mkdtempSync(path.join(os.tmpdir(),'a05-error-'));const fail=async()=>{errors++;throw Error('isolated HTTP failure');};await official.read({tradeDate:f.identity.trade_date,calendar,runtime:badRuntime,request:fail});await official.read({tradeDate:f.identity.trade_date,calendar,runtime:badRuntime,request:fail});assert.equal(errors,2);checks++;
 console.log(JSON.stringify({checks,scope:'isolated_A05_official_ratio_and_shared_reader',production_complete:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={fixture};
