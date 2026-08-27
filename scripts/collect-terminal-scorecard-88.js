"use strict";

const fs = require("fs");
const path = require("path");

const runtimeRoot = process.env.FUMAN_RUNTIME_ROOT || "C:\\fuman-runtime";
const dataDir = path.join(runtimeRoot, "data");
const receiptDir = path.join(dataDir, "scan-receipts");
const outputFile = process.env.FUMAN_SCORECARD_TERMINAL_SOURCE || path.join(dataDir, "scorecard-terminal-current.json");
const blobTokenFile = process.env.FUMAN_SCORECARD88_BLOB_TOKEN_FILE || path.join(runtimeRoot, "secrets", "vercel-blob-read-write-token.txt");
const blobCurrentPath = "scorecard88/current.json";
const slot = String(process.argv.find((arg) => arg.startsWith("--slot=")) || "").split("=")[1] || "";
const slots = {
  "12:40": ["strategy2"],
  "13:15": ["strategy3"],
  "17:00": ["strategy4"],
  "21:40": ["strategy5", "institution", "battle"],
};
const collectionDelayMinutes = Math.max(0, Math.min(5, Number(process.env.FUMAN_SCORECARD88_COLLECTION_DELAY_MINUTES || 5)));
function taipeiMinuteOfDay(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}
function slotMinuteOfDay(value) {
  const [hour, minute] = String(value || "").split(":").map(Number);
  return hour * 60 + minute;
}
function fixedCollectionWindow(value, now = new Date()) {
  const scheduledMinute = slotMinuteOfDay(value);
  const currentMinute = taipeiMinuteOfDay(now);
  return { scheduledMinute, currentMinute, delayMinutes: currentMinute - scheduledMinute, allowed: currentMinute >= scheduledMinute && currentMinute <= scheduledMinute + collectionDelayMinutes };
}


function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
function writeJsonAtomic(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
}
function blobToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return String(process.env.BLOB_READ_WRITE_TOKEN).trim();
  try { return fs.readFileSync(blobTokenFile, "utf8").trim(); } catch { return ""; }
}
async function publishBlob(payload, todayKey, slotKey) {
  const token = blobToken();
  if (!token) throw new Error("scorecard88_blob_token_missing");
  const { put } = await import("@vercel/blob");
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  const options = { access: "private", token, addRandomSuffix: false, allowOverwrite: true, contentType: "application/json; charset=utf-8", cacheControlMaxAge: 60 };
  const immutablePath = `scorecard88/${todayKey}/${slotKey}.json`;
  const immutable = await put(immutablePath, body, options);
  const current = await put(blobCurrentPath, body, options);
  return { immutablePath, currentPath: blobCurrentPath, immutableUrl: immutable.url, currentUrl: current.url };
}
function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function compactDate(value) { return String(value || "").replace(/\D/g, "").slice(0, 8); }
function runDate(runId) { return (String(runId || "").match(/20\d{6}/) || [""])[0]; }
function num(...values) {
  for (const value of values) if (Number.isFinite(Number(value))) return Number(value);
  return 0;
}
function canonicalReceipt(key) {
  const todayKey = compactDate(taipeiDate());
  const files = {
    strategy2: ["strategy2-v3-live.json"],
    strategy3: [`strategy3-v2-daily-unattended-closure-${todayKey}.json`, `strategy3-v2-complete-scan-${todayKey}.json`],
    strategy4: ["strategy4-canonical-closure-latest.json"],
    strategy5: ["strategy5.json"],
    institution: ["institution.json"],
  }[key] || [];
  for (const name of files) {
    const value = readJson(path.join(receiptDir, name));
    if (value) return { name, value };
  }
  return null;
}
function canonicalFromDesktop(key, desktop) {
  const endpointByKey = {
    strategy2: "/api/strategy2-latest?canvas=1&compact=1&shell=1&limit=80&live=1&today=1",
    strategy3: "/api/strategy3-latest?canvas=1&compact=1&shell=1&limit=60&live=1",
    strategy4: "/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=70&live=1",
    strategy5: "/api/strategy5-latest?canvas=1&compact=1&shell=1&limit=140&live=1",
    institution: "/api/institution-latest?canvas=1&compact=1&shell=1&limit=60&live=1",
  };
  const summary = desktop?.summary?.[endpointByKey[key]] || null;
  if (!summary) return null;
  const receipt = canonicalReceipt(key);
  const detail = receipt?.value || {};
  const scan = detail.scan || detail.scanner_summary || detail.scannerSummary || {};
  const receiptRunId = detail.runId || detail.run_id || scan.runId || scan.run_id || "";
  const runId = String(summary.runId || receiptRunId || "");
  const receiptComplete = detail.ok === true || detail.complete === true || detail.status === "complete" || detail.status === "PASS" || detail.status === "STRATEGY3_V2_DAILY_UNATTENDED_YES";
  const fullScannedCount = num(detail.scannedCount, detail.scanned_count, detail.scanned, scan.scannedCount, scan.scanned_count, summary.scannedCount, summary.count);
  const fullResultCount = num(detail.resultCount, detail.result_count, detail.matches, detail.count, scan.resultCount, scan.result_count, scan.count, summary.resultCount, summary.count);
  return {
    key, strategy: key, runId, tradeDate: taipeiDate(), date: taipeiDate(),
    scannedCount: fullScannedCount, resultCount: fullResultCount, count: fullResultCount,
    source: `terminal-desktop-route-snapshot+canonical-receipt:${receipt?.name || "missing"}`,
    sourceUpdatedAt: summary.updatedAt || desktop.updatedAt || "", terminalEndpoint: endpointByKey[key],
    canonicalComplete: summary.ok === true && Boolean(runId) && receiptComplete && (!receiptRunId || receiptRunId === runId),
  };
}function canonicalBattle() {
  const candidates = [
    "institution-battle-verify.json",
    "institution-battle-verify-alert.json",
    "daily-battle-readiness-verify.json",
  ];
  for (const name of candidates) {
    const value = readJson(path.join(receiptDir, name));
    if (!value) continue;
    return {
      key: "battle", strategy: "battle", runId: String(value.runId || value.run_id || ""),
      tradeDate: value.tradeDate || value.trade_date || value.marketDate || "",
      date: value.tradeDate || value.trade_date || value.marketDate || "",
      scannedCount: num(value.scannedCount, value.scanned, value.count),
      resultCount: num(value.resultCount, value.matches, value.count),
      count: num(value.resultCount, value.matches, value.count), source: `terminal-receipt:${name}`,
      sourceUpdatedAt: value.updatedAt || value.checkedAt || value.checked_at || "",
      firstBlocker: value.firstBlocker || value.blockingReason || value.blocking_reason || value.reason || "",
      blockingReason: value.blockingReason || value.blocking_reason || value.firstBlocker || value.reason || "",
      strategy5RunId: value.strategy5RunId || value.runId || "", institutionRunId: value.institutionRunId || "", generatedRunId: false,
      canonicalComplete: value.ok === true || value.status === "complete" || value.status === "PASS",
    };
  }
  return null;
}

if (!slots[slot]) {
  console.error(JSON.stringify({ ok: false, status: "FAIL_CLOSED", reason: "invalid_collection_slot", allowedSlots: Object.keys(slots) }));
  process.exit(2);
}
const collectionWindow = fixedCollectionWindow(slot);
if (!collectionWindow.allowed) {
  console.error(JSON.stringify({ ok: false, status: "FAIL_CLOSED", reason: "outside_fixed_collection_window", slot, writeAllowed: false, blobPublishAllowed: false, collectionWindow }));
  process.exit(6);
}

const today = taipeiDate();
const todayKey = compactDate(today);
const desktopFile = path.join(receiptDir, "desktop-route-snapshot.json");
const desktop = readJson(desktopFile);
const previous = readJson(outputFile) || { records: [], sourceReports: [] };
const collectedAt = new Date().toISOString();
const reportsByKey = new Map((Array.isArray(previous.sourceReports) ? previous.sourceReports : []).map((row) => [String(row.key || row.strategy || "").toLowerCase(), row]));
const receipts = [];

for (const key of slots[slot]) {
  const canonical = key === "battle" ? canonicalBattle() : canonicalFromDesktop(key, desktop);
  const canonicalRunDate = canonical ? runDate(canonical.runId) : "";
  const sameDate = canonical && (canonicalRunDate ? canonicalRunDate === todayKey : compactDate(canonical.tradeDate) === todayKey);
  const complete = Boolean(canonical?.canonicalComplete && canonical.runId && sameDate);
  const blockingReason = complete ? "" : (canonical?.firstBlocker || canonical?.blockingReason || (!canonical ? "terminal_canonical_missing" : !canonical.runId ? "terminal_run_id_missing" : !sameDate ? "terminal_trade_date_not_today" : "terminal_canonical_not_complete"));
  const row = complete ? {
    ...canonical,
    ok: true,
    complete: true,
    status: "PASS",
    collectionSlot: slot,
    collectedAt,
    collectionContract: "scorecard88-terminal-canonical-collector-v1",
    querySupabase: false,
    recalculated: false,
    generatedRunId: false,
  } : {
    key, strategy: key, ok: false, complete: false, status: "今日尚未閉環",
    tradeDate: today, date: today, runId: "", terminalSourceRunId: canonical?.runId || "", count: 0, resultCount: 0,
    blocking_reason: blockingReason, firstBlocker: blockingReason, collectionSlot: slot, collectedAt,
    source: canonical?.source || "terminal-canonical-missing",
    collectionContract: "scorecard88-terminal-canonical-collector-v1",
    querySupabase: false, recalculated: false, generatedRunId: false,
  };
  reportsByKey.set(key, row);
  receipts.push(row);
}

const payload = {
  ...previous,
  ok: receipts.every((row) => row.ok),
  source: "terminal-canonical-fixed-slot-collector",
  cacheSource: "terminal-canonical-json",
  contract: "scorecard88-terminal-canonical-collector-v1",
  latestDate: today,
  marketDate: today,
  updatedAt: collectedAt,
  sourceReports: [...reportsByKey.values()],
  collectionPolicy: {
    fixedSlots: Object.keys(slots),
    currentSlot: slot,
    supabaseQueryAllowed: false,
    scanAllowed: false,
    recalculateAllowed: false,
    generateRunIdAllowed: false,
  },
};
async function main() {
  writeJsonAtomic(outputFile, payload);
  let blob = null;
  let blobError = "";
  try { blob = await publishBlob(payload, todayKey, slot.replace(":", "")); } catch (error) { blobError = error?.message || String(error); }
  const ok = payload.ok && Boolean(blob) && !blobError;
  const receipt = { ok, status: ok ? "PASS" : payload.ok ? "FAIL_CLOSED" : "BLOCKED", slot, tradeDate: today, collectedAt, collectionWindow, outputFile, blobPublished: Boolean(blob), blob, firstBlocker: payload.ok ? blobError : receipts.find((row) => !row.ok)?.firstBlocker || "terminal_canonical_not_complete", reports: receipts };
  writeJsonAtomic(path.join(receiptDir, `scorecard88-collection-${todayKey}-${slot.replace(":", "")}.json`), receipt);
  console.log(JSON.stringify(receipt, null, 2));
  process.exitCode = ok ? 0 : payload.ok ? 4 : 3;
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, status: "FAIL_CLOSED", reason: error?.message || String(error) })); process.exitCode = 5; });
