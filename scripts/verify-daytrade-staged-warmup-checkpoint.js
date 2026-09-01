"use strict";

const fs = require("fs");
const path = require("path");

const runtime = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const stateDir = path.join(runtime, "state");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const key = today.replace(/\D/g, "");
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const gateFile = path.join(stateDir, `daytrade-unattended-gate-0700-${key}.json`);
const wsFile = path.join(stateDir, "fugle-daytrade-websocket-status-v2.json");
const gate = readJson(gateFile);
const ws = readJson(wsFile);
const issues = [];
const compact = (value) => String(value || "").replace(/\D/g, "").slice(0, 8);

if (!gate) issues.push("warmup_0700_receipt_missing");
else {
  if (compact(gate.trade_date) !== key) issues.push("warmup_trade_date_not_today");
  if (gate.phase !== "0700") issues.push("warmup_phase_not_0700");
  if (gate.ok !== true || gate.gate_grade !== "A") issues.push("warmup_gate_not_a");
  if (gate.natural_schedule_evidence !== true) issues.push("natural_schedule_evidence_missing");
  if (gate.formal_entry_allowed !== false) issues.push("formal_entry_must_remain_forbidden_preopen");
  // Mother Pool 300-600 is a discovery capacity target, never a universal hard gate.
  // Formal readiness is proven by the authoritative A-grade gate, natural schedule
  // evidence, historical MA warmup and the later dynamic priority/hot/deep-scan checks.
  if (Number(gate.priority_pool_symbols || 0) <= 0) issues.push("mother_pool_empty");
  if (Number(gate.ready_ma20 || 0) <= 0) issues.push("ma20_warmup_missing");
  if (Number(gate.ready_ma35 || 0) <= 0) issues.push("ma35_warmup_missing");
  if (gate.daily_volume_status !== "ready") issues.push("daily_volume_not_ready");
}
if (!ws) issues.push("websocket_v2_status_missing");
else {
  if (ws.websocketConnected !== true || ws.websocketAuthenticated !== true) issues.push("websocket_transport_not_ready");
  if (ws.primarySource !== "fugle-websocket") issues.push("websocket_not_formal_primary");
}

const result = {
  ok: issues.length === 0,
  contract: "daytrade-staged-warmup-checkpoint-v1",
  checkedAt: new Date().toISOString(),
  tradeDate: today,
  phase: "07:08",
  policy: {
    requiresTodayTradeQuotesPreopen: false,
    requiresTodayOneMinuteBarsPreopen: false,
    requiresMotherPoolSkeleton: true,
    requiresHistoricalMaWarmup: true,
    formalEntryAllowedPreopen: false,
  },
  evidence: gate ? {
    priorityPoolSymbols: Number(gate.priority_pool_symbols || 0),
    readyMa20: Number(gate.ready_ma20 || 0),
    readyMa35: Number(gate.ready_ma35 || 0),
    todayOneMinuteSymbols: Number(gate.today_1m_symbols || 0),
    freshQuotes120s: Number(gate.fresh_quotes_120s || 0),
    gateGrade: gate.gate_grade || "",
    naturalScheduleEvidence: gate.natural_schedule_evidence === true,
  } : null,
  issues,
};
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
