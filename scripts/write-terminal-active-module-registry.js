"use strict";

const fs = require("fs");
const path = require("path");
const { compactDate, createDailyRunId, defaultAuditRoot, defaultRuntimeDir, readJson, writeJson } = require("../lib/terminal-final-audit-contract");
const { isModuleDue } = require("../lib/terminal-full-module-contract");
const { FULL_MODULES } = require("../lib/terminal-full-module-contract");

const ROOT = path.resolve(__dirname, "..");

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const value = process.argv.find((item) => item === name || item.startsWith(prefix));
  return value === name ? "1" : (value ? value.slice(prefix.length) : fallback);
}

function markdown(payload) {
  const lines = ["# Active Module Registry", "", "- contract: " + payload.contract, "- daily_run_id: " + payload.daily_run_id, "- trade_date: " + payload.trade_date, "- scope: " + payload.scope, "- evaluated_at: " + payload.evaluated_at, "", "| key | requirement | today state | connected | status | receipt required | due | verifier |", "|---|---|---|---:|---|---:|---|---|"];
  for (const row of payload.modules) lines.push("| " + row.key + " | " + row.requirement_state + " | " + row.today_state + " | " + row.connected + " | " + row.status + " | " + row.receipt_required + " | " + row.due_time + " | " + row.verifier + " |");
  return lines.join("\n") + "\n";
}
function main() {
  const tradeDate = compactDate(argValue("--trade-date", process.env.FUMAN_TRADE_DATE || ""));
  const dailyRunId = argValue("--daily-run-id", process.env.FUMAN_DAILY_RUN_ID || createDailyRunId(tradeDate));
  const auditRoot = path.resolve(argValue("--out", defaultAuditRoot(ROOT)));
  const runtimeDir = argValue("--runtime-dir", defaultRuntimeDir());
  const evaluatedAt = new Date(argValue("--now", process.env.FUMAN_RECEIPT_NOW || Date.now()));
  const moduleRegistryFile = path.join(ROOT, "scripts", "terminal-active-module-registry.json");
  const moduleRegistry = readJson(moduleRegistryFile, { active: [], retired: [] });
  const activeRows = Array.isArray(moduleRegistry.active) ? moduleRegistry.active : [];
  const activeKeys = new Set(activeRows.map((row) => row.key));
  const retiredRows = Array.isArray(moduleRegistry.retired) ? moduleRegistry.retired : [];
  const retiredKeys = new Set(retiredRows.map((row) => row.key));
  const configRowsByKey = new Map(activeRows.map((row) => [String(row.key), row]));
  const configDuplicateKeys = activeRows.map((row) => String(row.key)).filter((key, index, list) => list.indexOf(key) !== index);
  const duplicateKeys = FULL_MODULES.map((row) => row.key).filter((key, index, list) => list.indexOf(key) !== index);
  const retiredReappeared = [...retiredKeys].filter((key) => activeKeys.has(key) || FULL_MODULES.some((row) => row.key === key));
  const missingConfigRows = FULL_MODULES.map((row) => row.key).filter((key) => !configRowsByKey.has(key));  const payload = {
    contract: "terminal-active-module-registry-v1",
    version: 2,
    generated_at: new Date().toISOString(),
    evaluated_at: evaluatedAt.toISOString(),
    daily_run_id: dailyRunId,
    trade_date: tradeDate,
    scope: "full_unattended_final_audit",
    module_registry_file: moduleRegistryFile,
    active_modules: Array.isArray(moduleRegistry.active) ? moduleRegistry.active : [],
    retired_modules: Array.isArray(moduleRegistry.retired) ? moduleRegistry.retired : [],
    modules: FULL_MODULES.map((module) => {
      const configured = configRowsByKey.get(module.key) || {};
      const requirementState = String(configured.requirementState || module.requirementState || (module.required === false ? "optional" : "required")).toLowerCase();
      const normalizedRequirement = ["required", "optional", "disabled", "not_required"].includes(requirementState) ? requirementState : "disabled";
      const todayState = normalizedRequirement === "disabled"
        ? "DISABLED"
        : normalizedRequirement === "not_required"
          ? "NOT_REQUIRED"
          : normalizedRequirement === "optional"
            ? (isModuleDue(module, evaluatedAt) ? "OPTIONAL" : "NOT_DUE")
            : (isModuleDue(module, evaluatedAt) ? "REQUIRED" : "NOT_DUE");
      return {
        key: module.key,
        label: module.label,
        class: module.class,
        required: normalizedRequirement === "required",
        requirement_state: normalizedRequirement,
        today_state: todayState,
        connected: configured.wired === true && module.connected === true,
        status: configured.status || (module.connected === true ? "CONNECTED" : "NOT_CONNECTED"),
        receipt_required: module.receipt_required !== false,
        due_time: module.dueTime || "00:00",
        source: module.source || ("stage:" + module.key),
        adapter: module.adapter || "stage_receipt",
        verifier: module.verifier,
        allowed_action: module.allowedAction,
        configured: Boolean(configured.key),
      };
    }),    not_connected_yet: FULL_MODULES.filter((module) => {
      const configured = configRowsByKey.get(module.key) || {};
      return String(configured.requirementState || module.requirementState || "required").toLowerCase() === "required" && module.receipt_required !== false && !(configured.wired === true && module.connected === true);
    }).map((module) => module.key),
    deferred_not_yet_wired: FULL_MODULES.filter((module) => {
      const configured = configRowsByKey.get(module.key) || {};
      return String(configured.requirementState || module.requirementState || "required").toLowerCase() !== "required" && !(configured.wired === true && module.connected === true);
    }).map((module) => module.key),
    receipt_policy: "missing_receipt_is_not_complete; stale_or_preserved_receipt_is_not_current_success",
    validation: { duplicate_keys: duplicateKeys, config_duplicate_keys: configDuplicateKeys, missing_config_rows: missingConfigRows, retired_reappeared: retiredReappeared },
    ok: duplicateKeys.length === 0 && configDuplicateKeys.length === 0 && missingConfigRows.length === 0 && retiredReappeared.length === 0,
  };
  const runDir = path.join(auditRoot, tradeDate, dailyRunId);
  writeJson(path.join(runDir, "active-module-registry.json"), payload);
  writeJson(path.join(auditRoot, "active-module-registry-latest.json"), payload);
  fs.writeFileSync(path.join(runDir, "active-module-registry.md"), markdown(payload), "utf8");
  const runtimeState = path.join(runtimeDir, "state", "active-module-registry.json");
  if (process.env.FUMAN_FINAL_AUDIT_WRITE_RUNTIME !== "0") writeJson(runtimeState, payload);
  console.log(JSON.stringify({ ok: payload.ok, contract: payload.contract, scope: payload.scope, daily_run_id: dailyRunId, trade_date: tradeDate, module_count: payload.modules.length, output: path.join(runDir, "active-module-registry.json"), runtime_state: runtimeState }, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main();



