"use strict";

const fs = require("fs");
const path = require("path");
const {
  STAGES,
  compactDate,
  createDailyRunId,
  defaultAuditRoot,
  defaultRuntimeDir,
  readJson,
  writeJson,
} = require("../lib/terminal-final-audit-contract");

const ROOT = path.resolve(__dirname, "..");

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const value = process.argv.find((item) => item === name || item.startsWith(prefix));
  return value === name ? "1" : (value ? value.slice(prefix.length) : fallback);
}

function markdown(payload) {
  const lines = [`# Active Module Registry`, ``, `- contract: ${payload.contract}`, `- daily_run_id: ${payload.daily_run_id}`, `- trade_date: ${payload.trade_date}`, `- scope: ${payload.scope}`, ``, `| key | required | status | receipt required | verifier |`, `|---|---:|---|---:|---|`];
  for (const row of payload.modules) lines.push(`| ${row.key} | ${row.required} | ${row.status} | ${row.receipt_required} | ${row.verifier} |`);
  return `${lines.join("\n")}\n`;
}

function main() {
  const tradeDate = compactDate(argValue("--trade-date", process.env.FUMAN_TRADE_DATE || ""));
  const dailyRunId = argValue("--daily-run-id", process.env.FUMAN_DAILY_RUN_ID || createDailyRunId(tradeDate));
  const auditRoot = path.resolve(argValue("--out", defaultAuditRoot(ROOT)));
  const runtimeDir = argValue("--runtime-dir", defaultRuntimeDir());
  const moduleRegistryFile = path.join(ROOT, "scripts", "terminal-active-module-registry.json");
  const moduleRegistry = readJson(moduleRegistryFile, { active: [], retired: [] });
  const payload = {
    contract: "terminal-active-module-registry-v1",
    generated_at: new Date().toISOString(),
    daily_run_id: dailyRunId,
    trade_date: tradeDate,
    scope: "final_audit_convergence_gates_only",
    module_registry_file: moduleRegistryFile,
    active_modules: Array.isArray(moduleRegistry.active) ? moduleRegistry.active : [],
    retired_modules: Array.isArray(moduleRegistry.retired) ? moduleRegistry.retired : [],
    modules: STAGES.map((stage) => ({
      key: stage.key,
      label: stage.label,
      required: true,
      status: "ACTIVE",
      receipt_required: true,
      verifier: stage.verifier,
      allowed_action: stage.allowedAction,
    })),
    not_connected_yet: ["strategy2", "strategy3", "strategy4", "strategy5", "institution", "cb", "warrant"],
    receipt_policy: "missing_receipt_is_not_complete",
    ok: true,
  };
  const runDir = path.join(auditRoot, tradeDate, dailyRunId);
  writeJson(path.join(runDir, "active-module-registry.json"), payload);
  writeJson(path.join(auditRoot, "active-module-registry-latest.json"), payload);
  fs.writeFileSync(path.join(runDir, "active-module-registry.md"), markdown(payload), "utf8");
  const runtimeState = path.join(runtimeDir, "state", "active-module-registry.json");
  if (process.env.FUMAN_FINAL_AUDIT_WRITE_RUNTIME !== "0") writeJson(runtimeState, payload);
  console.log(JSON.stringify({ ok: true, contract: payload.contract, daily_run_id: dailyRunId, trade_date: tradeDate, output: path.join(runDir, "active-module-registry.json"), runtime_state: runtimeState }, null, 2));
}

main();
