'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const dedup=require('../lib/daytrade-daily-mirror-dedup.cjs');
const source=fs.readFileSync(path.join(__dirname,'run-daytrade-source-writer.js'),'utf8');
const body=source.slice(source.indexOf('async function syncDailyVolumeMirror('),source.indexOf('async function ensureOpening0901CandleEvidence'));
let memo=null,writes=0,fail=false,partial=false,date='2026-10-01';
const rows=new Map([['2330',{trade_date:'2026-09-30',volume:100,avg_volume5:200}]]);
function processInstance(){return vm.runInNewContext(body+';syncDailyVolumeMirror',{
 DRY_RUN:false,Date,Map,Set,require:()=>dedup,statePath:x=>x,taipeiDate:()=>date,
 nowIso:()=>new Date().toISOString(),normalizeCode:x=>String(x),readJson:()=>memo,
 writeJsonAtomic:(_file,value)=>{memo=value;},
 supabaseUpsert:async(_table,rows)=>{writes++;if(fail)throw Error('OFFLINE');return {written:partial?0:rows.length};}
 });}
(async()=>{
 await processInstance()(rows,['2330']);assert.equal(writes,1);
 assert.equal((await processInstance()(rows,['2330'])).reason,'unchanged_daily_volume');assert.equal(writes,1);
 rows.get('2330').volume=101;await processInstance()(rows,['2330']);assert.equal(writes,2);
 date='2026-10-02';await processInstance()(rows,['2330']);assert.equal(writes,3);
 memo.saved_at=new Date(Date.now()-31*60*1000).toISOString();await processInstance()(rows,['2330']);assert.equal(writes,4);
 const before=JSON.stringify(memo);rows.get('2330').volume=102;fail=true;
 await assert.rejects(processInstance()(rows,['2330']),/OFFLINE/);assert.equal(JSON.stringify(memo),before);
 fail=false;partial=true;await assert.rejects(processInstance()(rows,['2330']),/INCOMPLETE/);assert.equal(JSON.stringify(memo),before);
 partial=false;await processInstance()(rows,['2330']);assert.equal(memo.sha256,dedup.fingerprint([{symbol:'2330',market:'',trade_date:'2026-09-30',volume:102,avg_volume5:200,avg5_volume:200,daily_volume_status:'ready',source:'fugle_daytrade_writer:daily_volume_avg_full_market_mirror',payload:{source:'fugle_daytrade_writer:daily_volume_avg_full_market_mirror',activeOrdinaryStockUniverse:true}}]));
 memo={};await processInstance()(rows,['2330']);
 console.log('PASS actual Writer function: process restart, changed data, date rollover, expiry, failed/partial write, corrupt memo');
})().catch(e=>{console.error(e);process.exitCode=1;});
