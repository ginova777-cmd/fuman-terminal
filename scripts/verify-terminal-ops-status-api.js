"use strict";

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function call(handler, request) {
  const response = createResponse();
  await handler(request, response);
  return response;
}

function assert(condition, issue, details, issues) {
  if (!condition) issues.push({ issue, details });
}

async function main() {
  const api = require("../api/terminal-ops-status");
  const issues = [];
  const internal = await call(api, {
    method: "GET",
    headers: { host: "localhost" },
    query: {},
    fumanInternalVerify: true,
  });
  const unauth = await call(api, {
    method: "GET",
    headers: { host: "localhost" },
    query: {},
  });
  const payload = internal.body || {};

  assert(internal.statusCode === 200, "internal_status_not_200", { statusCode: internal.statusCode, body: payload }, issues);
  assert(payload.contract === "terminal-ops-status-v1", "contract_mismatch", { contract: payload.contract }, issues);
  assert(payload.unattendedStatus === "YES", "unattended_not_yes", { unattendedStatus: payload.unattendedStatus, reason: payload.reason }, issues);
  assert(Array.isArray(payload.modules) && payload.modules.length >= 7, "modules_missing", { modules: payload.modules?.length }, issues);
  assert(payload.modules.every((row) => row.runId && row.ok === true), "module_runid_or_ok_missing", { modules: payload.modules }, issues);
  assert(payload.gates?.runIdClosure?.ok === true, "runid_closure_gate_not_ok", { gate: payload.gates?.runIdClosure }, issues);
  assert(payload.gates?.dailyManifest?.ok === true, "daily_manifest_gate_not_ok", { gate: payload.gates?.dailyManifest }, issues);
  assert(payload.stateMachineContract?.contract === "terminal-state-machine-v1", "state_machine_contract_missing", { stateMachineContract: payload.stateMachineContract }, issues);
  assert(Array.isArray(payload.stateMachineContract?.lifecycle) && payload.stateMachineContract.lifecycle.includes("DISPLAY_VERIFIED"), "state_machine_lifecycle_incomplete", { stateMachineContract: payload.stateMachineContract }, issues);
  assert(payload.actionMatrix?.contract === "autonomous-ops-action-matrix-v1", "action_matrix_missing", { actionMatrix: payload.actionMatrix }, issues);
  assert(payload.actionMatrix?.terminalDisplay?.allowed === true, "action_matrix_terminal_display_not_allowed", { actionMatrix: payload.actionMatrix }, issues);
  assert(Array.isArray(payload.actionMatrix?.protectedInvariants) && payload.actionMatrix.protectedInvariants.includes("membership_auth_only_gates_display_not_scanner_compute"), "action_matrix_membership_invariant_missing", { actionMatrix: payload.actionMatrix }, issues);
  assert(unauth.statusCode === 401 && unauth.body?.error === "membership_required", "unauth_not_membership_protected", { statusCode: unauth.statusCode, body: unauth.body }, issues);
  assert(/no-store/i.test(String(internal.headers["cache-control"] || "")), "missing_no_store_header", { headers: internal.headers }, issues);

  const ok = issues.length === 0;
  console.log(JSON.stringify({
    ok,
    internalStatus: internal.statusCode,
    unauthStatus: unauth.statusCode,
    state: payload.state,
    unattendedStatus: payload.unattendedStatus,
    tradeDate: payload.tradeDate,
    modules: payload.modules?.length || 0,
    issues,
  }, null, 2));
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(`[terminal-ops-status-api] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
