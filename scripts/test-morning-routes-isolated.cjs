'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.argv[2]);
assert(out.startsWith(path.join(root,'outputs')));
process.env.FUMAN_RUNTIME_DIR=path.join(out,'runtime');
for(const key of Object.keys(process.env))if(/SUPABASE|TOKEN|PASSWORD|SECRET|FUMAN_TEST_MEMBER/.test(key))delete process.env[key];
process.env.FUMAN_UI_E2E_BASE_URL='http://127.0.0.1';
const realFetch=global.fetch;global.fetch=(url,...args)=>{assert.equal(new URL(url).hostname,'127.0.0.1');return realFetch(url,...args);};
const stub=(name,exports)=>{const file=require.resolve(name);require.cache[file]={id:file,filename:file,loaded:true,exports};};
const payload=stage=>JSON.parse(fs.readFileSync(path.join(out,'runtime/isolated-db',`opening_report_0830_terminal_briefing_${stage}.json`),'utf8')).payload;
stub('../lib/server-entitlement-guard',{verifyRequestEntitlement:async()=>({ok:true,scope:'isolated_entitlement_fixture'})});
stub('../lib/supabase-snapshots',{readSnapshot:async()=>null,upsertSnapshot:async()=>{throw Error('UNEXPECTED_WRITE');}});
for(const name of ['strategy2-latest','strategy3-latest','strategy4-latest','strategy5-latest','institution-latest'])stub('../api/'+name,()=>{throw Error('UNEXPECTED_STRATEGY');});
stub('../api/market-ai-live',(req,res)=>res.status(200).json({ok:true,openingMorningReport:payload(req.query.morningStage||'us_0820')}));
const mobile=require('../api/mobile-fragment'),requests=[];
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');requests.push(url.pathname+url.search);
  res.setHeader('Content-Security-Policy',"default-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-src 'none'");
  res.status=n=>{res.statusCode=n;return res;};res.send=v=>res.end(v);res.json=v=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));};
  req.query=Object.fromEntries(url.searchParams);
  try {
    if(url.pathname==='/api/mobile-fragment'&&url.searchParams.get('tab')==='morning')return await mobile(req,res);
    if(url.pathname==='/api/mobile-boot')return res.json({ok:true,membershipRequired:false,fragments:{},indices:[]});
    if(url.pathname==='/api/release-manifest')return res.json({gitSha:require('child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),scope:'isolated_candidate'});
    if(url.pathname==='/api/market-ai-live')return res.json({ok:true,openingMorningReport:payload(url.searchParams.get('morningStage')||'us_0820')});
    if(url.pathname.startsWith('/api/')&&url.pathname!=='/api/mobile-page')return res.json({ok:true,rows:[],items:[],data:[]});
    const file=path.resolve(root,url.pathname==='/'?'index.html':url.pathname==='/api/mobile-page'?'mobile.html':'.'+url.pathname);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.status(404).end();
    res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(fs.readFileSync(file));
  }catch(e){res.status(500).end(e.message);}
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  const ui=require('./verify-terminal-ui-e2e'),rendered=require('./verify-opening-report-rendered'),browser=await ui.launchBrowser(),results=[];
  try{
    for(const stage of ['us_0820','asia_0850'])for(const mode of [{key:'desktop',width:1440,height:1000,mobile:false},{key:'mobile-portrait',width:390,height:844,mobile:true},{key:'mobile-landscape',width:844,height:390,mobile:true}]){
      const cdp=await ui.createTab(browser),p=payload(stage);let result;
      try{
        await ui.setViewport(cdp,mode);
        await ui.navigate(cdp,base+(mode.mobile?'/api/mobile-page?':'/?desktop=1&')+'morningStage='+stage,{stopLoading:false});
        if(mode.mobile){await ui.waitFor(cdp,()=>({ok:typeof self.FUMAN_MOBILE_MEMBER_OPENED==='function'&&self.FUMAN_MOBILE_MEMBER_OPENED()}),null,15000);await ui.clickSelectorByDom(cdp,'#tabs button[data-fragment="morning"]');}
        else {await ui.waitForSelector(cdp,'aside.sidebar a[data-view="market"]',15000);await ui.activateDesktopRoute(cdp,{key:'market-ai',selector:'aside.sidebar a[data-view="market"]',postClickSelector:'#market-view .market-mode-tabs [data-market-mode="ai"]',expectedPanelId:'market-view',expectedRouteKey:'market|市場總覽'});}
        await ui.waitFor(cdp,rendered.readyForReport,p.run_id,20000);
        const actual=await ui.evaluate(cdp,rendered.collect);assert(actual.ok);assert.equal(actual.hash,p.delivery_content_hash);assert.equal(actual.industryCount,15);assert(actual.overflow<=8);
        assert.deepEqual(actual.rows.map(r=>({...r,a:r.a.map(({symbol,name})=>({symbol,name})),b:r.b.map(({symbol,name})=>({symbol,name}))})),rendered.expectedRows({display_top3:p.display_top3}).map(r=>({...r,percent:Number(r.percent.toFixed(2))})));
        const {shot,clip}=await rendered.captureReport(cdp),bytes=Buffer.from(shot.data,'base64'),file=path.join(out,`route-${stage}-${mode.key}.png`);fs.writeFileSync(file,bytes);
        result={stage,surface:mode.key,ok:true,actual,screenshot:file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),clip};
      }catch(e){result={stage,surface:mode.key,ok:false,error:e.message,actual:await ui.evaluate(cdp,rendered.collect).catch(()=>null)};}finally{cdp.close();}
      results.push(result);console.log(JSON.stringify({stage,surface:mode.key,ok:result.ok,error:result.error}));
    }
  }finally{browser.child.kill();}
  for(const stage of ['us_0820','asia_0850']){
    const log=fs.openSync(path.join(out,stage+'-rendered-cli.log'),'w');
    const code=await new Promise(resolve=>{
      const child=require('child_process').spawn(process.execPath,[path.join(root,'scripts/verify-opening-report-rendered.js'),'--trade-date=2026-10-16','--base-url='+base],{cwd:root,env:{...process.env,FUMAN_MORNING_STAGE:stage,FUMAN_UI_E2E_BASE_URL:base},stdio:['ignore',log,log]});child.on('exit',resolve);
    });fs.closeSync(log);assert.equal(code,0,'RENDERED_CLI_FAILED:'+stage);
  }
  fs.writeFileSync(path.join(out,'route-origin.json'),JSON.stringify({base_url:base,scope:'isolated_loopback_origin'}));
  server.closeAllConnections();server.close();
  fs.writeFileSync(path.join(out,'routes-isolated.json'),JSON.stringify({scope:'isolated_real_routes_fixture_transport',formal_entitlement_verified:false,formal_db_access:false,complete:results.every(r=>r.ok),results,requests},null,2));
  assert(results.every(r=>r.ok),'ROUTE_FAILURE');
})().catch(e=>{server.closeAllConnections();server.close();console.error(e.stack);process.exitCode=1;});
