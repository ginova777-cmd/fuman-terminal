const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REGISTRY_FILE = path.join(ROOT, "scripts", "terminal-active-module-registry.json");
const CONTRACT = "terminal-active-module-registry-v1";

function loadActiveModuleRegistry() {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
  const issues = validateActiveModuleRegistry(registry);
  if (issues.length) throw new Error(`active module registry invalid: ${issues.join(",")}`);
  return registry;
}

function validateActiveModuleRegistry(registry = {}) {
  const issues = [];
  if (registry.contract !== CONTRACT) issues.push("contract_missing");
  if (!Number.isInteger(registry.version) || registry.version < 1) issues.push("version_invalid");
  if (!Array.isArray(registry.active) || registry.active.length === 0) issues.push("active_missing");
  if (!Array.isArray(registry.retired)) issues.push("retired_missing");
  const activeKeys = (registry.active || []).map((row) => String(row?.key || "").trim()).filter(Boolean);
  const retiredKeys = (registry.retired || []).map((row) => String(row?.key || "").trim()).filter(Boolean);
  if (new Set(activeKeys).size !== activeKeys.length) issues.push("active_duplicate");
  if (new Set(retiredKeys).size !== retiredKeys.length) issues.push("retired_duplicate");
  for (const key of activeKeys) if (retiredKeys.includes(key)) issues.push(`active_retired_overlap:${key}`);
  for (const row of registry.active || []) {
    if (!String(row?.key || "").trim()) issues.push("active_key_missing");
    if (!String(row?.dueTime || "").match(/^\d{2}:\d{2}$/)) issues.push(`active_due_time_invalid:${row?.key || "unknown"}`);
    if (row?.requiredForUnattended !== true) issues.push(`active_not_required:${row?.key || "unknown"}`);
  }
  for (const row of registry.retired || []) {
    if (row?.retired !== true) issues.push(`retired_flag_missing:${row?.key || "unknown"}`);
  }
  return [...new Set(issues)];
}

module.exports = {
  CONTRACT,
  REGISTRY_FILE,
  loadActiveModuleRegistry,
  validateActiveModuleRegistry,
};
