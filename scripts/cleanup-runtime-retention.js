"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const TERMINAL = "C:\\fuman-terminal";
const PUBLISH_SYNC = "C:\\fuman-terminal-publish-sync";
const { assertTree, treeExpired } = require('./cleanup-path-protection');
const {cutoff,describe}=require('./cleanup-local-calendar');
const apply = process.argv.includes("--apply");
const json = process.argv.includes("--json");

function taipeiDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts();
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}${get("month")}${get("day")}`;
}
function expired(stat, days) { return stat.mtimeMs < cutoff(Date.now(), days); }
function dirBytes(root) {
  let bytes = 0;
  if (!fs.existsSync(root)) return bytes;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    assertTree(root, full);
    bytes += entry.isDirectory() ? dirBytes(full) : fs.statSync(full).size;
  }
  return bytes;
}
function findFiles(root, allow, days, list) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    assertTree(root,full);
    if (entry.isDirectory()) findFiles(full, allow, days, list);
    else {
      const stat = fs.statSync(full);
      if (allow(entry.name) && expired(stat, days)) list.push({ path: full, bytes: stat.size, kind: "file" });
    }
  }
}
function findDirs(root, allow, days, list) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !allow(entry.name)) continue;
    const full = path.join(root, entry.name);
    const stat = fs.statSync(full);
    if (treeExpired(full, cutoff(Date.now(), days))) list.push({ path: full, bytes: dirBytes(full), kind: "directory" });
  }
}
const crypto = require("crypto");
const { classifyEvidence, buildEvidenceReview } = require("./cleanup-evidence-protection");
const evidenceDecisions = [];
const cacheDecisions = [];
let evidenceReview;
async function listCandidates() {
  const list = [];
  findFiles(path.join(RUNTIME, "state"), (name) => /^daytrade-unattended-gate-(?:watchdog|0700|0845|0900|0910|0935)-evidence-.*\.json$/i.test(name), 7, list);
  const review=evidenceReview=await buildEvidenceReview(list,{runtime:RUNTIME,referenceInventory:require('./cleanup-extended-retention').referenceInventory});
  for(let i=list.length-1;i>=0;i--){
    const item=list[i]; const sha256=crypto.createHash('sha256').update(fs.readFileSync(item.path)).digest('hex');
    const row=review?.contract==='cleanup-evidence-protection-v1'?review.entries?.find(r=>r.path===item.path):null;
    const decision=classifyEvidence(row,Date.now(),sha256);
    evidenceDecisions.push({path:item.path,sha256,...decision});
    if(!decision.eligible)list.splice(i,1); else item.sha256=sha256;
  }
  // Sealed logs are owned by cleanup-local-assets, with retirement and reference evidence.
  // LAB intake is deferred. Age alone proves neither retirement nor reader safety.
  // Inventory every expired candidate, but retain it until its consumers are known.
  const cacheCandidates=[];
  findFiles(path.join(RUNTIME, "cache", "fugle"), () => true, 7, cacheCandidates);
  for(const item of cacheCandidates)cacheDecisions.push({...item,eligible:false,reason:'lab_reference_or_safety_unverified',sha256:crypto.createHash('sha256').update(fs.readFileSync(item.path)).digest('hex')});
  // Test outputs and final-audit directories require explicit retirement evidence.
  return list;
}
function inventoryFor(id){
 const root=path.join(RUNTIME,id==='C17'?'state':'cache/fugle'),out=[];
 function visit(dir){if(!fs.existsSync(dir))return;for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);assertTree(root,file);if(entry.isDirectory())visit(file);else if(id==='C18'||/^daytrade-unattended-gate-(?:watchdog|0700|0845|0900|0910|0935)-evidence-.*\.json$/i.test(entry.name)){const bytes=fs.readFileSync(file);out.push({key:file,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}}}
 visit(root);return out.sort((a,b)=>a.key.localeCompare(b.key));
}
async function main() {
const authorizationFile=process.argv.find(x=>x.startsWith('--maintenance-authorization='))?.slice('--maintenance-authorization='.length);
const maintenance=authorizationFile?require('./cleanup-maintenance-context').authorization(authorizationFile):null;
const before={C17:inventoryFor('C17'),C18:inventoryFor('C18')};
const localAssets = await require("./run-cleanup-local-assets").run({apply,noStatus:process.argv.includes("--no-status"),maintenanceAuthorization:process.argv.find(x=>x.startsWith("--maintenance-authorization="))?.slice("--maintenance-authorization=".length)});
if (!localAssets.ok) throw Error("local_assets_failed");
const candidates = await listCandidates();
const deleted = [];
const failures = [];
if (apply) for (const item of candidates) {
  try { const allowedRoot = [RUNTIME, TERMINAL, PUBLISH_SYNC].find(root => item.path.toLowerCase().startsWith(root.toLowerCase() + path.sep)); if (!allowedRoot) throw Error("cleanup_root_not_allowed"); assertTree(allowedRoot,item.path); if(item.sha256 && crypto.createHash("sha256").update(fs.readFileSync(item.path)).digest("hex")!==item.sha256) throw Error("evidence_changed_before_delete"); fs.rmSync(item.path, { recursive: item.kind === "directory", force: true }); deleted.push(item); }
  catch (error) { failures.push({ path: item.path, error: error.message }); }
}
for(const d of [...evidenceDecisions,...cacheDecisions]){if(!d.eligible && (!fs.existsSync(d.path)||crypto.createHash('sha256').update(fs.readFileSync(d.path)).digest('hex')!==d.sha256))failures.push({path:d.path,error:'protected_evidence_readback_failed'});}
for(const d of deleted){if(fs.existsSync(d.path))failures.push({path:d.path,error:'deleted_file_readback_failed'});}
const payload = {
  evidenceReview, independentReadback: {protectedFiles:[...evidenceDecisions,...cacheDecisions].filter(d=>!d.eligible).length,deletedFiles:deleted.length,ok:failures.length===0},
  evidenceDecisions, cacheDecisions, evidenceReviewComplete: evidenceDecisions.every(d=>!['protection_evidence_missing_or_stale','reference_review_not_current','incident_or_success_unknown','retention_start_invalid','formal_or_rollback_policy_unknown'].includes(d.reason)),
  maintenanceRunId:maintenance?.runId||null,maintenanceAuthorizationSha256:maintenance?.sha256||null,
  localAssets, ok: failures.length === 0, applied: apply, dryRun: !apply, checkedAt: new Date().toISOString(), contract: "runtime-retention-v1",
  localCalendar: describe(),
  retention: { watchdogEvidenceDays: 7, datedLogsDays: 7, fugleCacheDays: 7, testOutputsDays: 7, retiredVersionsDays: 7, terminatedTempDays: 7 },
  protected: ["cache/intraday/fugle-daytrade-ws-candles.json", "daily OHLCV and volume", "Strategy3/4 results", "/88, mobile and latest scorecard", "formal or unresolved evidence regardless of age", "production-health.jsonl"],
  candidates: candidates.length + localAssets.candidates.length, candidateBytes: [...candidates,...localAssets.candidates].reduce((n, item) => n + item.bytes, 0),
  candidateItems: process.argv.includes("--list") ? candidates : undefined,
  deleted: deleted.length + localAssets.processed.length, deletedBytes: [...deleted,...localAssets.processed].reduce((n, item) => n + item.bytes, 0), failures,
};
if(apply && maintenance){
 payload.cleanupItems=[];
 for(const id of ['C17','C18']){
  const keys=new Set(before[id].map(r=>r.key));
  const decisions=id==='C17'?evidenceDecisions:cacheDecisions;
  const observation={contract:'cleanup-item-observation-v1',id,runId:maintenance.runId,inventoryComplete:true,readbackComplete:true,before:before[id],after:inventoryFor(id),candidates:candidates.filter(c=>keys.has(c.path)).map(c=>c.path),protectedExclusions:decisions.filter(d=>!d.eligible).map(d=>({key:d.path,reason:d.reason})),checkedAt:new Date().toISOString()};
  const proofFile=path.join(RUNTIME,'status','cleanup-items',maintenance.runId,id+'.json');
  payload.cleanupItems.push(require('./cleanup-item-observation').persist(proofFile,observation));
 }
}
const status = path.join(RUNTIME, "status");
fs.mkdirSync(status, { recursive: true });
payload.receiptFile = path.join(status, `runtime-retention-${taipeiDate()}.json`);
if (!process.argv.includes("--no-status")) fs.writeFileSync(payload.receiptFile, `${JSON.stringify(payload, null, 2)}\n`);
console.log(json ? JSON.stringify(payload, null, 2) : `runtime retention: ${payload.deleted}/${payload.candidates}`);
if (!payload.ok) process.exitCode = 1;

}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
