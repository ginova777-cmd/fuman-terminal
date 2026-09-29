"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const sql = path.join(root, "ops/public-slot/DaytradeIntraday5mReceiptFields_20260916.sql");
const secret = name => fs.readFileSync(path.join("C:/fuman-runtime/secrets", name), "utf8").trim();
async function probe() {
  const key = secret("supabase-anon-key.txt");
  const response = await fetch("https://cpmpfhbzutkiecccekfr.supabase.co/rest/v1/v_fugle_intraday_5m_verification_readback?select=contract,strategy_version,calculation_version,classification_contract,macd_parameters,run_id,trade_date,status,complete,exit_code,first_blocker,verified_at&order=verified_at.desc&limit=1", {
    headers: {apikey:key, Authorization:`Bearer ${key}`}, signal:AbortSignal.timeout(20000) });
  const body = await response.json();
  return { http:response.status, rows:Array.isArray(body)?body.length:0, error:Array.isArray(body)?null:body,
    row:Array.isArray(body)?body[0]:null };
}
(async()=>{
  const out={contract:"daytrade_5m_receipt_fields_repair_v1",started_at:new Date().toISOString(),sql_sha256:crypto.createHash("sha256").update(fs.readFileSync(sql)).digest("hex"),applied:false,before:await probe()};
  if(process.argv.includes("--apply")) {
    const uri=new URL(secret("supabase-db-url.txt"));
    const env={...process.env,PGHOST:uri.hostname,PGPORT:uri.port||"5432",PGDATABASE:decodeURIComponent(uri.pathname.slice(1)),PGUSER:decodeURIComponent(uri.username),PGPASSWORD:decodeURIComponent(uri.password),PGSSLMODE:uri.searchParams.get("sslmode")||"require"};
    const result=spawnSync("C:/Program Files/PostgreSQL/17/bin/psql.exe",["-X","-v","ON_ERROR_STOP=1","-f",sql],{env,encoding:"utf8",windowsHide:true,timeout:30000});
    out.migration_exit_code=result.status;
    if(result.error||result.status!==0)throw new Error("receipt_field_migration_failed: "+String(result.error?.code||result.stderr).slice(0,300));
    out.applied=true;
  }
  out.after=await probe();
  out.status=out.after.http===200?"complete":"blocked";
  out.complete=out.status==="complete";
  out.scope="verification_view_column_readback_only";
  out.overall_intraday_complete=false;
  out.finished_at=new Date().toISOString();
  fs.mkdirSync(path.join(root,"outputs"),{recursive:true});
  fs.writeFileSync(path.join(root,"outputs/5m-receipt-fields-repair.json"),JSON.stringify(out,null,2));
  console.log(JSON.stringify(out,null,2));
  if(!out.complete)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1});
