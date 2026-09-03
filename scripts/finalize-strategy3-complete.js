"use strict";
const fs = require("fs");
const path = require("path");
const c = require("./strategy3-v2-contract");
const runtime = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const date = c.taipeiDate();
const compact = date.replace(/\D/g, "");
const receipts = path.join(runtime, "data", "scan-receipts");
const target = path.join(receipts, "strategy3.json");
const read = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const scan = read(path.join(receipts, `strategy3-v2-complete-scan-${compact}.json`));
const daily = read(path.join(receipts, `strategy3-v2-daily-unattended-closure-${compact}.json`));
const surface = daily?.surface || null;
const line = read(path.join(runtime, "data", "line-cards", `strategy3-v2-line-card-${compact}.json`));
const complete = !process.argv.includes("--record-failure") && scan?.ok === true && scan?.status === "COMPLETE" && scan?.apply === true
  && surface?.ok === true && line?.ok === true && line?.status === "PUSHED"
  && daily?.ok === true && daily?.status === "STRATEGY3_V2_DAILY_UNATTENDED_YES"
  && scan.run_id === surface?.canonical_api?.runId && scan.run_id === line.run_id && scan.run_id === daily.run_id;
const payload = { contract: "strategy-runner-verifier-receipt-v1", strategy: "strategy3", tradeDate: date,
  checkedAt: new Date().toISOString(), status: complete ? "complete" : "failed", complete, exitCode: complete ? 0 : 1,
  runId: scan?.run_id || null, count: Number(scan?.result_count || 0), runner: "run-strategy3-v2-complete-scan.ps1",
  verifier: "verify-strategy3-v2-daily-unattended-closure.js", evidence: {
    scan: scan ? { ok: scan.ok, status: scan.status, apply: scan.apply, runId: scan.run_id, count: scan.result_count } : null,
    surface: surface ? { ok: surface.ok, status: surface.status, runId: surface?.canonical_api?.runId } : null,
    line: line ? { ok: line.ok, status: line.status, personal: line.line_push_personal_ok, group: line.line_push_group_ok, runId: line.run_id } : null,
    daily: daily ? { ok: daily.ok, status: daily.status, firstBlocker: daily.first_blocker, runId: daily.run_id } : null } };
if (!process.argv.includes("--status-only") || !fs.existsSync(target)) { fs.mkdirSync(receipts, { recursive: true }); fs.writeFileSync(target, JSON.stringify(payload, null, 2), "utf8"); }
const output = process.argv.includes("--status-only") && fs.existsSync(target) ? read(target) : payload;
console.log(JSON.stringify({ ...output, receiptPath: target }, null, 2));
process.exitCode = output?.complete === true ? 0 : 1;
