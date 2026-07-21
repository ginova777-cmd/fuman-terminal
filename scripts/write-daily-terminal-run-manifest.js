const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/daily-terminal-run");
let EXPECTED_DATE = (process.argv.find((arg) => arg.startsWith("--expected-date="))?.slice("--expected-date=".length) || taipeiDateKey()).replace(/\D/g, "").slice(0, 8);
const REQUESTED_DATE = EXPECTED_DATE;
const SKIP_RUN = process.argv.includes("--from-existing");
const REQUIRE_FORMAL_NOW = process.argv.includes("--require-formal-now");
const STRATEGY_DUE_TIMES = {
  strategy2: "09:00",
  strategy3: "13:05",
  strategy4: "16:00",
  strategy5: "21:00",
  institution: "21:00",
  cb: "21:25",
  warrant: "20:30",
};

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replace(/\D/g, "");
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}


function taipeiMinuteOfDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
}

function minuteFromClock(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function scheduleStatusForKey(key) {
  const dueTime = STRATEGY_DUE_TIMES[key] || "00:00";
  const dueMinute = minuteFromClock(dueTime);
  const currentMinute = taipeiMinuteOfDay();
  const pendingNotDue = dueMinute !== null && currentMinute < dueMinute;
  return {
    dueTime,
    currentMinute,
    dueMinute,
    pendingNotDue,
    status: pendingNotDue ? "PENDING_NOT_DUE" : "DUE",
  };
}
function runDateFromId(value) {
  const match = String(value || "").match(/(?:^|[-_])(\d{8})(?:[-_]|$)/);
  return match ? match[1] : "";
}

function compactDate(value) {
  const text = String(value || "");
  if (!text) return "";
  const direct = text.replace(/\D/g, "");
  return direct.length >= 8 ? direct.slice(0, 8) : "";
}

function runNode(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env },
  });
  return {
    label,
    command: `node ${args.join(" ")}`,
    exitCode: result.status ?? 1,
    stdout: String(result.stdout || "").slice(-4000),
    stderr: String(result.stderr || "").slice(-4000),
    ok: result.status === 0,
  };
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return "";
}

function bool(value) {
  return value === true;
}

function isPreviousGoodHoldWaterRoot(water = {}) {
  const bits = [
    water.status,
    water.reason,
    water.marketCalendar?.row?.displayMode,
    water.marketCalendar?.row?.skipReason,
    water.marketCalendar?.row?.reason,
    water.sourceStatus?.summary?.status,
    water.sourceStatus?.summary?.message,
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  return water.preservePreviousGood === true
    || water.formalScanSkipped === true
    || water.marketCalendar?.row?.preservePreviousGood === true
    || bits.includes("previous_good")
    || bits.includes("wait_source_window")
    || bits.includes("skip_formal_scan")
    || bits.includes("market_closed");
}


function resolveExpectedDateFromWater(water = {}, fallbackDate = EXPECTED_DATE) {
  const targetDate = compactDate(
    water.expectedDate
    || water.scannerTargetDate
    || water.scannerTargetTradeDate
    || water.marketCalendar?.row?.scannerTargetDate
    || water.marketCalendar?.row?.targetTradeDate
  );
  const displayTradeDate = compactDate(water.marketCalendar?.row?.displayTradeDate || water.displayTradeDate || "");
  const marketOpen = water.marketCalendar?.row?.marketOpen === true
    || water.marketCalendar?.row?.tradingDayOpen === true
    || water.marketCalendar?.marketOpen === true
    || water.marketCalendar?.tradingDayOpen === true;
  const waterReady = water.ok === true && /ready|ok/.test(String(water.status || "").toLowerCase());
  if ((marketOpen || waterReady || REQUIRE_FORMAL_NOW) && targetDate) return targetDate;
  if (displayTradeDate && !REQUIRE_FORMAL_NOW) return displayTradeDate;
  return compactDate(fallbackDate || taipeiDateKey());
}
function moduleRow(row = {}) {
  const scheduleStatus = scheduleStatusForKey(row.key);
  let receipt = row.receipt || {};
  const supabase = row.supabase || {};
  const supabaseDate = firstPresent(runDateFromId(supabase.runId), compactDate(supabase.tradeDate || supabase.date || supabase.updatedAt));
  const supabaseCompleteRun = supabase.ok === true
    && supabase.runId
    && supabaseDate === EXPECTED_DATE
    && ["ok", "complete", "ready"].includes(String(supabase.qualityStatus || supabase.status || "").toLowerCase());
  const supabaseSupersedesReceipt = supabaseCompleteRun
    && supabase.runId
    && receipt.runId
    && String(supabase.runId) > String(receipt.runId);
  if (supabaseCompleteRun && (runDateFromId(receipt.runId) !== EXPECTED_DATE || supabaseSupersedesReceipt)) {
    receipt = {
      ...receipt,
      status: "complete",
      complete: true,
      fallback: false,
      runId: supabase.runId,
      matches: Number(firstPresent(supabase.count, supabase.resultCount, receipt.matches, 0)) || 0,
      qualityStatus: supabase.qualityStatus || "complete",
      supersededBySupabaseLatestCompleteRun: true,
    };
  }
  const api = row.live || {};
  const terminal = row.terminalApi || {};
  const desktop = row.desktopSnapshot || {};
  const mobile = row.mobileFragment || {};
  const scorecard = row.scorecard || {};
  const runId = firstPresent(api.runId, terminal.runId, supabase.runId, receipt.runId, desktop.runId, mobile.runId, scorecard.runId);
  const tradeDate = firstPresent(
    runDateFromId(runId),
    runDateFromId(receipt.runId),
    runDateFromId(supabase.runId),
    compactDate(api.tradeDate || api.date),
    compactDate(terminal.tradeDate || terminal.date),
    compactDate(supabase.tradeDate || supabase.date || supabase.updatedAt),
  );
  const sourceDate = firstPresent(
    compactDate(api.sourceDate || api.marketDate || api.tradeDate || api.date),
    compactDate(terminal.sourceDate || terminal.marketDate || terminal.tradeDate || terminal.date),
    compactDate(supabase.sourceDate || supabase.marketDate || supabase.tradeDate || supabase.date),
    tradeDate,
  );
  let issues = Array.isArray(row.issues) ? [...row.issues] : [];
  if (receipt.supersededBySupabaseLatestCompleteRun === true) {
    issues = issues.filter((issue) => !/scanner receipt|manifest_scanner|manifest_runId_mismatch|receipt date/i.test(String(issue || "")));
  }
  const fallback = bool(receipt.fallback)
    || api.fallbackUsed === true
    || terminal.fallbackUsed === true
    || desktop.fallbackUsed === true
    || String(api.cacheSource || terminal.cacheSource || desktop.cacheSource || "").includes("fallback");
  const complete = receipt.complete === true
    && receipt.status === "complete"
    && !fallback
    && (row.ok === true || receipt.supersededBySupabaseLatestCompleteRun === true)
    && runId
    && tradeDate === EXPECTED_DATE
    && sourceDate === EXPECTED_DATE;
  const runIds = {
    scanner: receipt.runId || "",
    supabase: supabase.runId || "",
    productionApi: api.runId || terminal.runId || "",
    desktop: desktop.runId || terminal.runId || "",
    mobile: mobile.runId || "",
    scorecard88: scorecard.runId || "",
  };
  const runIdValues = Object.values(runIds).filter(Boolean);
  const uniqueRunIds = [...new Set(runIdValues)];
  const pendingNotDue = scheduleStatus.pendingNotDue === true && tradeDate !== EXPECTED_DATE;
  if (!pendingNotDue && uniqueRunIds.length > 1) issues.push(`manifest_runId_mismatch:${uniqueRunIds.join(",")}`);
  if (!pendingNotDue && !runId) issues.push("manifest_missing_runId");
  if (!pendingNotDue && tradeDate !== EXPECTED_DATE) issues.push(`manifest_tradeDate_mismatch:${tradeDate || "missing"}!=${EXPECTED_DATE}`);
  if (!pendingNotDue && sourceDate !== EXPECTED_DATE) issues.push(`manifest_sourceDate_mismatch:${sourceDate || "missing"}!=${EXPECTED_DATE}`);
  if (!pendingNotDue && fallback) issues.push("manifest_fallback_true");
  if (!pendingNotDue && (receipt.status !== "complete" || receipt.complete !== true)) issues.push(`manifest_scanner_not_complete:${receipt.status || "missing"}`);
  const scorecard88Protection = scorecard.membershipProtected
    ? "membership-protected"
    : scorecard.runId
      ? "readback"
      : "not-read";
  return {
    key: row.key,
    label: row.label,
    runId,
    tradeDate,
    sourceDate,
    complete,
    fallback,
    evidenceStatus: firstPresent(api.evidenceStatus, terminal.evidenceStatus, desktop.evidenceStatus, ""),
    publishAllowed: api.publishAllowed === true || terminal.publishAllowed === true || desktop.publishAllowed === true,
    resultCount: Number(firstPresent(api.count, terminal.count, desktop.count, supabase.count, receipt.matches, 0)) || 0,
    readbackCount: Number(firstPresent(api.readbackCount, terminal.readbackCount, desktop.readbackCount, 0)) || 0,
    runIds,
    scorecard88Protection,
    scheduleStatus,
    pendingNotDue,
    status: pendingNotDue ? "PENDING_NOT_DUE" : ((issues.length === 0 && complete) ? "CLOSED" : "BLOCKED"),
    ok: pendingNotDue ? true : (issues.length === 0 && complete),
    issues: pendingNotDue ? [`pending_not_due:${scheduleStatus.dueTime}`] : issues,
  };
}

function markdown(manifest) {
  const lines = [];
  lines.push("# Daily Terminal Run Manifest");
  lines.push("");
  lines.push(`- checkedAt: ${manifest.checkedAt}`);
  lines.push(`- tradeDate: ${manifest.tradeDate}`);
  lines.push(`- unattendedStatus: ${manifest.unattendedStatus}`);
  lines.push(`- ok: ${manifest.ok}`);
  lines.push(`- blocker: ${manifest.blocker || "--"}`);
  lines.push("");
  lines.push("| module | runId | tradeDate | sourceDate | complete | fallback | resultCount | API/Desktop/Mobile/88 | issues |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---|---|");
  for (const row of manifest.modules) {
    lines.push(`| ${row.label || row.key} | ${row.runId || "--"} | ${row.tradeDate || "--"} | ${row.sourceDate || "--"} | ${row.complete} | ${row.fallback} | ${row.resultCount} | api=${row.runIds.productionApi || "--"}<br>desktop=${row.runIds.desktop || "--"}<br>mobile=${row.runIds.mobile || "--"}<br>88=${row.runIds.scorecard88 || row.scorecard88Protection || "--"} | ${row.issues.join("<br>") || "OK"} |`);
  }
  return lines.join("\\n");
}

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const commands = [];
  if (!SKIP_RUN) {
    const waterArgs = [
      "--use-system-ca",
      "scripts/verify-terminal-water-root.js",
      `--expected-date=${EXPECTED_DATE}`,
      "--out=outputs/terminal-water-root",
    ];
    if (REQUIRE_FORMAL_NOW) waterArgs.push("--require-formal-now");
    commands.push(runNode(waterArgs, "terminal-water-root"));
    const waterAfterRoot = readJson(path.join(ROOT, "outputs", "terminal-water-root", "terminal-water-root.json"), {});
    EXPECTED_DATE = resolveExpectedDateFromWater(waterAfterRoot, EXPECTED_DATE);
    commands.push(runNode([
      "--use-system-ca",
      "scripts/verify-terminal-resource-chain.js",
      "--require-unattended",
      `--expected-date=${EXPECTED_DATE}`,
      "--out=outputs/terminal-resource-chain-audit",
    ], "terminal-resource-chain:unattended"));
  }

  const water = readJson(path.join(ROOT, "outputs", "terminal-water-root", "terminal-water-root.json"), {});
  EXPECTED_DATE = resolveExpectedDateFromWater(water, EXPECTED_DATE);
  const chain = readJson(path.join(ROOT, "outputs", "terminal-resource-chain-audit", "terminal-resource-chain-audit.json"), {});
  const modules = Array.isArray(chain.results)
    ? chain.results.filter((row) => row.key !== "market").map(moduleRow)
    : [];
const pendingModules = modules.filter((item) => item.pendingNotDue === true);
  const pendingNotDueHold = modules.length > 0
    && pendingModules.length === modules.length
    && modules.every((row) => row.ok === true)
    && isPreviousGoodHoldWaterRoot(water);
  const issues = [];
  if (!water.ok) issues.push(`water_root:${water.reason || "not_ready"}`);
  if (!chain.ok && !pendingNotDueHold) issues.push("terminal_resource_chain_unattended_failed");
  for (const command of commands.filter((item) => !item.ok)) {
    const toleratedPendingChain = pendingNotDueHold && command.label === "terminal-resource-chain:unattended";
    if (!toleratedPendingChain) issues.push(`${command.label}_exit_${command.exitCode}`);
  }
  for (const row of modules.filter((item) => !item.ok)) issues.push(`${row.key}:${row.issues[0] || "not_ok"}`);
  const previousGoodHold = issues.length === 0 && pendingModules.length === 0 && isPreviousGoodHoldWaterRoot(water);
  const manifest = {
    contract: "daily-terminal-run-manifest-v1",
    checkedAt: new Date().toISOString(),
    requestedDate: REQUESTED_DATE,
    tradeDate: EXPECTED_DATE,
    waterRoot: {
      ok: water.ok === true,
      status: water.status || "",
      reason: water.reason || "",
      sourceStatus: water.sourceStatus?.summary || null,
      canonicalGate: water.canonicalGate?.summary || null,
      previousGoodHold,
    },
    commands,
    modules,
    pendingModules: pendingModules.map((row) => ({ key: row.key, dueTime: row.scheduleStatus?.dueTime || "", runId: row.runId || "" })),
    ok: issues.length === 0 && pendingModules.length === 0,
    previousGoodHold,
    freshUnattended: issues.length === 0 && pendingModules.length === 0 && !previousGoodHold,
    unattendedStatus: issues.length === 0 && pendingModules.length === 0 ? (previousGoodHold ? "PREVIOUS_GOOD_HOLD" : "YES") : "NO",
    blocker: issues[0] || (pendingModules.length ? `pending_not_due:${pendingModules.map((row) => `${row.key}@${row.scheduleStatus?.dueTime || ""}`).join(",")}` : ""),
    issues,
  };
  const dateFile = path.join(OUT_DIR, `daily-terminal-run-${EXPECTED_DATE}.json`);
  const latestFile = path.join(OUT_DIR, "daily-terminal-run-latest.json");
  const mdFile = path.join(OUT_DIR, `daily-terminal-run-${EXPECTED_DATE}.md`);
  await fs.promises.writeFile(dateFile, JSON.stringify(manifest, null, 2));
  await fs.promises.writeFile(latestFile, JSON.stringify(manifest, null, 2));
  await fs.promises.writeFile(mdFile, markdown(manifest));
  console.log(JSON.stringify({
    ok: manifest.ok,
    unattendedStatus: manifest.unattendedStatus,
    tradeDate: manifest.tradeDate,
    blocker: manifest.blocker,
    modules: manifest.modules.map((row) => ({ key: row.key, ok: row.ok, runId: row.runId, issue: row.issues[0] || "" })),
    output: latestFile,
  }, null, 2));
  if (issues.length > 0 && !pendingNotDueHold) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[daily-terminal-run-manifest] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
