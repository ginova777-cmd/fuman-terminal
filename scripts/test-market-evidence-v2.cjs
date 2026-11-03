'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const {assess,verify,SOURCE_URL}=require('./market-emergency-status.cjs');
const {buildOverride}=require('./update-market-calendar-auto-override');
const html=(status,date='115年 10月 23日',county='臺北市')=>`<html>${date} 天然災害停止上班及上課情形<br>更新時間：2026/10/23 08:00:00<br>${county} ${status}</html>`;
for(const status of ['今天停止上班、停止上課。','今天上午停止上班、停止上課。','今天已達停止上班及上課標準。']) {
 const d=assess(html(status),'2026-10-23');assert.equal(d.isTradingDay,false);assert.deepEqual(verify(d),d);
 const row=buildOverride({date:d.date,source:SOURCE_URL,matchedAreas:[{county:'臺北市'}],html:html(status)});
 assert.deepEqual(verify({date:d.date,isTradingDay:row.marketOpen,row}),d);
 for(const key of ['sourceSha256','effectiveAt','announcementDate','sourceUrl','statusText'])assert.throws(()=>verify({...d,row:{...d.row,[key]:'tampered'}}));
}
for(const status of ['今天照常上班、照常上課。','今天未達停止上班及上課標準。'])assert.equal(assess(html(status),'2026-10-23').isTradingDay,true);
for(const status of ['今天下午停止上班、停止上課。','今天晚上停止上班。','今天部分地區停止上班。','士林區今天停止上班。','今天停止上課。','今天尚未宣布。'])assert.throws(()=>assess(html(status),'2026-10-23'));
assert.throws(()=>assess(html('今天停止上班。','115年 10月 22日'),'2026-10-23'),/DATE_MISMATCH/);
assert.throws(()=>assess(html('今天停止上班。','115年 10月 23日','新北市'),'2026-10-23'));
assert.equal(assess(html('今天照常上班。 明天停止上班、停止上課。'),'2026-10-24').isTradingDay,false);
assert.equal(assess(html('今天照常上班。 明天停止上班、停止上課。'),'2026-10-23').isTradingDay,true);
assert.throws(()=>assess(html('今天停止上班。 明天照常上班。'),'2026-10-25'),/DATE_MISMATCH/);
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'market-evidence-v2-'));
fs.mkdirSync(path.join(tmp,'state'));fs.mkdirSync(path.join(tmp,'data'));
fs.writeFileSync(path.join(tmp,'state/twse-holiday-schedule-2026.json'),JSON.stringify({cachedAt:new Date().toISOString(),rows:[{Date:'1150101',Name:'fixture',Description:'市場無交易'}]}));
const preload=path.join(tmp,'fetch.cjs');
fs.writeFileSync(preload,`global.fetch=async()=>{if(process.env.TEST_FETCH_FAIL)throw Error('TEST_SOURCE_DOWN');return {ok:true,url:${JSON.stringify(SOURCE_URL)},text:async()=>process.env.TEST_HTML};};`);
const override=path.join(tmp,'data/market-calendar-overrides.json');
const env={...process.env,FUMAN_RUNTIME_DIR:tmp,FUMAN_DATA_DIR:path.join(tmp,'data'),FUMAN_STATE_DIR:path.join(tmp,'state'),FUMAN_MARKET_CALENDAR_OVERRIDE_FILE:override};
function run(file,args,extra={}){return cp.spawnSync(process.execPath,['--require',preload,path.join(root,'scripts',file),...args],{encoding:'utf8',env:{...env,TEST_HTML:html('今天已達停止上班及上課標準。'),...extra}});}
let r=run('update-market-calendar-auto-override.js',['--apply','--now=2026-10-23T08:10:00+08:00']);assert.equal(r.status,0,r.stderr);
assert.equal(JSON.parse(fs.readFileSync(override)).overrides[0].evidenceContract,'dgpa-market-evidence-v2');
const stages=['morning-us_0820','morning-tw_0850','strategy3','strategy4','strategy5','buy-sell','scorecard-1315','scorecard-1700','scorecard-2140','recovery'];
for(const stage of stages){r=run('write-market-status-receipt.js',[`--stage=${stage}`,'--trade-date=2026-10-23']);assert.equal(r.status,10,r.stderr);const p=JSON.parse(r.stdout);assert.equal(p.status,'SKIPPED');assert.equal(p.sourceVerified,true);}
// Legacy automatic records are revalidated, never patched into success.
fs.writeFileSync(override,JSON.stringify({overrides:[{date:'2026-10-23',source:'dgpa_auto_update',marketOpen:false,closedReason:'typhoon_holiday'}]}));
r=run('write-market-status-receipt.js',['--trade-date=2026-10-23']);assert.equal(r.status,10,r.stderr);
r=run('write-market-status-receipt.js',['--trade-date=2026-10-23'],{TEST_FETCH_FAIL:'1'});assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).sourceVerified,false);
r=run('write-market-status-receipt.js',['--trade-date=2026-10-23'],{TEST_HTML:html('今天照常上班、照常上課。')});assert.equal(r.status,0,r.stderr);
r=run('write-market-status-receipt.js',['--trade-date=2026-10-23'],{TEST_HTML:html('今天停止上班。','115年 10月 22日')});assert.equal(r.status,2);
const before=fs.readFileSync(override,'utf8');r=run('update-market-calendar-auto-override.js',['--apply','--now=2026-10-23T08:10:00+08:00'],{TEST_HTML:'unavailable'});assert.equal(r.status,1);assert.equal(fs.readFileSync(override,'utf8'),before);
console.log('PASS shared producer/consumer v2, full-city/morning/open/tomorrow, tamper/date/partial-area rejection, legacy refresh, source outage and ten stage decisions (isolated fixtures)');
