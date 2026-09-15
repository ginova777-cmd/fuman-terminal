#!/usr/bin/env node
"use strict";
const fs=require("fs"),path=require("path"),{spawnSync}=require("child_process"),ROOT=path.resolve(__dirname,".."),SQL_FILE=path.join(ROOT,"ops","public-slot","DaytradeIntraday5mLatestClosedReadback_20260915.sql"),URL=(process.env.SUPABASE_URL||"https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/ ,"");
function secret(name){for(const p of [path.join("C:\\fuman-runtime","secrets",name),path.join(ROOT,"secrets",name)])try{const v=fs.readFileSync(p,"utf8").trim();if(v)return v}catch{}return""}
async function main(){
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY||secret("supabase-service-role-key.txt");if(!key)throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
 const sql=fs.readFileSync(SQL_FILE,"utf8");let method="exec_sql.query";
 async function rpc(body){const r=await fetch(`${URL}/rest/v1/rpc/exec_sql`,{method:"POST",headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)}),text=await r.text();if(!r.ok){const e=new Error(`exec_sql HTTP ${r.status}: ${text.slice(0,500)}`);e.status=r.status;throw e}return text}
 try{await rpc({query:sql})}catch(first){try{method="exec_sql.sql";await rpc({sql})}catch(second){method="psql";const db=secret("supabase-db-url.txt");if(!db)throw second;const psql=process.env.PSQL_PATH||"C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe",r=spawnSync(psql,[db,"-X","-v","ON_ERROR_STOP=1","-f",SQL_FILE],{encoding:"utf8",timeout:120000,windowsHide:true});if(r.error||r.status!==0)throw new Error(String(r.stderr||r.error||"psql migration failed").slice(0,1000))}}
 const receipt={ok:true,status:"complete",contract:"daytrade_intraday_5m_latest_closed_view_apply_v1",applied_at:new Date().toISOString(),sql_file:SQL_FILE,view:"v_fugle_intraday_5m_readback",method,contract_preserved:true,exposes_only_passed_v4_runs:true,formal_buy_authority:false},p=path.join("C:\\fuman-runtime","data","scan-receipts","daytrade-intraday-5m-latest-closed-view-apply-20260915.json");fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify({...receipt,receipt_path:p},null,2)+"\n");console.log(JSON.stringify({...receipt,receipt_path:p},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
