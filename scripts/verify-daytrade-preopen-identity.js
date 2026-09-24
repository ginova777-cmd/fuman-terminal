"use strict";
const fs=require("fs"),path=require("path"),crypto=require("crypto");
const {verifyRows}=require("../lib/daytrade-writer-identity");
const runtime=process.env.FUMAN_RUNTIME_DIR||"C:\\fuman-runtime";
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
async function main(){
 const date=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const key=fs.readFileSync(path.join(runtime,"secrets/supabase-anon-key.txt"),"utf8").trim();
 const url=(process.env.SUPABASE_URL||"https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/$/,"");
 let result;
 for(let attempt=1;attempt<=3;attempt++){
  const before=read(path.join(runtime,"state/daytrade-mother-pool-delta.json"));
  const rows=[];for(let offset=0;offset<10000;offset+=200){const r=await fetch(`${url}/rest/v1/v_fugle_daytrade_mother_pool_v4_1?select=*&trade_date=eq.${date}&order=symbol.asc&limit=200&offset=${offset}`,{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(`anon_readback_http_${r.status}`);const page=await r.json();rows.push(...page);if(page.length<200)break;}
  const after=read(path.join(runtime,"state/daytrade-mother-pool-delta.json")),identity=verifyRows(rows,before),failures=[...identity.failed_checks];
  if(before.writer_run_id!==after.writer_run_id||before.generation_id!==after.generation_id)failures.push("writer_advanced_during_readback");
  const expected=(before.rows||[]).map(r=>r.symbol).sort(),actual=rows.map(r=>r.symbol).sort();
  if(JSON.stringify(expected)!==JSON.stringify(actual))failures.push("requested_readback_symbol_difference");
  if(before.trade_date!==date)failures.push("runner_trade_date_mismatch");
  result={contract:"daytrade_preopen_writer_identity_v1",scope:"A01_writer_identity_readback",trade_date:date,checked_at:new Date().toISOString(),attempt,
   canonical_run_id:before.canonical_run_id,writer_run_id:before.writer_run_id,generation_id:before.generation_id,
   requested_count:expected.length,written_count:before.rows?.length||0,readback_count:rows.length,
   readback_sha256:crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
   failed_checks:failures,first_blocker:failures[0]||null,status:failures.length?"blocked":"complete",complete:!failures.length,exit_code:failures.length?1:0};
  if(result.complete)break;
 }
 const out=process.argv.find(v=>v.startsWith("--output="))?.slice(9);
 if(out){fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+"\n");}
 console.log(JSON.stringify(result,null,2));process.exitCode=result.exit_code;
}
main().catch(e=>{console.error(JSON.stringify({status:"blocked",complete:false,first_blocker:e.message}));process.exitCode=1;});
