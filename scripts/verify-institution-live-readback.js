"use strict";
const fs=require("fs"),path=require("path"),assert=require("assert"),cp=require("child_process");
const root=path.resolve(__dirname,".."),runtime=process.env.FUMAN_RUNTIME_DIR||"C:/fuman-runtime";
const out=path.join(root,"outputs/institution-live-acceptance");
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const receipt=read(path.join(runtime,"data/scan-receipts/institution.json"));
const url=fs.readFileSync(path.join(runtime,"secrets/supabase-url.txt"),"utf8").trim();
const key=fs.readFileSync(path.join(runtime,"secrets/supabase-service-role-key.txt"),"utf8").trim();
async function get(q){const r=await fetch(url+"/rest/v1/"+q,{headers:{apikey:key,Authorization:"Bearer "+key},signal:AbortSignal.timeout(30000)});assert(r.ok,"database readback HTTP "+r.status);return r.json()}
async function main(){
 fs.mkdirSync(out,{recursive:true});const issues=[];let report={checkedAt:new Date().toISOString(),runId:receipt.runId,ok:false,issues};
 try{
 const runId=receipt.runId;assert(/^institution-\d{8}-\d{14}$/.test(runId),"invalid run id");
 const [run]=await get("institution_scan_runs?select=*&run_id=eq."+runId);assert(run?.complete&&run.status==="complete","DB run incomplete");
 const rows=[];for(let offset=0;;offset+=500){const page=await get("institution_scan_results?select=*&run_id=eq."+runId+"&order=rank.asc,code.asc&limit=500&offset="+offset);rows.push(...page);if(page.length<500)break;}
 assert(run.expected_total===run.scanned_count && run.expected_total>=1500,"full source scan not proven");
 assert(rows.length===run.result_count && rows.length===receipt.matches,"full result readback mismatch");
 assert(new Set(rows.map(r=>r.code)).size===rows.length,"duplicate result symbols");
 assert(receipt.scanned===run.scanned_count && receipt.total===run.expected_total,"receipt full scan totals mismatch");
 assert(run.payload.blankTotal===0,"scanner required fields incomplete");
 assert(!(run.payload.sourceHealth?.warnings||[]).length,"five-day metric history incomplete");
 assert(receipt.fallbackUsed===false && run.payload.fallbackUsed===false,"fallback used");
 const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei"}).format(new Date());assert(run.scan_date===today,"run not current trading date");
 const source=run.payload.source_status_at_run;assert(source.sourceDates.twse===today.replaceAll("-","")&&source.sourceDates.tpex===today.replaceAll("-",""),"official source dates mismatch");
 for(const row of rows){
  const p=row.payload;assert(row.run_id===runId&&row.complete,"row run identity mismatch");
  for(const f of ["code","name","market","tradeDate","runId","foreign","trust","dealer","total","foreignStreak","trustStreak","jointStreak","foreignTrustVolumePct","direction","source","dataContractSource"]){assert(p[f]!==undefined&&p[f]!==null&&String(p[f]).trim()!=="",row.code+" missing "+f);}
  assert(p.runId===runId&&p.tradeDate===today,"row payload identity mismatch");
  assert(Math.abs(p.foreign+p.trust+p.dealer-p.total)<=1,row.code+" institutional components do not sum to total");
  for(const [a,b] of [["foreign","foreign_net"],["trust","trust_net"],["dealer","dealer_net"],["total","total_net"]])assert(p[a]===row[b],row.code+" DB column mismatch "+a);
 }
 assert(!/"mother_pool[^" ]*"\s*:/.test(JSON.stringify({run,rows,receipt})),"retired mother pool dependency fields");
 report={...report,ok:true,tradeDate:today,sourceCount:run.expected_total,scannedCount:run.scanned_count,resultCount:rows.length,readbackCount:rows.length,sourceDates:source.sourceDates,sourceCoverage:run.payload.sourceCoverage,blankTotal:0,rows};
 fs.writeFileSync(path.join(out,"readback.json"),JSON.stringify(report,null,2));
 if(process.argv.includes("--render")){
  const expected=rows.slice(0,120).map(r=>r.code).join(",");
  const args=["--use-system-ca",path.join(root,"scripts/verify-terminal-ui-e2e.js"),"--routes=institution","--only=desktop-night,desktop-sun,mobile-night,mobile-sun","--skip-watchlist","--skip-mobile-watch-add","--include-institution-scorecard","--institution-readback="+path.join(out,"readback.json"),"--expected-run-id="+runId,"--expected-total="+rows.length,"--expected-scorecard-symbols="+expected,"--out="+path.join(out,"rendered"),"--route-timeout=90000"];
  const child=cp.spawnSync(process.execPath,args,{cwd:root,stdio:"inherit",windowsHide:true});assert(child.status===0,"rendered three-surface acceptance failed");
 }
 console.log(JSON.stringify({ok:true,runId,scannedCount:run.scanned_count,resultCount:rows.length,report:path.join(out,"readback.json")}));
 }catch(e){report.ok=false;issues.push(e.message);fs.writeFileSync(path.join(out,"readback.json"),JSON.stringify(report,null,2));throw e;}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
