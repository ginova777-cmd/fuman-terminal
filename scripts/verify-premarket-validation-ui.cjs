'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const ui=require('./verify-terminal-ui-e2e');
const {digest}=require('../lib/telegram-detectors/premarket-plan-contract.cjs');
async function verify({artifact,output}){
 const root=path.resolve(__dirname,'..'),payload=JSON.parse(fs.readFileSync(artifact,'utf8'));
 assert.equal(payload.contract,'telegram_premarket_validation_v1');assert.equal(payload.notifications_sent,0);assert.equal(payload.no_send,true);assert.equal(digest(payload.rows),payload.rows_sha256);
 fs.mkdirSync(output,{recursive:true});let active=payload;
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/api/premarket-workflow'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(active));return;}
  if(pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end('{}');return;}
  const relative=pathname==='/'?'index.html':pathname==='/88'?'88.html':decodeURIComponent(pathname.slice(1)),file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css':'application/octet-stream');
  // Render the actual route markup/styles and the new component without running
  // unrelated production scanners/auth clients in a local read-only audit.
  if(file.endsWith('.html'))res.end(fs.readFileSync(file,'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,tag=>tag.includes('src="terminal-premarket-workflow.js"')?tag:''));
  else res.end(fs.readFileSync(file));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 let browser;const observed={};
 try{
  browser=await ui.launchBrowser({headful:false});
  for(const [name,route,width,height,mobile]of [['desktop','/',1440,1000,false],['mobile','/mobile.html',390,844,true],['scorecard','/88',1440,1000,false]]){
   const cdp=await ui.createTab(browser);
   try{
    await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urls:['https://*']});await ui.setViewport(cdp,{width,height,mobile});
    await ui.navigate(cdp,base+route+'?premarket-audit=1',{stopLoading:false});
    await ui.waitFor(cdp,id=>({ok:document.getElementById('premarket-workflow')?.dataset.runId===id}),payload.run_id,20000,200);
    const state=await ui.evaluate(cdp,()=>{const p=document.getElementById('premarket-workflow');p.scrollIntoView({block:'start'});return {run_id:p.dataset.runId,rows_sha256:p.dataset.rowsSha256,row_count:Number(p.dataset.rowCount),status:p.dataset.status,visible:p.open&&p.getBoundingClientRect().width>0,text:p.innerText,rows:[...p.querySelectorAll('section[data-symbol]')].map(e=>({stock_id:e.dataset.symbol,text:e.textContent,visible_text:e.innerText}))};});
    assert.equal(state.run_id,payload.run_id);assert.equal(state.rows_sha256,payload.rows_sha256);assert.equal(state.row_count,payload.rows.length);assert.equal(state.visible,true);assert.equal(state.rows.length,payload.rows.length);assert(state.text.includes('Telegram 未發送'));
    for(const row of payload.rows){const found=state.rows.find(r=>r.stock_id===row.stock_id);assert(found);for(const blocker of row.blockers)assert(found.text.includes(blocker));
     if(row.preopen_recommendation==='LIMIT_UP_LONG'){assert(found.visible_text.includes('掛漲停買（僅建議，未下單）'));assert(found.visible_text.includes('方向候選：多'));assert(found.visible_text.includes('成本×1.03目標 '+row.recommendation_target.toFixed(2)));}
     if(row.broker_comparison){assert(found.visible_text.includes('比例僅為數值對照'));const b=row.broker_comparison.branch;if(b)assert(found.visible_text.includes(b.buy_lots.toFixed(2)));const ratio=row.broker_comparison.comparisons.foreign.ratio;if(typeof ratio==='number')assert(found.visible_text.includes((ratio*100).toFixed(2)+'%'));}
     const states={matched:'符合已列條件',not_matched:'未符合',insufficient_data:'資料不足'};for(const scenario of row.scenario_assessments||[])assert(found.visible_text.includes(states[scenario.status]));
     if(row.trial_price_levels){assert(found.visible_text.includes(row.trial_price_levels.trial_derived_complete?'試撮價位已算出':'等待有效試撮'));for(const level of row.trial_price_levels.levels.filter(l=>l.basis==='indicative_trial'&&l.price!==null))assert(found.visible_text.includes(String(Number(level.price.toFixed(6)))));}
    }
    const shot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},15000),bytes=Buffer.from(shot.data,'base64');fs.writeFileSync(path.join(output,name+'.png'),bytes);observed[name]={...state,screenshot_sha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex')};
   }finally{cdp.close();}
  }
 }finally{browser?.child.kill();await new Promise(resolve=>server.close(resolve));}
 const source_hashes=Object.fromEntries(['index.html','mobile.html','88.html','terminal-premarket-workflow.js'].map(file=>[file,require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
 const receipt={scope:'local_rendered_validation_component_on_three_route_shells',source_hashes,unrelated_page_scripts_disabled:true,run_id:payload.run_id,rows_sha256:payload.rows_sha256,complete:true,formal_complete:false,notifications_sent:0,surfaces:observed};
 fs.writeFileSync(path.join(output,'tri-surface.json'),JSON.stringify(receipt,null,2));return receipt;
}
if(require.main===module){const [artifact,output]=process.argv.slice(2);if(!artifact||!output)throw Error('ARTIFACT_AND_OUTPUT_REQUIRED');verify({artifact,output}).then(r=>console.log(JSON.stringify({scope:r.scope,complete:r.complete,formal_complete:r.formal_complete,run_id:r.run_id}))).catch(e=>{console.error(e.stack);process.exitCode=1;});}
module.exports={verify};
