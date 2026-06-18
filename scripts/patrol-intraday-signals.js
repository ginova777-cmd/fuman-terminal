const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const SCAN_SCRIPT = path.join(__dirname, "scan-intraday-signals.js");
const INTERVAL_MS = Number(process.env.INTRADAY_PATROL_INTERVAL_MS || 3000);
const PUBLISH_INTERVAL_MS = Math.max(0, Number(process.env.STRATEGY2_PUBLISH_INTERVAL_MS || 60 * 1000));
const MARKET_START_MINUTES = Number(process.env.STRATEGY2_SCAN_START_MINUTES || 8 * 60);
const MARKET_END_MINUTES = 12 * 60;
const PUBLISH_SCRIPT = path.resolve(__dirname, "publish-strategy2-complete-run.js");
const STATE_DIR = process.env.FUMAN_STATE_DIR || path.resolve(__dirname, "..", "state");
const PATROL_LOCK_FILE = path.join(STATE_DIR, "strategy2-intraday-patrol.lock");
const SCAN_LOCK_FILE = path.join(STATE_DIR, "strategy2-intraday-scan.lock");
let lastPublishAt = 0;
let publishRunning = false;

function taipeiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function marketMinutes(parts = taipeiParts()) {
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function isMarketPatrolTime(parts = taipeiParts()) {
  const minutes = marketMinutes(parts);
  return minutes >= MARKET_START_MINUTES && minutes <= MARKET_END_MINUTES;
}

function isBeforeMarket(parts = taipeiParts()) {
  return marketMinutes(parts) < MARKET_START_MINUTES;
}

function msUntilMarketOpen(parts = taipeiParts()) {
  const minutes = marketMinutes(parts);
  const seconds = Number(parts.second || 0);
  return Math.max(0, (MARKET_START_MINUTES - minutes) * 60 * 1000 - seconds * 1000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function processCommandLine(pid) {
  if (!pid) return "";
  if (Number(pid) === process.pid) return process.argv.join(" ");
  try {
    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}").CommandLine`,
    ], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    });
    return String(result.stdout || "").trim();
  } catch {
    return "";
  }
}

function isStrategy2LockOwnerAlive(pid, lock = {}) {
  if (!isProcessAlive(pid)) return false;
  const commandLine = (processCommandLine(pid) || lock.commandLine || lock.argv || "").toLowerCase();
  if (!commandLine) return false;
  return commandLine.includes("patrol-intraday-signals.js")
    || commandLine.includes("scan-intraday-signals.js")
    || commandLine.includes("run-strategy2-intraday.ps1");
}

function readLock(lockFile) {
  try {
    return JSON.parse(fs.readFileSync(lockFile, "utf8"));
  } catch {
    return {};
  }
}

function acquireLock(lockFile, label) {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const now = Date.now();
  if (fs.existsSync(lockFile)) {
    const lock = readLock(lockFile);
    if (isStrategy2LockOwnerAlive(Number(lock.pid), lock)) {
      console.log(`${label} already running pid=${lock.pid}; skip duplicate`);
      return null;
    }
    try {
      fs.unlinkSync(lockFile);
    } catch (error) {
      console.log(`${label} stale lock remove failed: ${error.message}`);
      return null;
    }
  }
  const handle = fs.openSync(lockFile, "wx");
  fs.writeFileSync(handle, JSON.stringify({
    pid: process.pid,
    createdAt: now,
    label,
    commandLine: [process.execPath, ...process.argv.slice(1)].join(" "),
  }, null, 2));
  fs.closeSync(handle);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const lock = readLock(lockFile);
    if (Number(lock.pid) === process.pid) {
      try {
        fs.unlinkSync(lockFile);
      } catch {}
    }
  };
}

function runScan() {
  const releaseScanLock = acquireLock(SCAN_LOCK_FILE, "strategy2 intraday scan");
  if (!releaseScanLock) return true;
  try {
    const result = spawnSync(process.execPath, [SCAN_SCRIPT], {
      cwd: path.resolve(__dirname, ".."),
      env: process.env,
      stdio: "inherit",
    });
    return result.status === 0;
  } finally {
    releaseScanLock();
  }
}

function publishStrategy2Cache(force = false) {
  if (!PUBLISH_INTERVAL_MS) return;
  const now = Date.now();
  if (!force && now - lastPublishAt < PUBLISH_INTERVAL_MS) return;
  if (publishRunning) return;
  lastPublishAt = now;
  publishRunning = true;
  const child = spawn(process.execPath, [PUBLISH_SCRIPT], {
    cwd: path.resolve(__dirname, ".."),
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  child.on("exit", (code) => {
    publishRunning = false;
    if (code) console.log(`strategy2 cache publish exited with code ${code}`);
  });
  child.on("error", (error) => {
    publishRunning = false;
    console.log(`strategy2 cache publish failed: ${error.message}`);
  });
}

async function main() {
  const releasePatrolLock = acquireLock(PATROL_LOCK_FILE, "strategy2 intraday patrol");
  if (!releasePatrolLock) return;
  process.on("exit", releasePatrolLock);
  process.on("SIGINT", () => {
    releasePatrolLock();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    releasePatrolLock();
    process.exit(143);
  });

  let successCount = 0;
  let failureCount = 0;

  if (isBeforeMarket()) {
    console.log("intraday patrol waiting for 08:00 strategy2 1m warmup");
    await sleep(msUntilMarketOpen() + 1000);
  }

  if (!isMarketPatrolTime()) {
    if (runScan()) successCount += 1;
    else failureCount += 1;
    console.log(`intraday patrol single run: success ${successCount}, failure ${failureCount}`);
    if (!successCount) process.exit(1);
    return;
  }

  while (isMarketPatrolTime()) {
    if (runScan()) successCount += 1;
    else failureCount += 1;
    publishStrategy2Cache(false);
    await sleep(INTERVAL_MS);
  }

  publishStrategy2Cache(true);

  console.log(`intraday 3s patrol finished: success ${successCount}, failure ${failureCount}`);
  if (!successCount) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

