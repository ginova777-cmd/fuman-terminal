"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("fs"), vm = require("vm");
const { staticMapping } = require("../lib/verify-mother-pool-industry-mapping");
test("writer mapping evidence matches verifier hash including trailing newline", () => {
  const source = fs.readFileSync(require.resolve("./run-daytrade-source-writer"), "utf8");
  const begin = source.indexOf("function readHeatmapStaticGroupMap()"), end = source.indexOf("const MOPS_INDUSTRY_NAMES", begin);
  const context = { fs, require, Map, HEATMAP_API_FILE: require.resolve("../api/heatmap"),
    readText: file => fs.readFileSync(file, "utf8").trim(),
    extractConstObjectLiteral: () => JSON.stringify(staticMapping().groups),
    addGroupContractRow: (map, row) => map.set(String(row.symbol), row) };
  vm.createContext(context); vm.runInContext(source.slice(begin, end), context);
  const rows = context.readHeatmapStaticGroupMap();
  assert(rows.size > 0);
  for (const row of rows.values()) assert.equal(row.detailedEvidence.version, staticMapping().version);
});
