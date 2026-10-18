'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const out=path.resolve(process.argv[2]);assert(out.includes('morning-contract-20261018'));
process.env.FUMAN_RUNTIME_DIR=path.join(out,'runtime');process.env.FUMAN_UI_E2E_BASE_URL='http://127.0.0.1';
delete process.env.FUMAN_TEST_MEMBER_EMAIL;delete process.env.FUMAN_TEST_MEMBER_PASSWORD;
const originalFetch=global.fetch;
global.fetch=(url,...args)=>{assert.equal(new URL(url).hostname,'127.0.0.1','isolated network boundary');return originalFetch(url,...args);};
const ui=require('./verify-terminal-ui-e2e'),rendered=require('./verify-opening-report-rendered');
const render=require('../terminal-opening-report-view').render;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
  const browser=await ui.launchBrowser(),results=[];
  try {
    for(const stage of ['us_0820','asia_0850'])for(const mode of [{key:'desktop',width:1440,height:1000,mobile:false},{key:'mobile-portrait',width:390,height:844,mobile:true},{key:'mobile-landscape',width:844,height:390,mobile:true}]) {
      const payload=JSON.parse(fs.readFileSync(path.join(out,'runtime/isolated-db',`opening_report_0830_terminal_briefing_${stage}.json`),'utf8')).payload;
      const cdp=await ui.createTab(browser);
      try {
        await ui.setViewport(cdp,mode);
        // Real shared renderer; tall desktop ancestor reproduces unsafe document-sized capture.
        const html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:8px">'+render(payload)+(mode.key==='desktop'?'<div style="height:100000px"></div>':'')+'</body>';
        await ui.navigate(cdp,'data:text/html;charset=utf-8,'+encodeURIComponent(html),{stopLoading:false});
        const actual=await ui.evaluate(cdp,rendered.collect);
        assert.equal(actual.run_id,payload.run_id);assert.equal(actual.hash,payload.delivery_content_hash);assert.equal(actual.industryCount,15);assert(actual.overflow<=8);
        const expected=rendered.expectedRows({display_top3:payload.display_top3}).map(r=>({...r,percent:Number(r.percent.toFixed(2))}));
        assert.deepEqual(actual.rows.map(r=>({...r,a:r.a.map(({symbol,name})=>({symbol,name})),b:r.b.map(({symbol,name})=>({symbol,name}))})),expected);
        const {shot,clip}=await rendered.captureReport(cdp);assert(shot.data);assert(clip.height<100000);
        const png=Buffer.from(shot.data,'base64'),file=path.join(out,`${stage}-${mode.key}.png`);fs.writeFileSync(file,png);
        results.push({stage,surface:mode.key,run_id:payload.run_id,ok:true,clip,screenshot:file,sha256:sha(png),actual});
      }finally{cdp.close();}
    }
    fs.writeFileSync(path.join(out,'rendered-isolated.json'),JSON.stringify({scope:'isolated_actual_renderer_and_browser',complete:true,production_route_tested:false,natural:false,results},null,2));
    console.log(JSON.stringify({complete:true,actual_screenshots:results.length,scope:'isolated_actual_renderer_and_browser'}));
  }finally{browser.child.kill();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
