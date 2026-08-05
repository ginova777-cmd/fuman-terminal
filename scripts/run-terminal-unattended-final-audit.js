"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  STAGES,
  acquireOrchestratorLock,
  compactDate,
  createDailyRunId,
  resolveDailyRunId,
  defaultAuditRoot,
  defaultRuntimeDir,
  parseLastJson,
  readJson,
  reasonCodeFor,
  releaseOrchestratorLock,
  writeJson,
  writeStageReceipt,
} = require("../lib/terminal-final-audit-contract");

const ROOT = path.resolve(__dirname, "..");

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const value = process.argv.find((item) => item === name || item.startsWith(prefix));
  return value === name ? "1" : (value ? value.slice(prefix.length) : fallback);
}

function runNode(args, env = {}) {
  const started = new Date().toISOString();
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    windowsHide: true,
  });
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  return {
    started_at: started,
    finished_at: new Date().toISOString(),
    exit_code: result.status === null ? 1 : result.status,
    stdout,
    stderr,
    parsed: parseLastJson(stdout) || parseLastJson(stderr),
    command: `node ${args.join(" ")}`,
  };
}

function artifactFile(runDir, stage) {
  return path.join(runDir, "artifacts", `${stage}.json`);
}

function saveArtifact(file, payload) {
  writeJson(file, payload || { ok: false, reason: "no_json_evidence" });
}

function writeReceipt({ auditRoot, tradeDate, dailyRunId, stage, status, result, artifact, parsed, reasonCode, allowedAction }) {
  return writeStageReceipt({
    auditRoot,
    tradeDate,
    dailyRunId,
    stage,
    status,
    exitCode: result?.exit_code ?? 1,
    command: result?.command || "",
    artifact,
    parsed,
    stdout: result?.stdout || "",
    stderr: result?.stderr || "",
    reasonCode,
    allowedAction,
  });
}

function skippedReceipt({ auditRoot, tradeDate, dailyRunId, stage, reasonCode = "market_closed_previous_good" }) {
  const parsed = { ok: true, status: "SKIPPED", reason: reasonCode };
  return writeStageReceipt({ auditRoot, tradeDate, dailyRunId, stage, status: "SKIPPED", exitCode: 0, command: "market_calendar_policy", artifact: "", parsed, reasonCode, allowedAction: "preserve_previous_good_without_latest_writes" });
}

function blockedReceipt({ auditRoot, tradeDate, dailyRunId, stage, reasonCode = "upstream_gate_not_verified" }) {
  const parsed = { ok: false, status: "BLOCKED", reason: reasonCode };
  return writeStageReceipt({ auditRoot, tradeDate, dailyRunId, stage, status: "BLOCKED", exitCode: 1, command: "upstream_gate_blocked", artifact: "", parsed, reasonCode });
}

function main() {
  const tradeDate = compactDate(argValue("--trade-date", process.env.FUMAN_TRADE_DATE || ""));
  const auditRoot = path.resolve(argValue("--out", defaultAuditRoot(ROOT)));
  const dailyRunId = argValue("--daily-run-id", process.env.FUMAN_DAILY_RUN_ID || resolveDailyRunId({ auditRoot, tradeDate }));
  const runtimeDir = argValue("--runtime-dir", defaultRuntimeDir());
  const runDir = path.join(auditRoot, tradeDate, dailyRunId);
  fs.mkdirSync(path.join(runDir, "artifacts"), { recursive: true });
  const lock = acquireOrchestratorLock({ dailyRunId, tradeDate, runtimeDir });
  const startedAt = new Date().toISOString();
  if (!lock.ok) {
    const payload = {
      contract: "terminal-unattended-final-audit-v1",
      generated_at: new Date().toISOString(),
      started_at: startedAt,
      daily_run_id: dailyRunId,
      trade_date: tradeDate,
      scope: "final_audit_convergence_gates_only",
      decision: "NO",
      unattended_status: "NO",
      first_blocker: "orchestrator_lock",
      reason_code: lock.reasonCode || "orchestrator_lock_not_acquired",
      allowed_action: "wait_for_active_orchestrator_to_finish_then_retry",
      lock,
      receipts: [],
      missing_receipts: STAGES.map((stage) => stage.key),
      ok: false,
    };
    const file = path.join(auditRoot, "terminal-unattended-final-audit.json");
    writeJson(file, payload);
    writeJson(path.join(runDir, "terminal-unattended-final-audit.json"), payload);
    console.log(JSON.stringify({ ok: false, decision: "NO", first_blocker: payload.first_blocker, reason_code: payload.reason_code, output: file }, null, 2));
    process.exitCode = 1;
    return;
  }

  writeJson(path.join(auditRoot, tradeDate, "daily-run-id.json"), { contract: "terminal-daily-run-id-v1", trade_date: tradeDate, daily_run_id: dailyRunId, updated_at: new Date().toISOString() });
  const receipts = [];
  try {
    const registryRun = runNode(["scripts/write-terminal-active-module-registry.js", "--trade-date=" + tradeDate, "--daily-run-id=" + dailyRunId, "--out=" + auditRoot, "--runtime-dir=" + runtimeDir], { FUMAN_DAILY_RUN_ID: dailyRunId, FUMAN_TRADE_DATE: tradeDate });
    const registryFile = path.join(auditRoot, tradeDate, dailyRunId, "active-module-registry.json");
    const registry = readJson(registryFile, null);
    const registryOk = registryRun.exit_code === 0 && registry && registry.ok === true && registry.daily_run_id === dailyRunId && registry.trade_date === tradeDate;

    const market = runNode(["--use-system-ca", "scripts/check-market-calendar-action.js", `--date=${tradeDate}`, "--label=terminal-final-audit"], { FUMAN_MARKET_CALENDAR_DATE: tradeDate, FUMAN_DAILY_RUN_ID: dailyRunId });
    const marketArtifact = artifactFile(runDir, "market_calendar");
    saveArtifact(marketArtifact, market.parsed || { ok: false, reason: "market_calendar_no_json_evidence" });
    const marketStatus = market.exit_code === 0 && market.parsed?.ok === true ? "PASS" : "BLOCKED";
    receipts.push(writeReceipt({ auditRoot, tradeDate, dailyRunId, stage: "market_calendar", status: marketStatus, result: market, artifact: marketArtifact, parsed: market.parsed, reasonCode: marketStatus === "PASS" ? "ok" : reasonCodeFor("market_calendar", market.parsed, `${market.stdout}\n${market.stderr}`) }));

    if (marketStatus === "PASS" && market.parsed?.marketOpen === false) {
      for (const stage of ["preflight", "power_recovery", "websocket", "water_root", "formal_gate"]) receipts.push(skippedReceipt({ auditRoot, tradeDate, dailyRunId, stage }));
    } else if (marketStatus !== "PASS") {
      for (const stage of ["preflight", "power_recovery", "websocket", "water_root", "formal_gate"]) receipts.push(blockedReceipt({ auditRoot, tradeDate, dailyRunId, stage, reasonCode: "market_calendar_not_verified" }));
    } else {
      const preflightWrite = runNode(["--use-system-ca", "scripts/write-terminal-predictive-preflight.js", `--expected-date=${tradeDate}`, "--out=outputs/terminal-predictive-preflight"], { FUMAN_TRADE_DATE: tradeDate, FUMAN_DAILY_RUN_ID: dailyRunId });
      const preflightVerify = runNode(["--use-system-ca", "scripts/verify-terminal-predictive-preflight.js"], { FUMAN_TRADE_DATE: tradeDate, FUMAN_DAILY_RUN_ID: dailyRunId });
      const preflightEvidence = { writer: preflightWrite, verifier: preflightVerify };
      const preflightArtifact = artifactFile(runDir, "preflight");
      saveArtifact(preflightArtifact, preflightEvidence);
      const preflightStatus = preflightWrite.exit_code === 0 && preflightVerify.exit_code === 0 && preflightVerify.parsed?.ok === true ? "PASS" : "BLOCKED";
      receipts.push(writeReceipt({ auditRoot, tradeDate, dailyRunId, stage: "preflight", status: preflightStatus, result: preflightVerify, artifact: preflightArtifact, parsed: preflightEvidence, reasonCode: preflightStatus === "PASS" ? "ok" : reasonCodeFor("preflight", preflightVerify.parsed, `${preflightWrite.stdout}\n${preflightVerify.stdout}\n${preflightVerify.stderr}`) }));

      const powerOut = path.join(runDir, "power-recovery");
      const power = runNode(["scripts/verify-terminal-power-recovery.js", `--trade-date=${tradeDate}`, `--out=${powerOut}`, `--runtime-dir=${runtimeDir}`], { FUMAN_TRADE_DATE: tradeDate, FUMAN_DAILY_RUN_ID: dailyRunId, FUMAN_RUNTIME_DIR: runtimeDir });
      const powerFull = readJson(path.join(powerOut, "terminal-power-recovery.json"), power.parsed);
      const powerArtifact = artifactFile(runDir, "power_recovery");
      saveArtifact(powerArtifact, powerFull);
      const powerStatus = power.exit_code === 0 && powerFull?.ok === true ? "PASS" : "BLOCKED";
      receipts.push(writeReceipt({ auditRoot, tradeDate, dailyRunId, stage: "power_recovery", status: powerStatus, result: power, artifact: powerArtifact, parsed: powerFull, reasonCode: powerStatus === "PASS" ? "ok" : reasonCodeFor("power_recovery", powerFull, `${power.stdout}\n${power.stderr}`) }));

      const websocket = runNode(["--use-system-ca", "scripts/verify-fugle-websocket-sources.js"], { FUMAN_TRADE_DATE: tradeDate, FUMAN_DAILY_RUN_ID: dailyRunId });
      const websocketArtifact = artifactFile(runDir, "websocket");
      saveArtifact(websocketArtifact, websocket.parsed || { ok: false, stdout: websocket.stdout, stderr: websocket.stderr });
      const websocketStatus = websocket.exit_code === 0 && websocket.parsed?.ok === true ? "PASS" : "BLOCKED";
      receipts.push(writeReceipt({ auditRoot, tradeDate, dailyRunId, stage: "websocket", status: websocketStatus, result: websocket, artifact: websocketArtifact, parsed: websocket.parsed, reasonCode: websocketStatus === "PASS" ? "ok" : reasonCodeFor("websocket", websocket.parsed, `${websocket.stdout}\n${websocket.stderr}`) }));

      const waterOut = path.join(runDir, "water-root");
      const waterArgs = ["--use-system-ca", "scripts/verify-terminal-water-root.js", `--expected-date=${tradeDate}`, `--out=${waterOut}`];
      if (market.parsed?.isTradingDay === true || market.parsed?.row?.isTradingDay === true || market.parsed?.marketOpen === true) waterArgs.push("--require-trading-day");
      if (market.parsed?.formalSourceWindowOpen === true || market.parsed?.row?.formalSourceWindowOpen === true || market.parsed?.sourceFreshnessRequired === true || market.parsed?.row?.sourceFreshnessRequired === true) waterArgs.push("--require-formal-now");
      const water = runNode(waterArgs, { FUMAN_TRADE_DATE: tradeDate, FUMAN_DAILY_RUN_ID: dailyRunId });
      const waterFull = readJson(path.join(waterOut, "terminal-water-root.json"), water.parsed);
      const waterArtifact = artifactFile(runDir, "water_root");
      saveArtifact(waterArtifact, waterFull);
      const waterStatus = water.exit_code === 0 && waterFull?.ok === true ? "PASS" : "BLOCKED";
      receipts.push(writeReceipt({ auditRoot, tradeDate, dailyRunId, stage: "water_root", status: waterStatus, result: water, artifact: waterArtifact, parsed: waterFull, reasonCode: waterStatus === "PASS" ? "ok" : reasonCodeFor("water_root", waterFull, `${water.stdout}\n${water.stderr}`) }));

      const formal = runNode(["scripts/verify-strategy-scan-formal-gate.js"], { FUMAN_TRADE_DATE: tradeDate, FUMAN_DAILY_RUN_ID: dailyRunId });
      const liveGate = waterFull?.canonicalGate?.summary || {};
      const liveFormalReady = waterFull?.marketClosedPreviousGood === true || (waterFull?.ok === true && (liveGate.formalEntryAllowed === true || liveGate.formal_entry_allowed === true || ["ready", "a"].includes(String(liveGate.canonicalGateStatus || liveGate.canonicalGateGrade || "").toLowerCase())));
      const formalEvidence = { static_verifier: formal.parsed, live_water_root_gate: { ready: liveFormalReady, summary: liveGate } };
      const formalArtifact = artifactFile(runDir, "formal_gate");
      saveArtifact(formalArtifact, formalEvidence);
      const formalStatus = formal.exit_code === 0 && formal.parsed?.ok === true && liveFormalReady ? "PASS" : "BLOCKED";
      receipts.push(writeReceipt({ auditRoot, tradeDate, dailyRunId, stage: "formal_gate", status: formalStatus, result: formal, artifact: formalArtifact, parsed: formalEvidence, reasonCode: formalStatus === "PASS" ? "ok" : (formal.exit_code !== 0 || formal.parsed?.ok !== true ? reasonCodeFor("formal_gate", formal.parsed, `${formal.stdout}\n${formal.stderr}`) : "formal_gate_live_status_not_ready") }));
    }
    const manifestArgs = ["scripts/write-terminal-daily-manifest.js", `--trade-date=${tradeDate}`, `--daily-run-id=${dailyRunId}`, `--out=${auditRoot}`, `--registry=${registryFile}`];
    const manifestRun = runNode(manifestArgs, { FUMAN_TRADE_DATE: tradeDate, FUMAN_DAILY_RUN_ID: dailyRunId });
    const manifest = readJson(path.join(auditRoot, tradeDate, dailyRunId, "terminal-daily-manifest.json"), manifestRun.parsed || {});
    const lockRelease = releaseOrchestratorLock(lock);
    const finalPayload = {
      contract: "terminal-unattended-final-audit-v1",
      generated_at: new Date().toISOString(),
      started_at: startedAt,
      daily_run_id: dailyRunId,
      trade_date: tradeDate,
      scope: "final_audit_convergence_gates_only",
      registry: { file: registryFile, ok: registryOk, exit_code: registryRun.exit_code },
      orchestrator_lock: { acquired: true, released: lockRelease.released === true, file: lock.file, release: lockRelease },
      manifest: { file: path.join(auditRoot, tradeDate, dailyRunId, "terminal-daily-manifest.json"), ok: manifest.ok === true, first_blocker: manifest.first_blocker || "", reason_code: manifest.reason_code || "", allowed_action: manifest.allowed_action || "" },
      receipts: receipts.map((row) => ({ stage: row.payload.stage, file: row.file, status: row.payload.status, complete: row.payload.complete, reason_code: row.payload.reason_code, allowed_action: row.payload.allowed_action })),
      missing_receipts: manifest.missing_receipts || [],
      failed_stages: manifest.failed_stages || [],
      decision: registryOk && manifest.ok === true && lockRelease.ok === true ? "YES" : "NO",
      unattended_status: registryOk && manifest.ok === true && lockRelease.ok === true ? "YES" : "NO",
      first_blocker: !registryOk ? "active_module_registry" : (manifest.first_blocker || (lockRelease.ok ? "" : "orchestrator_lock_release")),
      reason_code: !registryOk ? "active_module_registry_not_written_or_identity_mismatch" : (manifest.reason_code || (lockRelease.ok ? "ok" : lockRelease.reasonCode || "orchestrator_lock_release_failed")),
      allowed_action: !registryOk ? "repair_active_module_registry_writer_then_retry" : (manifest.allowed_action || (lockRelease.ok ? "none" : "repair_orchestrator_lock_then_retry")),
      ok: registryOk && manifest.ok === true && lockRelease.ok === true,
    };
    const latest = path.join(auditRoot, "terminal-unattended-final-audit.json");
    const runFile = path.join(runDir, "terminal-unattended-final-audit.json");
    writeJson(runFile, finalPayload);
    writeJson(latest, finalPayload);
    if (process.env.FUMAN_FINAL_AUDIT_WRITE_RUNTIME !== "0") writeJson(path.join(runtimeDir, "state", "unattended-final-audit.json"), finalPayload);
    console.log(JSON.stringify({ ok: finalPayload.ok, decision: finalPayload.decision, daily_run_id: dailyRunId, trade_date: tradeDate, first_blocker: finalPayload.first_blocker, reason_code: finalPayload.reason_code, allowed_action: finalPayload.allowed_action, output: latest }, null, 2));
    if (!finalPayload.ok || manifestRun.exit_code !== 0) process.exitCode = 1;
  } catch (error) {
    const release = releaseOrchestratorLock(lock);
    const payload = { contract: "terminal-unattended-final-audit-v1", generated_at: new Date().toISOString(), daily_run_id: dailyRunId, trade_date: tradeDate, scope: "final_audit_convergence_gates_only", decision: "NO", unattended_status: "NO", first_blocker: "final_audit_exception", reason_code: "final_audit_exception", allowed_action: "inspect_final_audit_error_then_retry", error: String(error.stack || error.message || error), lock_release: release, ok: false };
    writeJson(path.join(runDir, "terminal-unattended-final-audit.json"), payload);
    writeJson(path.join(auditRoot, "terminal-unattended-final-audit.json"), payload);
    console.error(JSON.stringify(payload, null, 2));
    process.exitCode = 1;
  }
}

main();
