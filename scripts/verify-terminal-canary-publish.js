const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(argValue("--out", "outputs/terminal-canary-publish"));
const MANIFEST_FILE = path.resolve(argValue("--manifest", path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json")));
const SCORECARD_FILE = path.resolve(argValue("--scorecard", path.join(ROOT, "data", "scorecard-latest.json")));
const LIVE_MODE = process.argv.includes("--live") || /^(1|true|yes)$/i.test(String(process.env.FUMAN_CANARY_LIVE || ""));
const BASE_URL = String(process.env.FUMAN_VERIFY_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const AUTH_URL = String(process.env.FUMAN_MEMBERSHIP_AUTH_URL || "https://jxnqyqnigsppqsxinlrq.supabase.co").replace(/\/+$/, "");
const AUTH_KEY = process.env.FUMAN_MEMBERSHIP_AUTH_KEY || "sb_publishable_kCocRYzO4oCBnFRQO_pfvg_JZUl0oxm";
const MEMBER_EMAIL = String(process.env.FUMAN_TEST_MEMBER_EMAIL || "").trim();
const MEMBER_PASSWORD = String(process.env.FUMAN_TEST_MEMBER_PASSWORD || "");
const REQUIRE_PROTECTED_READBACK = /^(1|true|yes)$/i.test(String(process.env.FUMAN_REQUIRE_PROTECTED_READBACK || ""))
  || process.argv.includes("--require-protected-readback");
let MEMBER_BEARER_TOKEN = [
  process.env.FUMAN_VERIFY_BEARER_TOKEN,
  process.env.FUMAN_MEMBERSHIP_BEARER_TOKEN,
  process.env.FUMAN_AUTH_BEARER_TOKEN,
  process.env.FUMAN_TEST_MEMBER_ACCESS_TOKEN,
  process.env.FUMAN_SMOKE_BEARER_TOKEN,
].map((value) => String(value || "").trim()).find(Boolean) || "";

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function freshUrl(pathname) {
  if (/^https?:\/\//i.test(pathname)) return pathname;
  const separator = pathname.includes("?") ? "&" : "?";
  return `${BASE_URL}${pathname}${separator}canaryLive=${Date.now()}`;
}

async function ensureMemberToken() {
  if (MEMBER_BEARER_TOKEN) return { ok: true, source: "env-token", status: 0, error: "" };
  if (!MEMBER_EMAIL || !MEMBER_PASSWORD) return { ok: false, source: "none", status: 0, error: "protected readback token not armed" };
  const response = await fetch(`${AUTH_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    cache: "no-store",
    headers: { apikey: AUTH_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email: MEMBER_EMAIL, password: MEMBER_PASSWORD }),
  });
  const body = await response.text();
  const payload = parseJson(body);
  if (!response.ok || !payload?.access_token) {
    return { ok: false, source: "email-password", status: response.status, error: payload?.error_description || payload?.msg || body.slice(0, 160) };
  }
  MEMBER_BEARER_TOKEN = String(payload.access_token || "");
  return { ok: true, source: "email-password", status: response.status, error: "" };
}

async function readLiveScorecard() {
  const auth = await ensureMemberToken();
  if (!auth.ok) {
    if (REQUIRE_PROTECTED_READBACK) throw new Error(`live_scorecard_auth_failed:${auth.status || 0}:${auth.error}`);
    return {
      payload: null,
      useArtifactScorecard: true,
      readback: {
        status: auth.status || 0,
        authSource: auth.source,
        protectedReadbackNotArmed: true,
        displayOnly: true,
        error: auth.error,
      },
    };
  }
  const response = await fetch(freshUrl("/api/scorecard?live=1"), {
    cache: "no-store",
    headers: {
      authorization: `Bearer ${MEMBER_BEARER_TOKEN}`,
      "x-fuman-readback-auth": "membership-bearer",
      accept: "application/json",
    },
  });
  const body = await response.text();
  const payload = parseJson(body);
  if (!response.ok || !payload) throw new Error(`live_scorecard_read_failed:${response.status}:${body.slice(0, 160)}`);
  return { payload, readback: { status: response.status, authSource: auth.source } };
}
function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function clean(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function marketClosedPreviousGood(manifest = {}) {
  const bits = [
    manifest.waterRoot?.status,
    manifest.waterRoot?.reason,
    manifest.blocker,
    manifest.status,
  ].map(lower).join(" ");
  return bits.includes("market_closed") || bits.includes("previous_good") || bits.includes("wait_source_window") || bits.includes("skip_formal_scan");
}

function sourceReportsByKey(scorecard = {}) {
  const map = new Map();
  for (const row of Array.isArray(scorecard.sourceReports) ? scorecard.sourceReports : []) {
    const key = lower(row.key || row.strategyKey || row.sourceKey);
    if (key) map.set(key, row);
  }
  return map;
}

function hasFallbackSignal(row = {}) {
  const text = lower([
    row.reason,
    row.error,
    row.fallbackReason,
    row.cacheSource,
    row.source,
    row.status,
    row.qualityStatus,
  ].join(" "));
  return row.fallback === true
    || row.fallbackUsed === true
    || row.publishAllowed === false
    || text.includes("fallback")
    || text.includes("stale")
    || text.includes("previous_good");
}

function isPendingNotDueModule(row = {}) {
  const issueText = [
    Array.isArray(row.issues) ? row.issues.join(" ") : "",
    row.issue || "",
    row.blocker || "",
    row.reason || "",
  ].join(" ");
  return row.pendingNotDue === true
    || lower(row.status) === "pending_not_due"
    || lower(issueText).includes("pending_not_due");
}

function runIdDate(row = {}) {
  const raw = clean(row.runId || row.run_id || row.latestRunId || "");
  const match = raw.match(/20\d{6}/);
  return match ? match[0] : "";
}

function manifestPendingNotDuePreviousGood(modules = []) {
  if (!modules.length) return false;
  return modules.every((row) => isPendingNotDueModule(row)
    && row.ok === true
    && row.fallback !== true
    && clean(row.runId));
}

function maxModuleRunDate(modules = []) {
  return modules.map(runIdDate).filter(Boolean).sort().pop() || "";
}

function manifestFullyClosed(manifest = {}, modules = []) {
  if (manifest.ok !== true) return false;
  if (!modules.length) return false;
  return modules.every((row) => isPendingNotDueModule(row)
    || (row.ok === true && row.complete === true && row.fallback !== true && clean(row.runId)));
}
function validateCanary(manifest, scorecard, options = {}) {
  const issues = [];
  const tradeDate = compactDate(manifest.tradeDate);
  const scorecardDate = compactDate(scorecard.latestDate || scorecard.marketDate || scorecard.summary?.latestDate);
  const reports = sourceReportsByKey(scorecard);
  const modules = (Array.isArray(manifest.modules) ? manifest.modules : []).filter((row) => row.key && row.key !== "market");
  const pendingPreviousGood = manifestPendingNotDuePreviousGood(modules);
  const previousGoodDate = maxModuleRunDate(modules);
  const closed = marketClosedPreviousGood(manifest) || pendingPreviousGood;
  const expectedReportDate = pendingPreviousGood ? previousGoodDate : tradeDate;

  if (manifest.contract !== "daily-terminal-run-manifest-v1") issues.push("manifest_contract_invalid");
  if (scorecard.contract !== "scorecard-resource-chain-v1") issues.push("scorecard_contract_invalid");
  if (!tradeDate) issues.push("manifest_tradeDate_missing");
  if (!pendingPreviousGood && scorecardDate !== tradeDate) issues.push(`scorecard_latestDate_mismatch:${scorecardDate || "missing"}!=${tradeDate || "missing"}`);
  if (pendingPreviousGood && scorecardDate !== previousGoodDate) issues.push(`scorecard_previousGoodDate_mismatch:${scorecardDate || "missing"}!=${previousGoodDate || "missing"}`);
  if (scorecard.ok !== true) issues.push("scorecard_ok_not_true");
  if (scorecard.qualityStatus && lower(scorecard.qualityStatus) !== "complete") issues.push(`scorecard_quality_not_complete:${scorecard.qualityStatus}`);
  if (!Array.isArray(scorecard.records) || scorecard.records.length <= 0) issues.push("scorecard_records_empty");
  if (!Array.isArray(scorecard.sourceReports) || scorecard.sourceReports.length <= 0) issues.push("scorecard_sourceReports_empty");
  const allowMarketClosedPublish = closed && (manifestFullyClosed(manifest, modules) || pendingPreviousGood);
  const enforcePublishable = !closed || allowMarketClosedPublish;
  if (!closed && (manifest.ok !== true || manifest.unattendedStatus !== "YES")) {
    issues.push(`manifest_not_green:${manifest.unattendedStatus || "missing"}`);
  }
  if (closed && !allowMarketClosedPublish) {
    issues.push(`manifest_market_closed_not_publishable:${manifest.unattendedStatus || "missing"}`);
  }

  for (const row of modules) {
    const key = lower(row.key);
    if (isPendingNotDueModule(row) && !pendingPreviousGood) continue;
    const report = reports.get(key);
    if (!report) {
      issues.push(`sourceReport_missing:${row.key}`);
      continue;
    }
    const reportRunId = clean(report.runId || report.run_id);
    const expectedRunId = clean(row.runId);
    const reportDate = compactDate(report.date || report.tradeDate || report.marketDate || report.updatedAt || reportRunId);
    if (!expectedRunId) issues.push(`manifest_module_runId_missing:${row.key}`);
    if (reportRunId !== expectedRunId) issues.push(`sourceReport_runId_mismatch:${row.key}:${reportRunId || "missing"}!=${expectedRunId || "missing"}`);
    if (reportDate !== expectedReportDate) issues.push(`sourceReport_date_mismatch:${row.key}:${reportDate || "missing"}!=${expectedReportDate || "missing"}`);
    if (report.ok !== true) issues.push(`sourceReport_not_ok:${row.key}`);
    if (Number(report.statusCode || 200) >= 400) issues.push(`sourceReport_http_bad:${row.key}:${report.statusCode}`);
    if (enforcePublishable && hasFallbackSignal(report)) issues.push(`sourceReport_fallback_or_stale:${row.key}`);
    if (enforcePublishable && !isPendingNotDueModule(row) && (row.ok !== true || row.complete !== true || row.fallback === true)) {
      issues.push(`manifest_module_not_publishable:${row.key}`);
    }
  }

  const closureOk = issues.length === 0 && (!closed || allowMarketClosedPublish);
  const publishAllowed = issues.length === 0 && !closed;
  return {
    ok: closureOk,
    contract: "terminal-canary-publish-v1",
    checkedAt: new Date().toISOString(),
    status: closed ? (closureOk ? "CANARY_READY_MARKET_CLOSED_CLOSURE" : "NOT_ARMED_MARKET_CLOSED_PREVIOUS_GOOD") : (publishAllowed ? "CANARY_READY" : "BLOCKED"),
    scorecardPublishAllowed: publishAllowed,
    marketClosedPreviousGood: closed,
    tradeDate: expectedReportDate,
    manifestTradeDate: tradeDate,
    manifest: {
      ok: manifest.ok === true,
      unattendedStatus: manifest.unattendedStatus || "",
      modules: modules.length,
      blocker: manifest.blocker || "",
    },
    scorecard: {
      ok: scorecard.ok === true,
      latestDate: scorecard.latestDate || scorecard.summary?.latestDate || "",
      records: Array.isArray(scorecard.records) ? scorecard.records.length : 0,
      sourceReports: Array.isArray(scorecard.sourceReports) ? scorecard.sourceReports.length : 0,
      cacheSource: scorecard.cacheSource || "",
    },
    issues,
    mode: options.mode || "artifact",
  };
}

function markdown(payload) {
  const lines = [];
  lines.push("# Terminal Canary Publish");
  lines.push("");
  lines.push(`- checkedAt: ${payload.checkedAt}`);
  lines.push(`- tradeDate: ${payload.tradeDate}`);
  lines.push(`- status: ${payload.status}`);
  lines.push(`- scorecardPublishAllowed: ${payload.scorecardPublishAllowed}`);
  lines.push(`- marketClosedPreviousGood: ${payload.marketClosedPreviousGood}`);
  lines.push(`- issues: ${payload.issues.join("; ") || "none"}`);
  lines.push("");
  lines.push("## Evidence");
  lines.push(`- manifest: ok=${payload.manifest.ok} unattended=${payload.manifest.unattendedStatus} modules=${payload.manifest.modules}`);
  lines.push(`- scorecard: ok=${payload.scorecard.ok} latestDate=${payload.scorecard.latestDate} records=${payload.scorecard.records} sourceReports=${payload.scorecard.sourceReports}`);
  return `${lines.join("\n")}\n`;
}

function selfTests() {
  const manifest = {
    contract: "daily-terminal-run-manifest-v1",
    tradeDate: "20260717",
    ok: true,
    unattendedStatus: "YES",
    modules: [
      { key: "strategy2", runId: "strategy2-20260717-a", ok: true, complete: true, fallback: false },
      { key: "strategy3", runId: "strategy3-20260717-a", ok: true, complete: true, fallback: false },
    ],
  };
  const scorecard = {
    ok: true,
    contract: "scorecard-resource-chain-v1",
    qualityStatus: "complete",
    latestDate: "2026-07-17",
    records: [{ strategy: "x" }],
    sourceReports: [
      { key: "strategy2", ok: true, statusCode: 200, runId: "strategy2-20260717-a", date: "20260717" },
      { key: "strategy3", ok: true, statusCode: 200, runId: "strategy3-20260717-a", date: "20260717" },
    ],
  };
  const cases = [
    { name: "green", mutate: (m, s) => [m, s], expectOk: true },
    { name: "missing-report", mutate: (m, s) => [m, { ...s, sourceReports: s.sourceReports.slice(0, 1) }], expectOk: false, issue: "sourceReport_missing:strategy3" },
    { name: "runid-mismatch", mutate: (m, s) => [m, { ...s, sourceReports: [{ ...s.sourceReports[0], runId: "old" }, s.sourceReports[1]] }], expectOk: false, issue: "sourceReport_runId_mismatch:strategy2" },
    { name: "fallback-report", mutate: (m, s) => [m, { ...s, sourceReports: [{ ...s.sourceReports[0], fallbackUsed: true }, s.sourceReports[1]] }], expectOk: false, issue: "sourceReport_fallback_or_stale:strategy2" },
  ];
  const failures = [];
  for (const item of cases) {
    const [m, s] = item.mutate(JSON.parse(JSON.stringify(manifest)), JSON.parse(JSON.stringify(scorecard)));
    const result = validateCanary(m, s, { mode: `self-test:${item.name}` });
    const hasIssue = item.issue ? result.issues.some((issue) => issue.includes(item.issue)) : true;
    if (result.ok !== item.expectOk || !hasIssue) failures.push({ name: item.name, result });
  }
  return failures;
}

async function main() {
  const manifest = readJson(MANIFEST_FILE);
  let scorecard = readJson(SCORECARD_FILE);
  let mode = "artifact";
  let liveReadback = null;
  if (LIVE_MODE) {
    const live = await readLiveScorecard();
    if (live.payload) {
      scorecard = live.payload;
      mode = "production-live";
    } else {
      mode = "production-live-auth-split-artifact-scorecard";
    }
    liveReadback = live.readback;
  }
  const payload = validateCanary(manifest, scorecard, { mode });
  if (liveReadback) payload.liveReadback = liveReadback;
  const selfTestFailures = selfTests();
  if (selfTestFailures.length) {
    payload.ok = false;
    payload.issues.push(`self_test_failed:${selfTestFailures.map((item) => item.name).join(",")}`);
    payload.selfTestFailures = selfTestFailures;
  }
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const jsonFile = path.join(OUT_DIR, "terminal-canary-publish.json");
  const mdFile = path.join(OUT_DIR, "terminal-canary-publish.md");
  await fs.promises.writeFile(jsonFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.promises.writeFile(mdFile, markdown(payload), "utf8");
  console.log(JSON.stringify({
    ok: payload.ok,
    status: payload.status,
    scorecardPublishAllowed: payload.scorecardPublishAllowed,
    tradeDate: payload.tradeDate,
    issues: payload.issues,
    output: jsonFile,
  }, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[terminal-canary-publish] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});

module.exports = { validateCanary, selfTests };
