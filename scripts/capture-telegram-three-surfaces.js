'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ui=require('./verify-terminal-ui-e2e');
async function capture({runId,tradeDate,eventCount,eventsHash,output,baseUrl='https://fuman-terminal.vercel.app'}){
 if(!/^telegram-(?:natural|replay)-[a-f0-9-]{36}$/.test(runId))throw Error('INVALID_RUN_ID');
 fs.mkdirSync(output,{recursive:true});const browser=await ui.launchBrowser({headful:false}),surfaces={};
 try{
  for(const [name,route,width,height,mobile]of [['desktop','/',1440,1000,false],['mobile','/mobile.html',390,844,true],['scorecard','/88',1440,1000,false]]){
   const cdp=await ui.createTab(browser);
   try{
    await ui.setViewport(cdp,{width,height,mobile});const url=baseUrl+route+'?telegram-audit=1&telegram-run='+encodeURIComponent(runId);
    await ui.navigate(cdp,url,{stopLoading:false});
    await ui.waitFor(cdp,id=>({ok:document.querySelector('#telegram-detector-audit')?.dataset.runId===id}),runId,30000,300);
    const observed=await ui.evaluate(cdp,()=>{const e=document.querySelector('#telegram-detector-audit');e.scrollIntoView({block:'start'});const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {run_id:e.dataset.runId,trade_date:e.dataset.tradeDate,event_count:Number(e.dataset.eventCount),events_sha256:e.dataset.eventsSha256,rows:e.querySelectorAll('table tr').length?e.querySelectorAll('table tr').length-1:0,visible:e.open&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden',url:location.href,text:e.innerText};});
    if(observed.run_id!==runId||observed.trade_date!==tradeDate||observed.event_count!==eventCount||observed.rows!==eventCount||observed.events_sha256!==eventsHash||!observed.visible)throw Error('RENDERED_BATCH_MISMATCH:'+name);
    const screenshot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},15000),bytes=Buffer.from(screenshot.data,'base64');fs.writeFileSync(path.join(output,name+'.png'),bytes);
    surfaces[name]={rendered:true,...observed,screenshot_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),checked_at:new Date().toISOString()};
   }finally{cdp.close();}
  }
 }finally{browser.child.kill();}
 fs.writeFileSync(path.join(output,'tri-surface.json'),JSON.stringify(surfaces,null,2));return surfaces;
}
module.exports={capture};
if(require.main===module){const runId=process.argv.find(x=>x.startsWith('--run-id='))?.slice(9);const {readSnapshot}=require('../lib/supabase-snapshots');(async()=>{const p=(await readSnapshot('telegram_three_detectors_'+runId,{maxAttempts:1,timeoutMs:10000}))?.payload;if(!p)throw Error('BATCH_NOT_FOUND');const output=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||path.join(process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime','data/telegram-detectors',p.trade_date,'ui-'+runId);const s=await capture({runId,tradeDate:p.trade_date,eventCount:p.event_count,eventsHash:p.events_sha256,output});console.log(JSON.stringify({run_id:runId,rendered_surfaces:Object.keys(s),output}));})().catch(e=>{console.error(e.message);process.exitCode=1;});}
