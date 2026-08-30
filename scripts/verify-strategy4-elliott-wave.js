"use strict";
const assert = require("../lib/elliott-wave");
const prices = [100,120,108,145,128,165];
const rows = [];
for (let i = 0; i < 45; i += 1) rows.push({ trade_date: `2025-11-${String(i % 28 + 1).padStart(2,"0")}`, high: 99.2, low: 98.8, close: 99 });
let day = 1;
for (let segment = 0; segment < prices.length - 1; segment += 1) {
  for (let step = 0; step < 10; step += 1) {
    const value = prices[segment] + (prices[segment + 1] - prices[segment]) * step / 10;
    rows.push({ trade_date: `2026-01-${String(day++).padStart(2,"0")}`, high: value * 1.002, low: value * 0.998, close: value });
  }
}
const result = assert.detectElliottWave(rows);
if (!["confirmed","probable"].includes(result.status) || result.pattern !== "impulse_1_5") throw new Error(JSON.stringify(result));
console.log(JSON.stringify({ok:true,contract:"strategy4_elliott_wave_v1",result},null,2));
