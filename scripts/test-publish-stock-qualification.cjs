'use strict';
const assert=require('node:assert/strict');
const {publishStockQualification:publish}=require('../lib/publish-stock-qualification.cjs');
const date='2026-10-02',evidence=symbol=>({contract:'fugle-stock-qualification-v1',symbol,trade_date:date,raw_json_sha256:symbol.padEnd(64,'0')});
const read=(dir,symbol)=>symbol==='9999'?{ok:false,reason:'MISSING'}:{ok:true,evidence:evidence(symbol)};
let calls=[];
const rpc=async(name,{p_rows})=>{calls.push(p_rows);assert.equal(name,'publish_fugle_stock_qualification_v1');return p_rows.map(r=>({symbol:r.symbol,trade_date:date,raw_json_sha256:r.evidence.raw_json_sha256}));};
(async()=>{
 const options={directory:'unused',tradeDate:date,read,rpc,stockRows:[{symbol:'3163',payload:{other:'preserved',fugle_qualification:evidence('3163')}},{symbol:'2330'},{symbol:'9999'}]};
 let result=await publish(options);assert.equal(calls.length,0);assert.equal(result.unchanged_count,1);assert.equal(result.pending_count,1);assert.equal(result.missing_count,1);
 result=await publish({...options,apply:true});assert.equal(result.written_count,1);assert.equal(calls[0][0].symbol,'2330');assert.equal(result.complete,false);assert.equal(options.stockRows[0].payload.other,'preserved');
 calls=[];const large=Array.from({length:251},(_,i)=>({symbol:String(1000+i)}));
 result=await publish({...options,stockRows:large,apply:true});assert.equal(calls.length,4);assert.equal(result.written_count,200);assert.equal(result.deferred_count,51);
 calls=[];await assert.rejects(publish({...options,stockRows:large,apply:true,rpc:async(name,body)=>{if(calls.length===1){calls.push('failed');throw Error('522');}return rpc(name,body);}}),/522/);assert.equal(calls.length,2);
 await assert.rejects(publish({...options,apply:true,rpc:async()=>[]}),/ACK_COUNT/);
 await assert.rejects(publish({...options,apply:true,rpc:async()=>[{symbol:'2330',trade_date:'2026-10-01',raw_json_sha256:evidence('2330').raw_json_sha256}]}),/ACK_IDENTITY/);
 await assert.rejects(publish({...options,stockRows:[{symbol:'3163'},{symbol:'3163'}]}),/DUPLICATE_MASTER/);
 console.log('PASS: only changed qualifications publish; dry-run, 50-row batches/200-row cap, missing evidence, fail-stop and acknowledgement identity.');
})().catch(error=>{console.error(error);process.exitCode=1;});
