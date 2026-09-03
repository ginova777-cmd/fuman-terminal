"use strict";

const strategy2Latest = require("../api/strategy2-latest");
const terminalFastBundle = require("../api/terminal-fast-bundle");
const mobileFragment = require("../api/mobile-fragment");
const scorecard = require("../api/scorecard");

function capture() {
  let resolve;
  const result = new Promise((done) => { resolve = done; });
  return { result, response: {
    statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { resolve({ statusCode: this.statusCode, payload }); return this; },
    send(payload) { resolve({ statusCode: this.statusCode, payload }); return this; },
    end(payload = "") { resolve({ statusCode: this.statusCode, payload }); return this; },
  } };
}
async function invoke(handler, url, query) {
  const target = capture();
  await handler({ method: "GET", url, query, headers: { host: "localhost" }, fumanInternalVerify: true }, target.response);
  return target.result;
}
function strategy2Endpoint(payload) {
  return Object.entries(payload?.endpoints || {}).find(([key]) => key.includes("/api/strategy2-latest"))?.[1] || null;
}
function strategy2Report(payload) {
  return (payload?.sourceReports || []).find((row) => row?.key === "strategy2") || null;
}
function check(checks, code, ok, evidence = {}) { checks.push({ code, ok: ok === true, evidence }); }

async function main() {
  const expectedRunId = process.argv.find((item) => item.startsWith("--run-id="))?.slice(9) || "";
  const expectedCount = Number(process.argv.find((item) => item.startsWith("--count="))?.slice(8) || 0);
  const latest = await invoke(strategy2Latest, "/api/strategy2-latest?today=1&live=1", { today: "1", live: "1", limit: "1200" });
  const desktop = await invoke(terminalFastBundle, "/api/terminal-fast-bundle?route=strategy2", { route: "strategy2", today: "1", live: "1" });
  const mobile = await invoke(mobileFragment, "/api/mobile-fragment?tab=strategy2", { tab: "strategy2", live: "1" });
  const card = await invoke(scorecard, "/api/scorecard?live=1", { live: "1" });
  const desktopRow = strategy2Endpoint(desktop.payload);
  const scorecardRow = strategy2Report(card.payload);
  const mobileHtml = String(mobile.payload || "");
  const checks = [];
  check(checks, "strategy2_api_replay", latest.statusCode === 200 && latest.payload?.runId === expectedRunId && latest.payload?.diagnosticReplay === true && latest.payload?.publishAllowed === false && Number(latest.payload?.count) === expectedCount, { status: latest.statusCode, runId: latest.payload?.runId, count: latest.payload?.count });
  check(checks, "desktop_same_replay", desktop.statusCode === 200 && desktopRow?.runId === expectedRunId && desktopRow?.diagnosticReplay === true && desktopRow?.publishAllowed === false && Number(desktopRow?.resultCount) === expectedCount && Number(desktopRow?.count) > 0, { status: desktop.statusCode, runId: desktopRow?.runId, count: desktopRow?.count, resultCount: desktopRow?.resultCount });
  check(checks, "mobile_same_replay", mobile.statusCode === 200 && mobileHtml.includes(`data-run-id="${expectedRunId}"`) && mobileHtml.includes(`data-result-count="${expectedCount}"`) && mobileHtml.includes("回測驗證") && mobileHtml.includes('data-formal-display-allowed="0"'), { status: mobile.statusCode, runIdPresent: mobileHtml.includes(expectedRunId), countPresent: mobileHtml.includes(`data-result-count="${expectedCount}"`) });
  check(checks, "scorecard_same_replay_status", card.statusCode === 200 && scorecardRow?.runId === expectedRunId && scorecardRow?.terminalSourceRunId === expectedRunId && scorecardRow?.evidenceStatus === "diagnostic_replay" && scorecardRow?.publishAllowed === false && Number(scorecardRow?.count) === expectedCount && Array.isArray(scorecardRow?.candidateSignatures) && scorecardRow.candidateSignatures.length === 0 && Array.isArray(scorecardRow?.rowAuditSignatures) && scorecardRow.rowAuditSignatures.length === 0, { status: card.statusCode, row: scorecardRow });
  const issues = checks.filter((item) => !item.ok).map((item) => item.code);
  console.log(JSON.stringify({ ok: issues.length === 0, contract: "strategy2-diagnostic-tri-surface-v1", expectedRunId, expectedCount, checks, issues, firstBlocker: issues[0] || null }, null, 2));
  if (issues.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
