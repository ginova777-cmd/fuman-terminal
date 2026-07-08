const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { ROOT, dataPath, statePath } = require("./runtime-paths");
const STRATEGY2_REPORT_FILE = dataPath("strategy2-intraday-latest.json");
const INTERVAL_MS = Math.max(1000, Number(process.env.STRATEGY2_LIVE_INTERVAL_MS || 1000));
const NOTIFIER = path.join(__dirname, "send-strategy2-live-alert.js");
const MAX_LOOPS = Number(process.env.STRATEGY2_LIVE_MAX_LOOPS || 0);
const LIVE_LOCK_FILE = statePath("strategy2-live-alert-patrol.lock");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock(lockFile, label) {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const lock = readJson(lockFile, {});
  if (isProcessAlive(Number(lock.pid))) {
    console.log(`${label} already running pid=${lock.pid}; skip duplicate`);
    return null;
  }
  try {
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), label }, null, 2), { flag: "wx" });
  } catch {
    const retryLock = readJson(lockFile, {});
    if (isProcessAlive(Number(retryLock.pid))) {
      console.log(`${label} already running pid=${retryLock.pid}; skip duplicate`);
      return null;
    }
    writeJson(lockFile, { pid: process.pid, createdAt: new Date().toISOString(), label });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = readJson(lockFile, {});
    if (Number(current.pid) === process.pid) {
      try { fs.unlinkSync(lockFile); } catch {}
    }
  };
}

function taipeiTimeText(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return byType.hour + ":" + byType.minute + ":" + byType.second;
}

function secondsOfDay(text) {
  const match = String(text || "").match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}

function shouldStopByConfiguredTime() {
  const stopAt = secondsOfDay(process.env.STRATEGY2_LIVE_STOP_AT);
  if (stopAt === null) return false;
  const now = secondsOfDay(taipeiTimeText());
  return now !== null && now >= stopAt;
}

function intradayTimeText(value) {
  const match = String(value || "").match(/(\d{2}:\d{2}(?::\d{2})?)/);
  return match ? match[1] : "";
}

function entryRecordSignature(record) {
  const stateId = String(record?.stateId || "");
  if (stateId !== "entry" && stateId !== "go") return "";
  const at = intradayTimeText(record.timestamp || record.entryAt || record.firstAAt);
  if (!at) return "";
  return `${record.code || ""}:${at}:${record.entryPrice || record.observedPrice || record.close || ""}:${record.percent || ""}:${record.tradeVolume || record.volume || ""}`;
}

function latestSignature() {
  const payload = readJson(STRATEGY2_REPORT_FILE, { date: "", events: [] });
  const limit = Math.max(1, Number(process.env.STRATEGY2_LIVE_LIMIT || 3));
  const eventRows = (payload.events || [])
    .filter((event) => event.firstAAt)
    .sort((a, b) => String(a.firstAAt).localeCompare(String(b.firstAAt)))
    .slice(-limit)
    .map((event) => {
      const latestEnhancement = (event.enhancements || []).at(-1);
      const enhancementPart = latestEnhancement
        ? `${latestEnhancement.at}:${latestEnhancement.strategy}:${latestEnhancement.deltaVolume}`
        : "";
      return `${event.code}:${event.firstAAt}:${event.firstAPrice}:${enhancementPart}`;
    });
  const recordRows = (payload.records || [])
    .map(entryRecordSignature)
    .filter(Boolean)
    .slice(-limit);
  const rows = [...eventRows, ...recordRows];
  return `${payload.date || ""}:${payload.updatedAt || ""}:${rows.join("|")}`;
}

function notifyOnce() {
  const result = spawnSync(process.execPath, [NOTIFIER], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

let lastSignature = "";

async function loop() {
  const releaseLock = acquireLock(LIVE_LOCK_FILE, "strategy2 live alert patrol");
  if (!releaseLock) return;
  const releaseAndExit = () => {
    releaseLock();
    process.exit(0);
  };
  process.once("SIGINT", releaseAndExit);
  process.once("SIGTERM", releaseAndExit);
  if (!process.env.STRATEGY2_LIVE_STARTED_AT) {
    process.env.STRATEGY2_LIVE_STARTED_AT = taipeiTimeText();
  }
  console.log(`strategy2 live LINE patrol start: every ${INTERVAL_MS}ms`);
  console.log(`strategy2 live LINE cutoff: ${process.env.STRATEGY2_LIVE_STARTED_AT}`);
  let loopCount = 0;
  while (true) {
    loopCount += 1;
    if (shouldStopByConfiguredTime()) {
      console.log("strategy2 live LINE patrol stop: reached " + process.env.STRATEGY2_LIVE_STOP_AT);
      break;
    }
    try {
      const signature = latestSignature();
      if (signature && signature !== lastSignature) {
        lastSignature = signature;
        notifyOnce();
      }
    } catch (error) {
      console.error(`strategy2 live patrol error: ${error.message}`);
    }
    if (MAX_LOOPS > 0 && loopCount >= MAX_LOOPS) {
      console.log(`strategy2 live LINE patrol stop: max loops ${MAX_LOOPS}`);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
  releaseLock();
}

loop();


