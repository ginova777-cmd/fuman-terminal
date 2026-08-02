const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "outputs", "terminal-display-correctness");
const RESOURCE_CHAIN_FILE = path.join(ROOT, "outputs", "terminal-resource-chain-audit", "terminal-resource-chain-audit.json");
const MANIFEST_FILE = path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json");
const CANARY_FILE = path.join(ROOT, "outputs", "terminal-canary-publish", "terminal-canary-publish.json");

const FORMAL_KEYS = new Set(["strategy2", "strategy3", "strategy4", "strategy5", "institution", "cb", "warrant"]);

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function clean(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function compactDate(value) {
  const raw = clean(value);
  if (!raw) return "";
  const direct = raw.replace(/\D/g, "");
  if (direct.length >= 8) return direct.slice(0, 8);
  const ms = Date.parse(raw);
  if (Number.isFinite(ms)) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ms)).replace(/\D/g, "");
  }
  return "";
}

function runDate(value) {
  const match = clean(value).match(/20\d{6}/);
  return match ? match[0] : "";
}

function number(value) {
  const n = Number(String(value ?? "").replace(/[,%]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function statusText(...rows) {
  return rows.map((row) => {
    if (!row) return "";
    return [
      row.status,
      row.qualityStatus,
      row.cacheSource,
      row.transportSource,
      row.source,
      row.error,
      row.reason,
      row.evidenceStatus,
      row.unattendedStatus,
      row.run_quality_at_publish?.blockedReason,
      row.blockingReason,
    ].map(clean).join(" ");
  }).join(" ").toLowerCase();
}

function surfaceRunId(row) {
  return clean(row?.runId || row?.run_id || "");
}

function surfaceDate(row) {
  return runDate(surfaceRunId(row)) || compactDate(row?.date || row?.tradeDate || row?.marketDate || row?.updatedAt || row?.finishedAt);
}

function isProtected(row) {
  return row?.membershipProtected === true || /membership|required|missing-bearer-token|locked/i.test(statusText(row));
}

function isExplicitPreviousGood(row) {
  return /previous|preserve|preserved|degraded|fallback|market_closed|blocked_preserved/.test(statusText(row));
}

function isExplicitBlocked(row) {
  return /blocked|insufficient|not_allowed|source_quality_fail|degraded/.test(statusText(row))
    || row?.publishAllowed === false
    || row?.fallback === true
    || row?.fallbackUsed === true
    || row?.preservePreviousGood === true;
}

function surfaceSummary(name, row) {
  return {
    name,
    protected: isProtected(row),
    runId: surfaceRunId(row),
    date: surfaceDate(row),
    count: number(row?.count ?? row?.returnedCount ?? row?.readbackCount),
    ok: row?.ok === true,
    status: row?.status ?? "",
    explicitPreviousGood: isExplicitPreviousGood(row),
    explicitBlocked: isExplicitBlocked(row),
  };
}

function classifyModule(result, expectedDate, marketCalendar) {
  const issues = [];
  const key = result.key;
  const receipt = result.receipt || {};
  const supabase = result.supabase || {};
  const surfaces = [
    surfaceSummary("productionApi", result.live),
    surfaceSummary("terminalApi", result.terminalApi),
    surfaceSummary("desktopSnapshot", result.desktopSnapshot),
    surfaceSummary("mobileFragment", result.mobileFragment),
    surfaceSummary("scorecard88", result.scorecard),
  ];
  const authoritativeRunId = clean(supabase.runId || result.live?.runId || result.terminalApi?.runId || receipt.runId);
  const authoritativeDate = runDate(authoritativeRunId) || compactDate(supabase.date || supabase.tradeDate || supabase.updatedAt || receipt.finishedAt);
  const expectedDisplayDate = compactDate(marketCalendar?.displayTradeDate) || expectedDate;
  const marketClosedHold = marketCalendar?.marketOpen === false
    && marketCalendar?.preservePreviousGood === true
    && marketCalendar?.formalScanSkipped === true;
  const receiptComplete = receipt.status === "complete" && receipt.complete === true && receipt.fallback !== true && receipt.publishAllowed !== false;
  const latestComplete = supabase.ok === true
    && Boolean(authoritativeRunId)
    && authoritativeDate === expectedDate
    && !/degraded|fallback|previous|preserve/.test(statusText(supabase));
  const zeroResultComplete = latestComplete && number(supabase.count) === 0;
  const currentComplete = latestComplete && number(supabase.count) > 0;
  const previousGoodDegraded = marketClosedHold
    && Boolean(authoritativeRunId)
    && authoritativeDate === expectedDisplayDate
    && surfaces.some((surface) => surface.explicitPreviousGood || surface.explicitBlocked);

  if (!authoritativeRunId) issues.push(`${key}:missing_authoritative_runId`);
  if (authoritativeDate && authoritativeDate !== expectedDate && !previousGoodDegraded) {
    issues.push(`${key}:authoritative_date_stale:${authoritativeDate}!=${expectedDate}`);
  }
  if (marketClosedHold && authoritativeDate && authoritativeDate !== expectedDisplayDate) {
    issues.push(`${key}:previous_good_not_last_display_trade_date:${authoritativeDate}!=${expectedDisplayDate}`);
  }
  if (!receiptComplete && !previousGoodDegraded) {
    issues.push(`${key}:scanner_not_complete_without_explicit_previous_good:${receipt.status || "missing"}`);
  }

  for (const surface of surfaces) {
    if (surface.protected) continue;
    if (!surface.runId && surface.name !== "scorecard88") {
      issues.push(`${key}:${surface.name}_missing_runId`);
      continue;
    }
    if (surface.runId && authoritativeRunId && surface.runId !== authoritativeRunId) {
      issues.push(`${key}:${surface.name}_runId_mismatch:${surface.runId}!=${authoritativeRunId}`);
    }
    if (surface.date && surface.date !== expectedDate && !previousGoodDegraded) {
      issues.push(`${key}:${surface.name}_date_stale:${surface.date}!=${expectedDate}`);
    }
    if (previousGoodDegraded && surface.date && surface.date !== expectedDisplayDate) {
      issues.push(`${key}:${surface.name}_previous_good_date_wrong:${surface.date}!=${expectedDisplayDate}`);
    }
    if (surface.date && surface.date !== expectedDate && !surface.explicitPreviousGood && !surface.explicitBlocked) {
      issues.push(`${key}:${surface.name}_stale_without_visible_degraded_label:${surface.date}`);
    }
  }

  let state = "blocked";
  if (currentComplete) state = "current-complete";
  else if (zeroResultComplete) state = "zero-result-complete";
  else if (previousGoodDegraded) state = "previous-good-degraded";

  return {
    key,
    state,
    ok: issues.length === 0 && (state === "current-complete" || state === "zero-result-complete" || state === "previous-good-degraded"),
    expectedDate,
    expectedDisplayDate,
    authoritativeRunId,
    authoritativeDate,
    receipt: {
      status: receipt.status || "",
      complete: receipt.complete === true,
      publishAllowed: receipt.publishAllowed === true,
      preservePreviousGood: receipt.preservePreviousGood === true,
    },
    supabase: {
      ok: supabase.ok === true,
      runId: clean(supabase.runId),
      date: compactDate(supabase.date || supabase.tradeDate || supabase.updatedAt || supabase.runId),
      count: number(supabase.count),
      qualityStatus: supabase.qualityStatus || "",
    },
    surfaces,
    issues,
  };
}

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const resourceChain = readJson(RESOURCE_CHAIN_FILE);
  const manifest = readJson(MANIFEST_FILE);
  const canary = readJson(CANARY_FILE);
  const expectedDate = compactDate(resourceChain.expectedDate || manifest.tradeDate || canary.tradeDate);
  const issues = [];
  if (!expectedDate) issues.push("expected_date_missing");
  if (resourceChain.ok !== true) issues.push("resource_chain_not_green_input");
  if (canary.ok !== true) issues.push(`canary_not_green:${(canary.issues || [])[0] || canary.status || "unknown"}`);

  const rows = (Array.isArray(resourceChain.results) ? resourceChain.results : [])
    .filter((row) => FORMAL_KEYS.has(row.key))
    .map((row) => classifyModule(row, expectedDate, resourceChain.marketCalendar || {}));

  for (const row of rows) {
    for (const issue of row.issues) issues.push(issue);
  }

  const stateCounts = rows.reduce((acc, row) => {
    acc[row.state] = (acc[row.state] || 0) + 1;
    return acc;
  }, {});
  const payload = {
    ok: issues.length === 0,
    contract: "terminal-display-correctness-v1",
    checkedAt: new Date().toISOString(),
    rule: "Formal terminal surfaces may show only current-complete, zero-result-complete, or explicit previous-good-degraded; stale data without a visible degraded/previous-good state fails.",
    expectedDate,
    marketCalendar: {
      marketOpen: resourceChain.marketCalendar?.marketOpen === true,
      displayTradeDate: resourceChain.marketCalendar?.displayTradeDate || "",
      preservePreviousGood: resourceChain.marketCalendar?.preservePreviousGood === true,
      formalScanSkipped: resourceChain.marketCalendar?.formalScanSkipped === true,
    },
    stateCounts,
    modules: rows,
    issues,
  };
  const outFile = path.join(OUT_DIR, "terminal-display-correctness.json");
  await fs.promises.writeFile(outFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: payload.ok,
    contract: payload.contract,
    expectedDate: payload.expectedDate,
    stateCounts: payload.stateCounts,
    issueCount: payload.issues.length,
    firstIssues: payload.issues.slice(0, 12),
    output: outFile,
  }, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[terminal-display-correctness] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
