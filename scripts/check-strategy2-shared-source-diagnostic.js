"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const DIAGNOSTIC_STATE_FILE = process.env.STRATEGY2_SHARED_SOURCE_DIAGNOSTIC_FILE
  || path.join(RUNTIME_DIR, "state", "strategy2-shared-source-diagnostic.json");
const LEGACY = path.join(__dirname, "check-strategy2-shared-source-diagnostic-legacy.js");

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
}

const result = spawnSync(process.execPath, [LEGACY, ...process.argv.slice(2)], {
  cwd: ROOT,
  encoding: "utf8",
  env: {
    ...process.env,
    NODE_OPTIONS: "--use-system-ca",
    STRATEGY2_SUPABASE_COVERAGE_FILE: DIAGNOSTIC_STATE_FILE,
  },
  timeout: 180000,
  windowsHide: true,
});
const payload = {
  ...readJson(DIAGNOSTIC_STATE_FILE),
  sourceRole: "diagnostic_only_shared_source",
  formalEntryAuthority: false,
  canonicalGateAuthority: false,
  latestPointerAuthority: false,
  unattendedAuthority: false,
  decision: "DIAGNOSTIC_ONLY",
  legacyMonitor: "check-strategy2-shared-source-diagnostic-legacy.js",
  diagnosticStateFile: DIAGNOSTIC_STATE_FILE,
  wrapperExitCode: result.status ?? 1,
};
fs.mkdirSync(path.dirname(DIAGNOSTIC_STATE_FILE), { recursive: true });
fs.writeFileSync(DIAGNOSTIC_STATE_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(JSON.stringify(payload, null, 2));
if (process.argv.includes("--fail-on-critical") && payload.ok !== true) process.exitCode = 1;
