"use strict";

const assert = require("assert");

process.env.TERMINAL_HEALTH_ALERT_DRY_RUN = "1";
process.env.REPORT_EMAIL_TO = process.env.REPORT_EMAIL_TO || "ops@example.invalid";
process.env.SMTP_USER = process.env.SMTP_USER || "smtp@example.invalid";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dry-run-password";

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
  const sourceIssueNotification = await notifyIfNeeded(sourceIssueStatus, { dryRun: true });
  assert(sourceIssueNotification.channels.includes("email:dry-run"), "Gmail/email dry-run channel missing for AI sourceIssues");

  let liveProbeText = "";
  if (process.env.VERIFY_HEATMAP_AI_ALERT_LIVE === "1" || process.argv.includes("--live")) {
    const clock = taipeiClock();
    const heatmap = await checkHeatmapLiveApi(clock);
    const marketAi = await checkMarketAiLiveApi(clock);
    assert.strictEqual(heatmap.name, "熱力圖 live API");
    assert.strictEqual(marketAi.name, "AI 判讀 live API");
    assert.strictEqual(heatmap.endpoint, "/api/heatmap?limit=999&stocks=999&source=desktop-live-contract");
    assert.strictEqual(marketAi.endpoint, "/api/market-ai-live?canvas=1&compact=1&shell=1&limit=40");
    const liveIssues = [...(heatmap.issues || []), ...(marketAi.issues || [])];
    liveProbeText = ` liveProbe heatmap=${heatmap.ok} ai=${marketAi.ok} issues=${liveIssues.length}`;
  }

  console.log(`[heatmap-ai-alert-path] ok sourceIssueEmail=${sourceIssueNotification.channels.join(",")} simulated=AI-sourceIssues+heatmapUsable-false${liveProbeText}`);
})();
