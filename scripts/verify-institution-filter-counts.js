"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const api = require(path.resolve(__dirname, "..", "api", "institution-latest.js"));

const rows = [
  { code: "2317", payload: { foreign: 2000, trust: 1000, foreignStreak: 3, trustStreak: 2, jointStreak: 2, fiveDayAvgVolume: 10000 } },
  { code: "2303", payload: { foreign: 1000, trust: -200, foreignStreak: 1, trustStreak: 0, jointStreak: 0, fiveDayAvgVolume: 8000 } },
  { code: "2324", payload: { foreign: -500, trust: 900, foreignStreak: 0, trustStreak: 1, jointStreak: 0, fiveDayAvgVolume: 7000 } },
];

const counts = api._test.buildInstitutionFilterCounts(rows);
assert.equal(counts.contract, "institution-filter-counts-v1");
assert.equal(counts.rowsChecked, 3);
assert.equal(counts.foreignStreak, 2);
assert.equal(counts.trustStreak, 2);
assert.equal(counts.jointStreak, 1);
assert.equal(counts.foreignTrustVolumePct, 3);

const shell = fs.readFileSync(path.resolve(__dirname, "..", "terminal-desktop-fast-shell.js"), "utf8");
assert(shell.includes('"chip-trade|買賣超": { limit: 60, ttl: 32000, live: true, noSnapshot: true }'));
assert(shell.includes('payloadMeta?.filterCounts?.contract === "institution-filter-counts-v1"'));
assert(shell.includes('!withBust && !options.noSnapshot'));

console.log(JSON.stringify({
  contract: "institution-filter-counts-verifier-v1",
  status: "complete",
  ok: true,
  counts,
  checkedAt: new Date().toISOString(),
}, null, 2));
