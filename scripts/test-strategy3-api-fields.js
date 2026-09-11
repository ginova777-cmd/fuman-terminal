"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createRequire } = require("module");
const file = path.resolve(__dirname, "../api/strategy3-v2-latest.js");
const sandbox = { require: createRequire(file), module: { exports: {} }, process, console, __dirname: path.dirname(file), URL, Intl };
vm.runInNewContext(fs.readFileSync(file, "utf8") + "\nmodule.exports.normalizeRow = normalizeRow;", sandbox, { filename: file });
test("mobile percentage remains numeric and entry uses Taipei time", () => {
  const row = sandbox.module.exports.normalizeRow({ code: "2305", change_percent: 6.62, entry_candle_time: "2026-09-11T04:59:00Z", entry_price: 41.05, close_price: 41.05 });
  assert.equal(row.percent, 6.62);
  assert.equal(row.pct, "+6.62%");
  assert.match(row.reason, /12:59 進場價=41.05/);
});
