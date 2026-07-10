"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repo = path.resolve(__dirname, "..");
const script = path.join(repo, "scripts", "update-market-calendar-auto-override.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuman-market-calendar-auto-"));

function writeFixture(name, body) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, body, "utf8");
  return file;
}

function run(args, env = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, ...env, FUMAN_RUNTIME_DIR: tmp, FUMAN_DATA_DIR: path.join(tmp, "data") },
  });
  let payload = null;
  try { payload = JSON.parse(result.stdout); } catch {}
  return { result, payload };
}

const taipeiClosed = writeFixture("taipei-closed.html", `
<html><body>
115年 7月 10日 天然災害停止上班及上課情形
#### 更新時間：2026/07/10 05:00:00
北部地區
基隆市 今天照常上班、照常上課。
臺北市 今天停止上班、停止上課。
新北市 今天停止上班、停止上課。
桃園市 今天照常上班、照常上課。
</body></html>`);

const onlyNewTaipeiClosed = writeFixture("new-taipei-closed.html", `
<html><body>
115年 7月 10日 天然災害停止上班及上課情形
#### 更新時間：2026/07/10 05:00:00
北部地區
基隆市 今天照常上班、照常上課。
臺北市 今天照常上班、照常上課。
新北市 今天停止上班、停止上課。
桃園市 今天照常上班、照常上課。
</body></html>`);

const overrideFile = path.join(tmp, "data", "market-calendar-overrides.json");
const closed = run([`--fixture=${taipeiClosed}`, "--apply", `--override-file=${overrideFile}`, "--now=2026-07-10T05:10:00+08:00"]);
assert.strictEqual(closed.result.status, 0, closed.result.stderr);
assert.ok(closed.payload, "closed payload json");
assert.deepStrictEqual(closed.payload.targetAreas, ["臺北市"], "default target area is Taipei only");
assert.strictEqual(closed.payload.shouldCloseMarket, true, "Taipei stop work closes market");
assert.strictEqual(closed.payload.wroteOverride, true, "writes override");
assert.strictEqual(closed.payload.override.date, "2026-07-10", "override date");
assert.strictEqual(closed.payload.override.marketOpen, false, "override market closed");
assert.strictEqual(closed.payload.matchedAreas.length, 1, "only Taipei matched");
assert.strictEqual(closed.payload.matchedAreas[0].county, "臺北市", "matched Taipei");
const overridePayload = JSON.parse(fs.readFileSync(overrideFile, "utf8"));
assert.strictEqual(overridePayload.overrides.length, 1, "override file rows");
assert.strictEqual(overridePayload.overrides[0].source, "dgpa_auto_update", "source marker");

const noClose = run([`--fixture=${onlyNewTaipeiClosed}`, "--apply", `--override-file=${path.join(tmp, "data", "no-close-overrides.json")}`, "--now=2026-07-10T05:10:00+08:00"]);
assert.strictEqual(noClose.result.status, 0, noClose.result.stderr);
assert.strictEqual(noClose.payload.shouldCloseMarket, false, "New Taipei alone does not close market under Taipei-only rule");
assert.strictEqual(noClose.payload.wroteOverride, false, "does not write override");

console.log(JSON.stringify({
  ok: true,
  contract: "market-calendar-auto-update-verifier-v1",
  defaultTargetAreas: closed.payload.targetAreas,
  taipeiClosedAction: closed.payload.action,
  nonTaipeiClosedAction: noClose.payload.action,
  overrideFile,
}, null, 2));
