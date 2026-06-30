"use strict";

const assert = require("assert");

process.env.TERMINAL_HEALTH_ALERT_DRY_RUN = "1";
process.env.REPORT_EMAIL_TO = process.env.REPORT_EMAIL_TO || "ops@example.invalid";
process.env.SMTP_USER = process.env.SMTP_USER || "smtp@example.invalid";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dry-run-password";

const {
  checkHeatmapLiveApi,
  checkMarketAiLiveApi,
  notifyIfNeeded,
  taipeiClock,
} = require("./monitor-terminal-api-health");

(async () => {
  const clock = taipeiClock();
  const heatmap = await checkHeatmapLiveApi(clock);
  const marketAi = await checkMarketAiLiveApi(clock);

  assert.strictEqual(heatmap.name, "熱力圖 live API");
  assert.strictEqual(marketAi.name, "AI 判讀 live API");
  assert.strictEqual(heatmap.endpoint, "/api/heatmap?limit=999&stocks=999&source=desktop-live-contract");
  assert.strictEqual(marketAi.endpoint, "/api/market-ai-live?canvas=1&compact=1&shell=1&limit=40");

  const liveIssues = [...(heatmap.issues || []), ...(marketAi.issues || [])];
  const simulatedStatus = {
    ok: liveIssues.length === 0,
    source: "terminal-api-health",
    baseUrl: process.env.FUMAN_TERMINAL_BASE_URL || "https://fuman-terminal.vercel.app",
    updatedAt: new Date().toISOString(),
    issues: liveIssues.length ? liveIssues : [{
      severity: "critical",
      message: "熱力圖/AI live API dry-run 測試異常",
      detail: {
        heatmapEndpoint: heatmap.endpoint,
        marketAiEndpoint: marketAi.endpoint,
      },
    }],
  };
  const notification = await notifyIfNeeded(simulatedStatus, { dryRun: true });
  assert(notification.channels.includes("email:dry-run"), "Gmail/email dry-run channel missing");

  const issueText = liveIssues.map((item) => `${item.message || item.severity}:${item.detail?.error || item.detail?.reason || ""}`).slice(0, 3).join(" | ");
  console.log(`[heatmap-ai-alert-path] ok heatmap=${heatmap.ok} ai=${marketAi.ok} issues=${liveIssues.length} email=${notification.channels.join(",")}${issueText ? ` detail=${issueText}` : ""}`);
})();
