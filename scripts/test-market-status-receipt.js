"use strict";
const assert = require("assert"); const fs = require("fs"); const os = require("os"); const path = require("path");
const root = path.resolve(__dirname, ".."); const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "fuman-market-status-")); const override = path.join(runtime, "data", "market-calendar-overrides.json"); fs.mkdirSync(path.dirname(override), { recursive: true });
// Explicit isolated calendar fixture; tests must not depend on live network/cache.
fs.mkdirSync(path.join(runtime, "state"), { recursive: true });
fs.writeFileSync(path.join(runtime, "state/twse-holiday-schedule-2026.json"), JSON.stringify({ cachedAt: new Date().toISOString(), rows: [{ Date: "1150101", Name: "fixture", Description: "市場無交易" }] }));
fs.writeFileSync(override, JSON.stringify({ overrides: [{ date: "2026-10-23", isTradingDay: false, reason: "typhoon_holiday", source: "official_typhoon_announcement", sourceUrl: "https://example.invalid/typhoon", announcementDate: "2026-10-23", effectiveAt: "2026-10-23T00:00:00+08:00", sourceSha256: "fixture-source-sha256" }] }));
const env = { ...process.env, FUMAN_RUNTIME_DIR: runtime, FUMAN_STATE_DIR: path.join(runtime, "state"), FUMAN_MARKET_CALENDAR_OVERRIDE_FILE: override }; function run(args) { return require("child_process").spawnSync(process.execPath, [path.join(root, "scripts", "write-market-status-receipt.js"), ...args], { env, encoding: "utf8" }); }
let r = run(["--stage=strategy4", "--trade-date=2026-10-23", "--execution-mode=natural", "--run-id=immutable-run"]); assert.equal(r.status, 10); assert.match(r.stdout, /MARKET_CLOSED_TY/);
const first = JSON.parse(r.stdout); r = run(["--stage=strategy5", "--trade-date=2026-10-23", "--execution-mode=diagnostic", "--run-id=other-run"]); assert.equal(r.status, 10); const second = JSON.parse(r.stdout); assert.equal(first.receiptPath, second.receiptPath); assert.equal(first.evidenceSha256, second.evidenceSha256);
for (const stage of ["morning-us_0820", "strategy3", "strategy4", "strategy5", "buy-sell", "scorecard"]) { const p = run([`--stage=${stage}`, "--trade-date=2026-10-23", "--execution-mode=natural"]); assert.equal(p.status, 10); const payload = JSON.parse(p.stdout); assert.equal(payload.receiptPath, first.receiptPath); }
r = run(["--stage=strategy4", "--trade-date=2026-10-24", "--execution-mode=natural"]); assert.equal(r.status, 10); assert.match(r.stdout, /MARKET_CLOSED/);
for (const stage of ["morning-us_0820", "strategy3", "strategy4", "strategy5", "buy-sell", "scorecard-1315"]) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const guard = require("child_process").spawnSync("pwsh.exe", ["-NoProfile", "-File", path.join(root, "scripts/invoke-market-status-guard.ps1"), "-Stage", stage, "-TradeDate", "2026-10-23"], { env, encoding: "utf8" });
    assert.equal(guard.status, 10, `${stage}: ${guard.stderr} ${guard.stdout}`);
    assert.equal(JSON.parse(guard.stdout).status, "SKIPPED");
    assert.equal(JSON.parse(guard.stdout).complete, false);
    assert.equal(JSON.parse(guard.stdout).scanExecuted, false);
  }
}
const forged = JSON.parse(fs.readFileSync(first.receiptPath, 'utf8')); forged.status='OPEN'; forged.exitCode=0;
fs.writeFileSync(first.receiptPath, JSON.stringify(forged));
r=run(['--stage=strategy4','--trade-date=2026-10-23']);
assert.equal(r.status,2); assert.match(r.stderr,/RECEIPT_CONFLICT/);
console.log("PASS market-status receipt: typhoon, weekend, immutable per-run paths; six PowerShell guards repeated twice; tampered receipt rejected");
