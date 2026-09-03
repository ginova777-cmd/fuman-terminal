"use strict";

const fs = require("fs");
const path = require("path");

const runtime = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const file = path.join(runtime, "cache", "intraday", "fugle-daytrade-ws-symbols.json");
const payload = JSON.parse(fs.readFileSync(file, "utf8"));
const symbols = Array.isArray(payload.symbols) ? payload.symbols : [];

if (symbols.length < 300) {
  throw new Error(`strategy3_v2_water_universe_too_small:${symbols.length}`);
}

const next = {
  ...payload,
  websocketSymbolUniversePolicy: "active_universe_for_quote_and_candle_water_only_not_formal_gate",
  formalCandidateAllowed: false,
  publishAllowed: false,
  metadataUpdatedAt: new Date().toISOString(),
};

fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
console.log(JSON.stringify({
  ok: true,
  status: "COMPLETE",
  contract: "strategy3-v2-water-metadata-repair-v1",
  symbol_count: symbols.length,
  symbol_values_changed: false,
  path: file,
}, null, 2));
