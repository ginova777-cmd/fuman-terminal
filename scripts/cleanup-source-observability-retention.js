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
  const before = await rpc("fuman_source_observability_retention_status", { p_keep_days: 15 });
  if(!validStatus(before))throw Error('observability_inventory_incomplete');
  if(apply && before.tables.some(t=>t.hasOldRows && !t.hasProtectedRows))throw Error('observability_protected_window_missing');
  const cleanup = apply ? await rpc("fuman_cleanup_source_observability_15d_once", { p_apply: true, p_batch_size: 5000, p_max_batches_per_table: 10 }) : {ok:true,applied:false,deletedRows:0,previewOnly:true};
  let after = await rpc("fuman_source_observability_retention_status", { p_keep_days: 15 });
  const batches=apply?[cleanup]:[];
  for(let n=1;apply && validStatus(after) && oldRows(after) && n<20;n++){
    if(batches.at(-1).ok!==true||!(batches.at(-1).deletedRows>0))throw Error('observability_cleanup_no_progress');
    batches.push(await rpc('fuman_cleanup_source_observability_15d_once',{p_apply:true,p_batch_size:5000,p_max_batches_per_table:10}));
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
  const dir = path.join(RUNTIME, "status"); fs.mkdirSync(dir, { recursive: true });
  payload.receiptFile = path.join(dir, `source-observability-retention-${dateId()}.json`);
  fs.writeFileSync(payload.receiptFile, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(json ? JSON.stringify(payload, null, 2) : `${payload.reasonCode}: ${cleanup.deletedRows || 0}`);
  if (!payload.ok) process.exitCode = 1;
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, contract: "source-observability-retention-15d-v1", error: error.message }, null, 2)); process.exitCode = 1; });
