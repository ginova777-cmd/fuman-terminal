const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/daily-terminal-run");
let EXPECTED_DATE = (process.argv.find((arg) => arg.startsWith("--expected-date="))?.slice("--expected-date=".length) || taipeiDateKey()).replace(/\D/g, "").slice(0, 8);
const REQUESTED_DATE = EXPECTED_DATE;
const SKIP_RUN = process.argv.includes("--from-existing");
const REQUIRE_FORMAL_NOW = process.argv.includes("--require-formal-now");

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

function moduleRow(row = {}) {
  let receipt = row.receipt || {};
  const supabase = row.supabase || {};
  const supabaseDate = firstPresent(runDateFromId(supabase.runId), compactDate(supabase.tradeDate || supabase.date || supabase.updatedAt));
  const supabaseCompleteRun = supabase.ok === true
    && supabase.runId
    && supabaseDate === EXPECTED_DATE
    && ["ok", "complete", "ready"].includes(String(supabase.qualityStatus || supabase.status || "").toLowerCase())
    && Number(firstPresent(supabase.scannedCount, supabase.expectedTotal, 0)) > 0;
  if (supabaseCompleteRun && runDateFromId(receipt.runId) !== EXPECTED_DATE) {
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
  if (uniqueRunIds.length > 1) issues.push(`manifest_runId_mismatch:${uniqueRunIds.join(",")}`);
  if (!runId) issues.push("manifest_missing_runId");
  if (tradeDate !== EXPECTED_DATE) issues.push(`manifest_tradeDate_mismatch:${tradeDate || "missing"}!=${EXPECTED_DATE}`);
  if (sourceDate !== EXPECTED_DATE) issues.push(`manifest_sourceDate_mismatch:${sourceDate || "missing"}!=${EXPECTED_DATE}`);
  if (fallback) issues.push("manifest_fallback_true");
  if (receipt.status !== "complete" || receipt.complete !== true) issues.push(`manifest_scanner_not_complete:${receipt.status || "missing"}`);
  if (scorecard.membershipProtected) issues.push("manifest_scorecard_unauthenticated_readback_only");
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
    ok: issues.length === 0 && complete,
    issues,
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
    lines.push(`| ${row.label || row.key} | ${row.runId || "--"} | ${row.tradeDate || "--"} | ${row.sourceDate || "--"} | ${row.complete} | ${row.fallback} | ${row.resultCount} | api=${row.runIds.productionApi || "--"}<br>desktop=${row.runIds.desktop || "--"}<br>mobile=${row.runIds.mobile || "--"}<br>88=${row.runIds.scorecard88 || "--"} | ${row.issues.join("<br>") || "OK"} |`);
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
    const displayTradeDate = compactDate(waterAfterRoot.marketCalendar?.row?.displayTradeDate || waterAfterRoot.displayTradeDate || "");
    if (displayTradeDate && !REQUIRE_FORMAL_NOW) EXPECTED_DATE = displayTradeDate;
    commands.push(runNode([
      "--use-system-ca",
      "scripts/verify-terminal-resource-chain.js",
      "--require-unattended",
      `--expected-date=${EXPECTED_DATE}`,
      "--out=outputs/terminal-resource-chain-audit",
    ], "terminal-resource-chain:unattended"));
  }

  const water = readJson(path.join(ROOT, "outputs", "terminal-water-root", "terminal-water-root.json"), {});
  const displayTradeDate = compactDate(water.marketCalendar?.row?.displayTradeDate || water.displayTradeDate || "");
  if (displayTradeDate && !REQUIRE_FORMAL_NOW) EXPECTED_DATE = displayTradeDate;
  const chain = readJson(path.join(ROOT, "outputs", "terminal-resource-chain-audit", "terminal-resource-chain-audit.json"), {});
  const modules = Array.isArray(chain.results)
    ? chain.results.filter((row) => row.key !== "market").map(moduleRow)
    : [];
  const issues = [];
  if (!water.ok) issues.push(`water_root:${water.reason || "not_ready"}`);
  if (!chain.ok) issues.push("terminal_resource_chain_unattended_failed");
  for (const command of commands.filter((item) => !item.ok)) issues.push(`${command.label}_exit_${command.exitCode}`);
  for (const row of modules.filter((item) => !item.ok)) issues.push(`${row.key}:${row.issues[0] || "not_ok"}`);
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
    },
    commands,
    modules,
    ok: issues.length === 0,
    unattendedStatus: issues.length === 0 ? "YES" : "NO",
    blocker: issues[0] || "",
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
  if (!manifest.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[daily-terminal-run-manifest] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});







