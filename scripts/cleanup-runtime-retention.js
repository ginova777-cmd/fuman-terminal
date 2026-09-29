"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME = "C:\\fuman-runtime";
const TERMINAL = "C:\\fuman-terminal";
const PUBLISH_SYNC = "C:\\fuman-terminal-publish-sync";
const { assertTree, treeExpired } = require('./cleanup-path-protection');
const DAY = 86400000;
const apply = process.argv.includes("--apply");
const json = process.argv.includes("--json");

function taipeiDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts();
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}${get("month")}${get("day")}`;
}
function expired(stat, days) { return stat.mtimeMs < Date.now() - days * DAY; }
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
    if (treeExpired(full, Date.now() - days * DAY)) list.push({ path: full, bytes: dirBytes(full), kind: "directory" });
  }
}
function listCandidates() {
  const list = [];
  findFiles(path.join(RUNTIME, "state"), (name) => /^daytrade-unattended-gate-(?:watchdog|0700|0845|0900|0910|0935)-evidence-.*\.json$/i.test(name), 15, list);
  // Sealed logs are owned by cleanup-local-assets, with retirement and reference evidence.
  findFiles(path.join(RUNTIME, "cache", "fugle"), () => true, 7, list);
  // Test outputs and final-audit directories require explicit retirement evidence.
  return list;
}
async function main() {
const localAssets = await require("./run-cleanup-local-assets").run({apply,noStatus:process.argv.includes("--no-status"),maintenanceAuthorization:process.argv.find(x=>x.startsWith("--maintenance-authorization="))?.slice("--maintenance-authorization=".length)});
if (!localAssets.ok) throw Error("local_assets_failed");
const candidates = listCandidates();
const deleted = [];
const failures = [];
if (apply) for (const item of candidates) {
  try { const allowedRoot = [RUNTIME, TERMINAL, PUBLISH_SYNC].find(root => item.path.toLowerCase().startsWith(root.toLowerCase() + path.sep)); if (!allowedRoot) throw Error("cleanup_root_not_allowed"); assertTree(allowedRoot,item.path); fs.rmSync(item.path, { recursive: item.kind === "directory", force: true }); deleted.push(item); }
  catch (error) { failures.push({ path: item.path, error: error.message }); }
}
const payload = {
  localAssets, ok: failures.length === 0, applied: apply, dryRun: !apply, checkedAt: new Date().toISOString(), contract: "runtime-retention-v1",
  retention: { watchdogEvidenceDays: 15, datedLogsDays: 30, fugleCacheDays: 7, testOutputsDays: 30, retiredVersionsDays: 45, terminatedTempDays: 7 },
  protected: ["cache/intraday/fugle-daytrade-ws-candles.json", "daily OHLCV and volume", "Strategy3/4 results", "/88, mobile and latest scorecard", "newest 15 days of formal evidence", "production-health.jsonl"],
  candidates: candidates.length + localAssets.candidates.length, candidateBytes: [...candidates,...localAssets.candidates].reduce((n, item) => n + item.bytes, 0),
  candidateItems: process.argv.includes("--list") ? candidates : undefined,
  deleted: deleted.length + localAssets.processed.length, deletedBytes: [...deleted,...localAssets.processed].reduce((n, item) => n + item.bytes, 0), failures,
};
const status = path.join(RUNTIME, "status");
fs.mkdirSync(status, { recursive: true });
payload.receiptFile = path.join(status, `runtime-retention-${taipeiDate()}.json`);
if (!process.argv.includes("--no-status")) fs.writeFileSync(payload.receiptFile, `${JSON.stringify(payload, null, 2)}\n`);
console.log(json ? JSON.stringify(payload, null, 2) : `runtime retention: ${payload.deleted}/${payload.candidates}`);
if (!payload.ok) process.exitCode = 1;

}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
