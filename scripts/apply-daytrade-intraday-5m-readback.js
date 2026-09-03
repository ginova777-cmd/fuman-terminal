#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..");
const SQL_FILE = path.join(ROOT, "ops", "public-slot", "DaytradeIntraday5mReadback_20260903.sql");
const URL = (process.env.SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
function secret(name) { for (const p of [path.join("C:\\fuman-runtime", "secrets", name), path.join(ROOT, "secrets", name)]) { try { const v=fs.readFileSync(p,"utf8").trim(); if(v)return v; } catch {} } return ""; }
async function main() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || secret("supabase-service-role-key.txt");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  const sql = fs.readFileSync(SQL_FILE, "utf8");
  let method="exec_sql.query";
  async function rpc(body){const response=await fetch(`${URL}/rest/v1/rpc/exec_sql`,{method:"POST",headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});const text=await response.text();if(!response.ok){const e=new Error(`exec_sql HTTP ${response.status}: ${text.slice(0,800)}`);e.status=response.status;throw e;}return text;}
  try { await rpc({query:sql}); }
  catch(first){ try { method="exec_sql.sql"; await rpc({sql}); }
    catch(second){ method="psql"; const db=secret("supabase-db-url.txt"); if(!db)throw second; const psql=process.env.PSQL_PATH||"C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe"; const result=spawnSync(psql,[db,"-v","ON_ERROR_STOP=1","-f",SQL_FILE],{encoding:"utf8",timeout:120000,windowsHide:true}); if(result.error||result.status!==0)throw new Error(String(result.stderr||result.error||"psql failed").slice(0,1000)); }
  }
  const receipt = {ok:true,contract:"daytrade_intraday_5m_readback_apply_v1",applied_at:new Date().toISOString(),sql_file:SQL_FILE,view:"v_fugle_intraday_5m_readback",method,formal_buy_authority:false};
  const receiptPath=path.join("C:\\fuman-runtime","data","scan-receipts","daytrade-intraday-5m-readback-apply.json");
  fs.mkdirSync(path.dirname(receiptPath),{recursive:true}); fs.writeFileSync(receiptPath,JSON.stringify({...receipt,receipt_path:receiptPath},null,2)+"\n");
  console.log(JSON.stringify({...receipt,receipt_path:receiptPath},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
