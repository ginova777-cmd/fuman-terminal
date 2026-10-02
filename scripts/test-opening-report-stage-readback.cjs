'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'api/market-ai-live.js'),'utf8');
const start=source.indexOf('async function readOpeningMorningReportSnapshot('),end=source.indexOf('\nfunction withMarketAiRunTimeSourceSnapshot',start);
assert.ok(start>=0&&end>start);
const clock={date:'2026-10-02',ymd:'20261002'};
let calls=[],payload;
const context={process,Number,String,isWeekend:()=>false,compactDate:s=>String(s||'').replace(/-/g,''),readSnapshot:async(key,options)=>{calls.push({key,options});return {payload,updatedAt:'2026-10-02T00:50:00Z'};}};
vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nthis.readReport=readOpeningMorningReportSnapshot;',context);
async function main(){
 for(const stage of ['us_0820','asia_0850']){
  payload={contract:'opening-report-0830-terminal-briefing-v1',stage,stage_contract:'opening-report-two-stage-v1',date:'2026-10-02',ok:true};
  const result=await context.readReport(clock,5000,stage);assert.equal(result.stage,stage);assert.equal(calls.at(-1).key,'opening_report_0830_terminal_briefing_'+stage);assert.equal(calls.at(-1).options.allowLatestFallback,false);
 }
 const before=calls.length;assert.equal(await context.readReport(clock,5000,'invalid'),null);assert.equal(calls.length,before);
 assert.equal(await context.readReport(clock,5000,'us_0820'),null,'must not accept Asia payload for US request');
 payload={...payload,stage:'us_0820',date:'2026-10-01'};assert.equal(await context.readReport(clock,5000,'us_0820'),null,'must not accept previous day');
 payload={...payload,date:'2026-10-02'};await context.readReport(clock,5000);assert.equal(calls.at(-1).key,'opening_report_0830_terminal_briefing','default remains latest');
 const viewSource=fs.readFileSync(path.join(root,'terminal-opening-report-view.js'),'utf8');
 for(const stage of ['us_0820','asia_0850','invalid','']){
  const browser={location:{search:'?morningStage='+stage},URLSearchParams};vm.createContext(browser);vm.runInContext(viewSource,browser);
  const valid=['us_0820','asia_0850'].includes(stage);assert.equal(browser.FUMAN_OPENING_REPORT_VIEW.endpoint('/api/test?x=1'),'/api/test?x=1'+(valid?'&morningStage='+stage:''));
 }
 const mobile=fs.readFileSync(path.join(root,'mobile.html'),'utf8');let parsed=0;
 for(const m of mobile.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/\bsrc\s*=/.test(m[1])&&!/application\/ld\+json/.test(m[1])){new vm.Script(m[2]);parsed++;}
 console.log(JSON.stringify({ok:true,stage_identity_and_no_fallback:true,invalid_stage_no_query:true,previous_date_rejected:true,default_latest_preserved:true,browser_url_cases:4,mobile_inline_scripts_parsed:parsed,network_calls:0}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
