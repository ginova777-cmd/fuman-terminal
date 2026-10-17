"use strict";

const fs = require("fs");
const path = require("path");
const { serverSupabaseKey, serverSupabaseUrl } = require("../lib/server-supabase-key");

const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const apply = process.argv.includes("--apply");
const json = process.argv.includes("--json");
function dateId() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("-", ""); }
function headers() { const key = serverSupabaseKey(); if (!key) throw new Error("missing Supabase service role key"); return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }; }
async function rpc(name, body) {
  const response = await fetch(`${serverSupabaseUrl().replace(/\/$/, "")}/rest/v1/rpc/${name}`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${name} HTTP ${response.status}: ${text.slice(0, 280)}`);
  return text ? JSON.parse(text) : {};
}
const expectedTables=['fugle_daytrade_source_scorecard','fugle_daytrade_source_speed_scorecard','fugle_daytrade_gate_scorecard','fugle_source_coverage'];
function validStatus(s){return s?.ok===true&&s.keepDays===15&&Array.isArray(s.tables)&&s.tables.length===expectedTables.length&&new Set(s.tables.map(t=>t.table)).size===expectedTables.length&&s.tables.every(t=>expectedTables.includes(t.table)&&typeof t.hasOldRows==='boolean'&&typeof t.hasProtectedRows==='boolean');}
function oldRows(status) { return (status.tables || []).some((row) => row.hasOldRows === true); }
async function main() {
  const contextFile=process.env.FUMAN_CLEANUP_CONTEXT_FILE;
  const maintenance=contextFile?require('./cleanup-maintenance-context').authorization(contextFile):null;
  const observation=require('./cleanup-database-observation');
  const capture=async()=>{const result=[];for(const table of expectedTables){const rows=await observation.inventory(table,'trade_date.asc',{url:serverSupabaseUrl(),headers:headers(),fetch});for(const value of rows)result.push({table,value,...observation.row(table,value)});}return result;};
  const before = await rpc("fuman_source_observability_retention_status", { p_keep_days: 15 });
  if(!validStatus(before))throw Error('observability_inventory_incomplete');
  const rawBefore=maintenance?await capture():null;
  if(maintenance&&!/^\d{4}-\d{2}-\d{2}$/.test(before.keepFromDate||''))throw Error('observability_cutoff_missing');
  const candidates=rawBefore?.filter(r=>r.value.trade_date!=null&&String(r.value.trade_date)<before.keepFromDate).map(r=>r.key);
  const recoveryArchives=apply&&maintenance?[require('./cleanup-recovery-archive').seal(RUNTIME,maintenance.runId,'C20',Object.fromEntries(expectedTables.map(t=>[t,rawBefore.filter(r=>r.table===t).map(r=>r.value)])))]:[];
  const archiveBudget=require('./cleanup-archive-budget.cjs'),sealedPayload=apply?archiveBudget.fromArchive(recoveryArchives[0]):null;
  if(apply)for(const table of expectedTables)sealedPayload[table]=sealedPayload[table].filter(row=>row.trade_date!=null&&String(row.trade_date)<before.keepFromDate);
  const applyArchived=async()=>{const result=await rpc('fuman_cleanup_source_observability_15d_once',{p_apply:true,p_batch_size:5000,p_max_batches_per_table:10,p_archive:sealedPayload});if(result.archiveBudgetContract!=='cleanup-archive-multiset-v1')throw Error('observability_archive_contract_missing');archiveBudget.consume(sealedPayload,result.archivedDeleted);return result;};
  if(apply && before.tables.some(t=>t.hasOldRows && !t.hasProtectedRows))throw Error('observability_protected_window_missing');
  const cleanup = apply ? await applyArchived() : {ok:true,applied:false,deletedRows:0,previewOnly:true};
  let after = await rpc("fuman_source_observability_retention_status", { p_keep_days: 15 });
  const batches=apply?[cleanup]:[];
  for(let n=1;apply && validStatus(after) && oldRows(after) && n<20;n++){
    if(batches.at(-1).ok!==true||!(batches.at(-1).deletedRows>0))throw Error('observability_cleanup_no_progress');
    batches.push(await applyArchived());
    after=await rpc('fuman_source_observability_retention_status',{p_keep_days:15});
  }
  const payload = {
    ok: cleanup.ok === true && validStatus(after) && after.tables.every(t=>t.hasOldRows===false), applied: apply, dryRun: !apply, checkedAt: new Date().toISOString(),
    contract: "source-observability-retention-15d-v1", before, cleanup, batches, after,
    remaining: validStatus(after)&&!oldRows(after)?0:null,
    deletedRows:batches.reduce((n,b)=>n+Number(b.deletedRows||0),0),
    reasonCode: cleanup.reasonCode || (oldRows(after) ? "source_observability_retention_draining" : "ok"),
    allowedAction: cleanup.allowedAction || (oldRows(after) ? "continue_next_after_close_window" : "retention_complete"),
  };
  if(apply&&maintenance){
    const rawAfter=await capture();
    const item=require('./cleanup-item-observation').persist(path.join(RUNTIME,'status/cleanup-items',maintenance.runId,'C20.json'),{contract:'cleanup-item-observation-v1',id:'C20',runId:maintenance.runId,inventoryComplete:true,readbackComplete:true,before:rawBefore.map(({key,sha256})=>({key,sha256})),after:rawAfter.map(({key,sha256})=>({key,sha256})),candidates,recoveryArchives,checkedAt:new Date().toISOString()});
    payload.cleanupItems=[item];payload.maintenanceRunId=maintenance.runId;
    if(item.deleted!==payload.deletedRows)throw Error('observability_deleted_count_mismatch');
  }
  const dir = path.join(RUNTIME, "status"); fs.mkdirSync(dir, { recursive: true });
  payload.receiptFile = path.join(dir, `source-observability-retention-${dateId()}.json`);
  fs.writeFileSync(payload.receiptFile, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(json ? JSON.stringify(payload, null, 2) : `${payload.reasonCode}: ${cleanup.deletedRows || 0}`);
  if (!payload.ok) process.exitCode = 1;
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, contract: "source-observability-retention-15d-v1", error: error.message }, null, 2)); process.exitCode = 1; });
