"use strict";
const fs=require("fs"),path=require("path");
const arg=(n,d)=>process.argv.find(x=>x.startsWith(`--${n}=`))?.slice(n.length+3)||d;
const R=process.env.FUMAN_RUNTIME_DIR||"C:/fuman-runtime";
function secret(n){for(const f of [path.join(R,"secrets",n),path.join(__dirname,"..","..","..","secrets",n)]){try{const v=fs.readFileSync(f,"utf8").trim();if(v)return v}catch{}}return ""}
function num(v){const x=Number(v);return Number.isFinite(x)?x:null}
async function main(){
 const reportPath=arg("report");if(!reportPath)throw Error("report required");
 const report=JSON.parse(fs.readFileSync(reportPath,"utf8").replace(/^\uFEFF/,""));
 const url=(process.env.SUPABASE_URL||"https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/,''),key=process.env.SUPABASE_ANON_KEY||process.env.FUMAN_SUPABASE_ANON_KEY||secret("supabase-anon-key.txt");
 if(!key)throw Error("SUPABASE_ANON_KEY is required");
 const rows=[]; for(let offset=0;;offset+=1000){const q=new URLSearchParams({select:"*",limit:"1000",offset:String(offset)});if(report.trade_date)q.set("trade_date",`eq.${report.trade_date}`);const res=await fetch(`${url}/rest/v1/v_fugle_daytrade_side_volume_symbol_readback?${q}`,{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(30000)});const body=await res.text();if(!res.ok)throw Error(`side volume readback HTTP ${res.status}: ${body.slice(0,500)}`);const batch=JSON.parse(body);rows.push(...batch);if(batch.length<1000)break}
 const map=new Map();
 for(const x of rows){const s=String(x.symbol||x.stock_id||x.code||'').trim();if(!s)continue;const t=Date.parse(x.side_volume_source_event_at),old=map.get(s),ot=old?Date.parse(old.side_volume_source_event_at):-1;if(Number.isFinite(t)&&(!old||t>ot))map.set(s,x)}
 for(const r of report.rows||[]){const x=map.get(String(r.symbol)); if(!x){r.data_gaps=Array.from(new Set([...(r.data_gaps||[]),"DATA_GAP_SIDE_VOLUME_2000"]));continue}
  const inside=num(x.inside_volume??x.trade_volume_at_bid??x.volume_at_bid),outside=num(x.outside_volume??x.trade_volume_at_ask??x.volume_at_ask),total=num(x.side_volume_total??x.total_side_volume)??(inside!==null&&outside!==null?inside+outside:null),matched=total!==null&&total>2000;
  r.side_volume={inside_volume:inside,outside_volume:outside,total_lots:total,threshold_lots:2000,matched,trade_date:x.trade_date||report.trade_date,source_view:"v_fugle_daytrade_side_volume_symbol_readback",run_id:x.run_id||x.canonical_run_id||null};
  r.matched_strategy_numbers=(r.matched_strategy_numbers||[]).filter(n=>n!==17);if(matched)r.matched_strategy_numbers.push(17);r.matched_strategy_numbers.sort((a,b)=>a-b);r.matched_count=r.matched_strategy_numbers.length;
  r.data_gaps=(r.data_gaps||[]).filter(g=>g!=="DATA_GAP_SIDE_VOLUME_2000");
 }
 report.qualified_count=(report.rows||[]).filter(r=>r.matched_count>=8&&!(r.data_gaps||[]).length).length;
 report.labels=Array.from(new Set([...(report.labels||[]),"內盤＋外盤>2000張"]));report.source_contract={...(report.source_contract||{}),side_volume:"v_fugle_daytrade_side_volume_symbol_readback (inside+outside > 2000 lots)"};report.formal_receipt_status="READY";report.evaluated_at=new Date().toISOString();
 fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,rows:rows.length,matched:report.rows.filter(r=>r.side_volume?.matched).length},null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
