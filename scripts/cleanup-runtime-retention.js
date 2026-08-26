"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME = "C:\\fuman-runtime";
const TERMINAL = "C:\\fuman-terminal";
const PUBLISH_SYNC = "C:\\fuman-terminal-publish-sync";
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
    bytes += entry.isDirectory() ? dirBytes(full) : fs.statSync(full).size;
  }
  return bytes;
}
function findFiles(root, allow, days, list) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
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
    if (expired(stat, days)) list.push({ path: full, bytes: dirBytes(full), kind: "directory" });
  }
}
function listCandidates() {
  const list = [];
  findFiles(path.join(RUNTIME, "state"), (name) => /^daytrade-unattended-gate-(?:watchdog|0700|0845|0900|0910|0935)-evidence-.*\.json$/i.test(name), 15, list);
  findFiles(path.join(RUNTIME, "logs"), (name) => /^(?:production-health-monitor-\d{8}|strategy3-complete-scan-.*)\.(?:log|jsonl)$/i.test(name), 30, list);
  findFiles(path.join(RUNTIME, "cache", "fugle"), () => true, 7, list);
  const testName = /(?:test|e2e|parity|probe|matrix|smoke|collector|regression)/i;
  for (const root of [path.join(TERMINAL, "outputs"), path.join(RUNTIME, "outputs"), path.join(PUBLISH_SYNC, "outputs")]) findDirs(root, (name) => testName.test(name), 7, list);
  findDirs(path.join(TERMINAL, "outputs", "terminal-final-audit"), () => true, 30, list);
  return list;
}
const candidates = listCandidates();
const deleted = [];
const failures = [];
if (apply) for (const item of candidates) {
  try { fs.rmSync(item.path, { recursive: item.kind === "directory", force: true }); deleted.push(item); }
  catch (error) { failures.push({ path: item.path, error: error.message }); }
}
const payload = {
  ok: failures.length === 0, applied: apply, dryRun: !apply, checkedAt: new Date().toISOString(), contract: "runtime-retention-v1",
  retention: { watchdogEvidenceDays: 15, datedLogsDays: 30, fugleCacheDays: 7, testOutputsDays: 7, finalAuditDays: 30 },
  protected: ["cache/intraday/fugle-daytrade-ws-candles.json", "daily OHLCV and volume", "Strategy3/4 results", "/88, mobile and latest scorecard", "newest 15 days of formal evidence", "production-health.jsonl"],
  candidates: candidates.length, candidateBytes: candidates.reduce((n, item) => n + item.bytes, 0),
  deleted: deleted.length, deletedBytes: deleted.reduce((n, item) => n + item.bytes, 0), failures,
};
const status = path.join(RUNTIME, "status");
fs.mkdirSync(status, { recursive: true });
payload.receiptFile = path.join(status, `runtime-retention-${taipeiDate()}.json`);
fs.writeFileSync(payload.receiptFile, `${JSON.stringify(payload, null, 2)}\n`);
console.log(json ? JSON.stringify(payload, null, 2) : `runtime retention: ${payload.deleted}/${payload.candidates}`);
if (!payload.ok) process.exitCode = 1;
