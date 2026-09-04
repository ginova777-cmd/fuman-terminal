#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..");
const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SQL_FILE = path.join(ROOT, "ops", "public-slot", "DaytradeStarPreopenReadbackContract_20260902.sql");
const URL = (process.env.SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
function secret(name) { for (const file of [path.join(RUNTIME, "secrets", name), path.join(ROOT, "secrets", name)]) { try { const value=fs.readFileSync(file,"utf8").trim(); if(value)return value; } catch {} } return ""; }
async function main() {
  const guard=spawnSync(process.execPath,[path.join(ROOT,"scripts","supabase-incident-guard.js"),"check","--class=writer","--action=apply-daytrade-futopt-star-retest-readback"],{cwd:ROOT,stdio:"inherit",windowsHide:true});
  if(guard.status!==0) throw new Error("supabase_incident_guard_blocked");
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||secret("supabase-service-role-key.txt");
  if(!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  const sql=fs.readFileSync(SQL_FILE,"utf8"); let method="exec_sql.query";
  async function rpc(body){const response=await fetch(`${URL}/rest/v1/rpc/exec_sql`,{method:"POST",headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});const text=await response.text();if(!response.ok)throw new Error(`exec_sql HTTP ${response.status}: ${text.slice(0,600)}`);}
  try{await rpc({query:sql});}catch(first){try{method="exec_sql.sql";await rpc({sql});}catch(second){method="psql";const db=secret("supabase-db-url.txt");if(!db)throw second;const psql=process.env.PSQL_PATH||"C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe";const result=spawnSync(psql,[db,"-v","ON_ERROR_STOP=1","-f",SQL_FILE],{encoding:"utf8",timeout:120000,windowsHide:true});if(result.error||result.status!==0)throw new Error(String(result.stderr||result.error||"psql failed").slice(0,1000));}}
  const receiptPath=path.join(RUNTIME,"data","scan-receipts","daytrade-futopt-star-retest-readback-apply.json");
  const receipt={ok:true,status:"complete",contract:"daytrade-futopt-star-open-retest-apply-v1",applied_at:new Date().toISOString(),view:"v_fugle_daytrade_star_preopen_readback",sql_file:SQL_FILE,method,natural_evidence_mutated:false,receipt_path:receiptPath};
  fs.mkdirSync(path.dirname(receiptPath),{recursive:true});fs.writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+"\n");console.log(JSON.stringify(receipt,null,2));
}
main().catch((error)=>{console.error(error.message);process.exitCode=1;});
