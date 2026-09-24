"use strict";

// 獨立空方開盤入檢視器：只讀取既有 postclose receipt，不修改原開盤入流程。
const fs = require("fs");
const path = require("path");

const runtime = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const arg = (name) => process.argv.find((x) => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const tradeDate = arg("trade-date") || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
const stamp = tradeDate.replace(/-/g, "");
const receipt = path.join(runtime, "data", "opening-limit-order", `opening-short-postclose-${stamp}.json`);

let source;
try { source = JSON.parse(fs.readFileSync(receipt, "utf8")); } catch (error) {
  console.log(JSON.stringify({ ok: false, contract: "opening_short_only_readonly_v1", trade_date: tradeDate, status: "MISSING", reason: "空方收據不存在或無法讀取", receipt, rows: [], action_guard: { creates_order: false, publish_allowed: false } }, null, 2));
  process.exitCode = 1;
  process.exit(1);
}

const rows = (source.rows || []).filter((row) => row.matched === true).map((row) => ({
  代號: row.symbol,
  名稱: row.name,
  開盤入策略: "開盤空",
  預言家: "空（等待T+1 08:50試撮）",
  原因: `T日漲停；14:00 KD(5,3) ${row.kd_5_3?.k > 90 ? "K>90過熱" : "K線與D線黏線"}；凱基－城中${row.checks?.kgi_chengzhong_present ? "加分" : "未取得"}`,
  K: row.kd_5_3?.k ?? null,
  D: row.kd_5_3?.d ?? null,
  凱基城中加分: row.checks?.kgi_chengzhong_present === true,
  資料缺口: row.data_gaps || []
}));

console.log(JSON.stringify({ ok: true, contract: "opening_short_only_readonly_v1", trade_date: tradeDate, source_receipt: receipt, candidate_count: rows.length, rows, action_guard: { creates_order: false, creates_formal_candidate: false, publish_allowed: false, requires_0850_trial_confirmation: true }, note: "T+1 08:50 天然試撮 +3%～+5% 才發布最終空方；缺試撮不得以收盤價替代" }, null, 2));
