"use strict";
const fs=require("fs"),path=require("path"),crypto=require("crypto");
const ui=require("./verify-terminal-ui-e2e");
const option=(key,fallback="")=>process.argv.find(x=>x.startsWith(key+"="))?.slice(key.length+1)||fallback;
const root=path.resolve(__dirname,".."),runtime=process.env.FUMAN_RUNTIME_DIR||"C:/fuman-runtime";
const date=option("--trade-date",new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()));
const compact=date.replace(/-/g,""),base=option("--base-url","https://fuman-terminal.vercel.app");
const diagnostic=process.argv.includes("--inspect-only");
const out=path.resolve(option("--out",path.join(runtime,"data","opening-report-0830","rendered",compact)));
const sha=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
function expectedRows(final) {
  return (final.display_top3||[]).map(row=>({rank:Number(row.rank),name:row.display_name||row.industry||"",percent:Number(row.percent),a:(row.mapped_symbols_a||[]).map(x=>({symbol:String(x.symbol||x.code),name:x.name})),b:(row.mapped_symbols_b||[]).map(x=>({symbol:String(x.symbol||x.code),name:x.name}))}));
}
function collect() {
  const n=document.querySelector('[data-opening-report-0830-briefing]');
  if(!n)return {ok:false,reason:"morning_render_missing",body:document.body.innerText.slice(0,1000)};
  const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=="none"&&s.visibility!=="hidden";};
  const group=(row,key)=>[...row.querySelectorAll(`[data-morning-group="${key}"] [data-morning-symbol]`)].map(x=>({symbol:x.dataset.morningSymbol,name:x.dataset.morningName,visible:visible(x),text:x.innerText}));
  const rows=[...n.querySelectorAll('[data-morning-rank]')].map(row=>({rank:Number(row.dataset.morningRank),name:row.querySelector('[data-morning-title]')?.innerText,percent:Number(row.querySelector('[data-morning-percent]')?.innerText.replace('%','')),a:group(row,"A"),b:group(row,"B")}));
  return {ok:visible(n),run_id:n.dataset.runId,date:n.dataset.tradeDate,hash:n.dataset.contentHash,state:n.dataset.openingReportState,industryCount:Number(n.querySelector('[data-morning-industry-count]')?.innerText),rows,zero:!!n.querySelector('[data-morning-zero]'),text:n.innerText,overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),url:location.href};
}
async function main(){
  fs.mkdirSync(out,{recursive:true});
  const final=read(path.join(runtime,"data","opening-report-0830",`opening-report-0830-final-receipt-${compact}.json`));
  const expected=expectedRows(final),fullHash=require("../lib/opening-report-delivery-contract").contentHash(final.priority_observation_mode,final.display_top3||[]);
  const results=[];let browser;
  const manifest=await fetch(base+"/api/release-manifest",{signal:AbortSignal.timeout(15000)}).then(r=>r.json());
  try{
    browser=await ui.launchBrowser();
    for(const mode of [{key:"desktop",width:1440,height:1000,mobile:false},{key:"mobile-portrait",width:390,height:844,mobile:true},{key:"mobile-landscape",width:844,height:390,mobile:true}]){
      const cdp=await ui.createTab(browser);let actual;
      try{
        await ui.setViewport(cdp,mode);
        await ui.navigate(cdp,base+(mode.mobile?"/api/mobile-page":"/?desktop=1"),{stopLoading:false});
        if(mode.mobile){
          await ui.waitFor(cdp,()=>({ok:typeof self.FUMAN_MOBILE_MEMBER_OPENED==="function"&&self.FUMAN_MOBILE_MEMBER_OPENED()}),null,45000);
          await ui.clickSelectorByDom(cdp,'#tabs button[data-fragment="morning"]');
        }else{
          await ui.waitForSelector(cdp,'aside.sidebar a[data-view="market"]',45000);
          await ui.activateDesktopRoute(cdp,{key:"market-ai",selector:'aside.sidebar a[data-view="market"]',postClickSelector:'#market-view .market-mode-tabs [data-market-mode="ai"]',expectedPanelId:"market-view",expectedRouteKey:"market|市場總覽"});
        }
        actual=await ui.waitFor(cdp,collect,null,60000);
        const rows=actual.rows.map(r=>({...r,a:r.a.map(({symbol,name})=>({symbol,name})),b:r.b.map(({symbol,name})=>({symbol,name}))}));
        const expectedRounded=expected.map(r=>({...r,percent:Number(r.percent.toFixed(2))}));
        const symbolsVisible=actual.rows.every(r=>[...r.a,...r.b].every(x=>x.visible&&x.text.includes(x.symbol)&&x.text.includes(x.name)));
        const checks={rendered:actual.ok,run:actual.run_id===final.run_id,date:actual.date===date,hash:actual.hash===final.delivery_content_hash,rows:JSON.stringify(rows)===JSON.stringify(expectedRounded),allSymbolsVisible:symbolsVisible,industries:actual.industryCount===15,zero:expected.length>0||actual.zero,layout:actual.overflow<=8,state:["ready","zero","degraded"].includes(actual.state)};
        actual={...actual,checks,ok:Object.values(checks).every(Boolean)};
      }catch(error){actual={ok:false,error:error.message,...(await ui.evaluate(cdp,collect).catch(()=>({})))};actual.ok=false;}
      const shot=await cdp.send("Page.captureScreenshot",{format:"png",fromSurface:true,captureBeyondViewport:true},30000).catch(()=>null);
      if(shot?.data){const file=path.join(out,mode.key+".png"),bytes=Buffer.from(shot.data,"base64");fs.writeFileSync(file,bytes);actual.screenshot=file;actual.screenshot_sha256=sha(bytes);}else{actual.ok=false;actual.screenshot_error="capture_failed";}
      results.push({surface:mode.key,...actual});cdp.close();
      console.log(JSON.stringify({surface:mode.key,ok:actual.ok,checks:actual.checks,error:actual.error}));
    }
  }finally{if(browser){try{browser.child.kill();}catch{}}}
  const ok=results.length===3&&results.every(x=>x.ok)&&final.delivery_content_hash===fullHash;
  const receipt={contract:"opening-report-rendered-v1",checked_at:new Date().toISOString(),trade_date:date,run_id:final.run_id,delivery_content_hash:final.delivery_content_hash,full_content_hash_ok:final.delivery_content_hash===fullHash,base_url:base,git_sha:manifest.gitSha||manifest.git_sha||"",diagnostic,complete:ok&&!diagnostic,status:diagnostic?"diagnostic":ok?"complete":"failed",exitCode:ok?0:1,results};
  const file=path.join(out,"opening-report-rendered.json");fs.writeFileSync(file,JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({receipt:file,complete:receipt.complete,full_content_hash_ok:receipt.full_content_hash_ok}));
  process.exitCode=ok?0:1;
}
if(require.main===module)main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
module.exports={expectedRows};
