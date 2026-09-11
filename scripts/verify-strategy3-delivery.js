"use strict";
const fs = require("fs");
const path = require("path");
const { verifyDelivery } = require("../lib/strategy3-delivery-evidence");
const runtime = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
const compact = date.replace(/\D/g, "");
const recovery = process.argv.includes("--recovery-replay");
const receipts = path.join(runtime, "data", "scan-receipts");
const read = file => { try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } };
const scan = read(path.join(receipts, `strategy3-v2-${recovery ? "recovery-replay" : "complete-scan"}-${compact}.json`));
const evidence = {
  scan, date,
  ui: read(path.join(runtime, "data", "strategy3-ui", "terminal-ui-e2e-report.json")),
  tri: read(path.join(receipts, "tri-surface-closures", "strategy3.json")),
  collection: read(path.join(receipts, `scorecard88-collection-${compact}-1315.json`)),
  current: read(path.join(runtime, "data", "scorecard-terminal-current.json")),
  line: read(path.join(runtime, "data", "line-cards", `strategy3-v2-line-card-${compact}${recovery ? ".recovery-replay" : ""}.json`)),
};
const result = verifyDelivery(evidence);
const payload = { contract: "strategy3-delivery-verifier-v1", ...result, tradeDate: date, runId: scan?.run_id || null, checkedAt: new Date().toISOString(), recoveryReplay: recovery };
const out = path.join(receipts, `strategy3-delivery-verifier-${compact}${recovery ? "-recovery" : ""}.json`);
fs.mkdirSync(receipts, { recursive: true });
fs.writeFileSync(out, JSON.stringify(payload, null, 2));
console.log(JSON.stringify({ ...payload, receiptPath: out }, null, 2));
process.exitCode = result.ok ? 0 : 1;
