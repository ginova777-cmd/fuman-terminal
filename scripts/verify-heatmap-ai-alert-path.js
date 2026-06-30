"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SEND_REAL = process.argv.includes("--send") || process.env.VERIFY_HEATMAP_AI_ALERT_SEND === "1";

function readArg(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] || "";
  return "";
}

if (SEND_REAL) {
  delete process.env.TERMINAL_HEALTH_ALERT_DRY_RUN;
} else {
  process.env.TERMINAL_HEALTH_ALERT_DRY_RUN = "1";
  process.env.REPORT_EMAIL_TO = process.env.REPORT_EMAIL_TO || "ops@example.invalid";
  process.env.SMTP_USER = process.env.SMTP_USER || "smtp@example.invalid";
  process.env.SMTP_PASS = process.env.SMTP_PASS || "dry-run-password";
}

const {
  checkHeatmapLiveApi,
  checkMarketAiLiveApi,
  issue,
  notifyIfNeeded,
  taipeiClock,
} = require("./monitor-terminal-api-health");

(async () => {
  const sourceIssueStatus = {
    ok: false,
    source: "terminal-api-health",
    baseUrl: process.env.FUMAN_TERMINAL_BASE_URL || "https://fuman-terminal.vercel.app",
    updatedAt: new Date().toISOString(),
    issues: [
      issue("critical", "AI 判讀存在 sourceIssues", {
        sourceIssues: ["熱力圖即時報價水源不健康：simulated production source issue"],
      }),
      issue("critical", "AI heatmapUsable 不是 true", { heatmapUsable: false }),
    ],
  };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fuman-heatmap-ai-alert-"));
  const receipt = readArg("--receipt") || process.env.HEATMAP_AI_ALERT_RECEIPT_FILE || path.join(tmpDir, SEND_REAL ? "heatmap-ai-alert-smtp.json" : "heatmap-ai-alert-dry-run.json");
  const sourceIssueNotification = await notifyIfNeeded(sourceIssueStatus, {
    dryRun: !SEND_REAL,
    alertStateFile: receipt,
  });
  if (SEND_REAL) {
    assert(sourceIssueNotification.channels.includes("email"), "Gmail/email live channel missing for AI sourceIssues");
    assert(!sourceIssueNotification.errors.some((item) => String(item).startsWith("email:")), `Gmail/email live send failed: ${sourceIssueNotification.errors.join("; ")}`);
  } else {
    assert(sourceIssueNotification.channels.includes("email:dry-run"), "Gmail/email dry-run channel missing for AI sourceIssues");
  }

  let liveProbeText = "";
  let liveProbe = null;
  if (process.env.VERIFY_HEATMAP_AI_ALERT_LIVE === "1" || process.argv.includes("--live")) {
    const clock = taipeiClock();
    const heatmap = await checkHeatmapLiveApi(clock);
    const marketAi = await checkMarketAiLiveApi(clock);
    assert.strictEqual(heatmap.name, "熱力圖 live API");
    assert.strictEqual(marketAi.name, "AI 判讀 live API");
    assert.strictEqual(heatmap.endpoint, "/api/heatmap?limit=999&stocks=999&source=desktop-live-contract");
    assert.strictEqual(marketAi.endpoint, "/api/market-ai-live?canvas=1&compact=1&shell=1&limit=40");
    const liveIssues = [...(heatmap.issues || []), ...(marketAi.issues || [])];
    liveProbe = { heatmapOk: heatmap.ok, marketAiOk: marketAi.ok, issueCount: liveIssues.length };
    liveProbeText = ` liveProbe heatmap=${heatmap.ok} ai=${marketAi.ok} issues=${liveIssues.length}`;
  }

  fs.writeFileSync(receipt, `${JSON.stringify({
    ok: true,
    mode: SEND_REAL ? "smtp" : "dry-run",
    source: "verify-heatmap-ai-alert-path",
    simulated: "AI-sourceIssues+heatmapUsable-false",
    channels: sourceIssueNotification.channels,
    errors: sourceIssueNotification.errors,
    notificationDryRun: sourceIssueNotification.dryRun,
    liveProbe,
    checkedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");

  console.log(`[heatmap-ai-alert-path] ok mode=${SEND_REAL ? "smtp" : "dry-run"} sourceIssueEmail=${sourceIssueNotification.channels.join(",")} simulated=AI-sourceIssues+heatmapUsable-false receipt=${receipt}${liveProbeText}`);
})();
