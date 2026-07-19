"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/autonomous-ops-notification");
const POLICY_FILE = path.join(ROOT, "outputs", "autonomous-ops-policy", "autonomous-ops-policy.json");
const SEND = process.argv.includes("--send");

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function safeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildNotificationPlan(policy = {}, options = {}) {
  const matrix = policy.actionMatrix || {};
  const notify = matrix.notify || {};
  const decision = policy.decision || {};
  const tradeDate = String(policy.tradeDate || "").replace(/\D/g, "").slice(0, 8);
  const required = notify.required === true;
  const severity = matrix.severity || (required ? "warning" : "info");
  const kind = notify.kind || (required ? "terminal_ops_attention" : "none");
  const dedupeKey = notify.dedupeKey || `${decision.opsState || "UNKNOWN"}:${tradeDate || "unknown"}`;
  const reason = notify.reason || decision.reason || "";
  const suppressed = !required;
  const sendAllowed = required && options.send === true;
  const channel = notify.channel || "ops_alert";

  return {
    ok: true,
    contract: "autonomous-ops-notification-plan-v1",
    checkedAt: new Date().toISOString(),
    tradeDate,
    opsState: decision.opsState || matrix.opsState || "",
    unattendedStatus: decision.unattendedStatus || "NO",
    severity,
    notification: {
      required,
      suppressed,
      sendAllowed,
      dryRun: !sendAllowed,
      channel,
      kind,
      dedupeKey,
      reason,
      subject: subjectFor(kind, decision.opsState, tradeDate),
      body: bodyFor(policy, reason),
    },
    policySnapshot: {
      formalScanAllowed: decision.formalScanAllowed === true,
      scorecardPublishAllowed: decision.scorecardPublishAllowed === true,
      terminalSnapshotAllowed: decision.terminalSnapshotAllowed === true,
      autoRecoveryAllowed: decision.autoRecoveryAllowed === true,
      action: decision.action || "",
      stopMode: matrix.stopMode || "",
    },
    invariants: [
      "notification_required_states_must_have_dedupe_key",
      "market_closed_expected_state_does_not_notify",
      "unattended_yes_does_not_notify",
      "auth_source_degraded_states_notify_without_auto_scanner_publish",
      "send_requires_explicit_send_flag",
    ],
  };
}

function subjectFor(kind, opsState, tradeDate) {
  if (kind === "none") return `Fuman Terminal ${tradeDate || "latest"} 狀態正常`;
  if (String(opsState || "").includes("AUTH")) return `Fuman Terminal 後台授權阻擋 ${tradeDate || "latest"}`;
  if (String(opsState || "").includes("SOURCE")) return `Fuman Terminal 水源阻擋 ${tradeDate || "latest"}`;
  return `Fuman Terminal 無人值守注意 ${tradeDate || "latest"}`;
}

function bodyFor(policy, reason) {
  const decision = policy.decision || {};
  const modules = Array.isArray(policy.modules) ? policy.modules : [];
  const blocked = modules.filter((row) => Array.isArray(row.blockers) && row.blockers.length).map((row) => `${row.key}:${row.blockers.join("|")}`);
  return [
    `opsState=${decision.opsState || ""}`,
    `unattendedStatus=${decision.unattendedStatus || ""}`,
    `action=${decision.action || ""}`,
    `reason=${safeText(reason || decision.reason)}`,
    blocked.length ? `blocked=${blocked.join("; ")}` : "blocked=none",
  ].join("\n");
}

async function writeOutputs(plan) {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const jsonFile = path.join(OUT_DIR, "autonomous-ops-notification-plan.json");
  const mdFile = path.join(OUT_DIR, "autonomous-ops-notification-plan.md");
  await fs.promises.writeFile(jsonFile, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  await fs.promises.writeFile(mdFile, markdown(plan), "utf8");
  return { jsonFile, mdFile };
}

function markdown(plan) {
  return [
    "# Autonomous Ops Notification Plan",
    "",
    `- checkedAt: ${plan.checkedAt}`,
    `- tradeDate: ${plan.tradeDate}`,
    `- opsState: ${plan.opsState}`,
    `- required: ${plan.notification.required}`,
    `- sendAllowed: ${plan.notification.sendAllowed}`,
    `- kind: ${plan.notification.kind}`,
    `- dedupeKey: ${plan.notification.dedupeKey}`,
    `- reason: ${plan.notification.reason}`,
    "",
    "## Body",
    "```text",
    plan.notification.body,
    "```",
    "",
  ].join("\n");
}

function main() {
  const policy = readJson(POLICY_FILE, {});
  const plan = buildNotificationPlan(policy, { send: SEND });
  return writeOutputs(plan).then((files) => {
    console.log(JSON.stringify({
      ok: plan.ok,
      opsState: plan.opsState,
      required: plan.notification.required,
      sendAllowed: plan.notification.sendAllowed,
      dryRun: plan.notification.dryRun,
      kind: plan.notification.kind,
      dedupeKey: plan.notification.dedupeKey,
      output: files.jsonFile,
    }, null, 2));
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[autonomous-ops-notification] failed: ${error.stack || error.message || error}`);
    process.exit(1);
  });
}

module.exports = { buildNotificationPlan };