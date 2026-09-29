'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const {verify,hash,assertRetirement}=require('./verify-opening-short-complete.cjs');
const arg=(name,fallback)=>process.argv.find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3)||fallback;
const output=arg('output-root','C:/Users/ginov/Documents/Codex/2026-09-06/su3/outputs');
const requested=arg('date'),runId='opening-short-'+requested+'-'+crypto.randomUUID(),started=new Date().toISOString();
fs.mkdirSync(output,{recursive:true});const pending=path.join(output,runId+'-pending.json');
const receiptFile=path.join(output,runId+'-receipt.json');const steps=[];
function step(name){console.log('['+new Date().toISOString()+'] 開始 '+name);const r=cp.spawnSync(process.execPath,[path.join(__dirname,name),'--report='+pending],{encoding:'utf8',windowsHide:true,stdio:'inherit',maxBuffer:20*1024*1024});steps.push({name,exitCode:r.status});console.log('['+new Date().toISOString()+'] 完成 '+name+' exit='+r.status);if(r.status!==0)throw Error(name+':'+(r.stderr||r.error?.message||'failed'));}
try{
 assertRetirement();
 console.log('['+started+'] 批次 '+runId+'：建立全市場範圍與資料日期');
 const init=cp.spawnSync(process.execPath,[path.join(__dirname,'init-opening-short-market.cjs'),'--date='+requested,'--output='+pending],{encoding:'utf8',windowsHide:true,stdio:'inherit'});steps.push({name:'init-opening-short-market.cjs',exitCode:init.status});if(init.status!==0)throw Error(init.stderr||'initialization_failed');
 step('enrich-opening-short-formal.cjs');step('prepare-short-30m.cjs');step('enrich-opening-short-formal.cjs');
 console.log('['+new Date().toISOString()+'] 來源補入完成，開始獨立驗證與完整報告讀回');
 const v=verify(pending);if(!v.ok)throw Error(v.issues.join('|'));
 const report=JSON.parse(fs.readFileSync(pending));report.run_id=runId;report.complete=true;report.formal_receipt_status='COMPLETE';report.first_blocker=null;
 report.acceptance_contract='opening-short-premarket-complete-v1';report.acceptance_scope='latest-available-trade-date premarket scan, existing coverage thresholds, rules, ranking, source readback, console display; no orders';
 fs.writeFileSync(pending,JSON.stringify(report,null,2));
 const finalCheck=verify(pending);if(!finalCheck.ok)throw Error(finalCheck.issues.join('|'));
 const finalPath=path.join(output,'opening-short-market-'+report.trade_date.replaceAll('-','')+'.json');
 const displayPath=path.join(output,runId+'-display.txt');fs.writeFileSync(displayPath,finalCheck.display);
 // Verification and full rendering precede replacement of the last good report.
 fs.renameSync(pending,finalPath);
 const finalHash=hash(fs.readFileSync(finalPath));const readback=JSON.parse(fs.readFileSync(finalPath));if(readback.run_id!==runId||readback.complete!==true)throw Error('published_readback_mismatch');
 const receipt={contract:'opening-short-premarket-complete-v1',run_id:runId,requested_date:requested,trade_date:report.trade_date,status:'complete',complete:true,exitCode:0,first_blocker:null,failed_checks:[],started_at:started,completed_at:new Date().toISOString(),steps,counts:v.counts,coverage:v.coverage,optional_hourly_missing:v.optional_hourly_missing,report:finalPath,report_sha256:finalHash,display:displayPath,display_sha256:hash(fs.readFileSync(displayPath)),scope:report.acceptance_scope};
 fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2));console.log(finalCheck.display);console.log(JSON.stringify({status:'COMPLETE',receipt:receiptFile,report:finalPath}));
}catch(e){fs.writeFileSync(receiptFile,JSON.stringify({contract:'opening-short-premarket-complete-v1',run_id:runId,status:'failed',complete:false,exitCode:1,first_blocker:e.message,started_at:started,completed_at:new Date().toISOString(),steps},null,2));console.error(e.message);process.exitCode=1;}
