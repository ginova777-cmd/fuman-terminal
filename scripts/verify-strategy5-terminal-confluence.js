"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const latestSignals = require(path.join(ROOT, "api", "latest-signals"));

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function entry(key, score = 0, internalCount = 0) {
  return { key, label: key, score, rawScore: score, internalCount, details: [`${key}-detail`] };
}

function main() {
  assert.strictEqual(typeof latestSignals.buildConfluencePayload, "function", "buildConfluencePayload must be testable");

  const payload = latestSignals.buildConfluencePayload({
    updatedAt: "2026-09-06T10:00:00.000Z",
    byCode: {
      "4444": [entry("strategy2", 999), entry("strategy3", 10), entry("strategy3", 99), entry("strategy4", 20), entry("strategy5", 30, 3), entry("institution", 40)],
      "3333": [entry("strategy3", 10), entry("strategy4", 20), entry("strategy5", 30)],
      "2222": [entry("strategy3", 10), entry("institution", 20)],
      "1111": [entry("strategy2", 999), entry("strategy3", 10)],
    },
    namesByCode: { "4444": "四來源", "3333": "三來源", "2222": "二來源", "1111": "不合格" },
  }, { minCount: 2, limit: 120 });

  assert.deepStrictEqual(payload.confluenceSources, ["strategy3", "strategy4", "strategy5", "institution"]);
  assert.deepStrictEqual(payload.rows.map((row) => row.code), ["4444", "3333", "2222"], "rows must rank by 4, 3, 2 source appearances");
  assert.deepStrictEqual(payload.rows.map((row) => row.sourceCount), [4, 3, 2]);
  assert.strictEqual(payload.rows[0].matches.length, 4, "duplicate source must count once");
  assert.ok(payload.rows.every((row) => !row.sourceKeys.includes("strategy2")), "strategy2 must never count");
  assert.ok(!payload.rows.some((row) => row.code === "1111"), "strategy2 + one allowed source must not pass minCount=2");

  const config = read("terminal-strategy-config.js");
  const desktop = read("terminal-desktop-fast-shell.js");
  const app = read("terminal-app.js");
  assert.match(config, /label:\s*"策略共振"/);
  assert.match(config, /終端3／終端4／終端5／買賣超共同出現排名/);
  assert.match(desktop, /終端3\/4\/5＋買賣超排名/);
  assert.match(app, /fuman-terminal-confluence-s345-institution-v2/);

  console.log("[strategy5-terminal-confluence] PASS");
  console.log(JSON.stringify({
    ok: true,
    sources: payload.confluenceSources,
    ranking: payload.rows.map((row) => ({ code: row.code, count: row.sourceCount })),
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`[strategy5-terminal-confluence] FAIL: ${error.stack || error.message || error}`);
  process.exitCode = 1;
}
