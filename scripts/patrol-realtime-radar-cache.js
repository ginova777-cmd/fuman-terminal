const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { isTwseTradingDay } = require("./twse-trading-day");

const SCAN_SCRIPT = path.join(__dirname, "scan-realtime-radar-cache.js");
const INTERVAL_MS = Number(process.env.REALTIME_RADAR_PATROL_INTERVAL_MS || 3000);
const MARKET_START_MINUTES = 9 * 60;
const MARKET_END_MINUTES = 13 * 60 + 30;
const STATE_DIR = process.env.FUMAN_STATE_DIR || path.resolve(__dirname, "..", "state");
const LOCK_FILE = process.env.REALTIME_RADAR_PATROL_LOCK_FILE || path.join(STATE_DIR, "realtime-radar-patrol.lock");
const LOCK_MAX_AGE_MS = Number(process.env.REALTIME_RADAR_PATROL_LOCK_MAX_AGE_MS || 8 * 60 * 60 * 1000);
const LOCK_HEARTBEAT_MAX_AGE_MS = Number(process.env.REALTIME_RADAR_PATROL_HEARTBEAT_MAX_AGE_MS || 2 * 60 * 1000);

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readLockFile() {
  try {
    return JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
  } catch {
    return null;
  }
}

function removeLockFile() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
}

function acquirePatrolLock() {
  fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const payload = {
    pid: process.pid,
    token,
    startedAt: new Date().toISOString(),
    script: path.basename(__filename),
    heartbeatAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(LOCK_FILE, "wx");
      fs.writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`);
      fs.closeSync(fd);
      console.log(`realtime radar patrol lock acquired: ${LOCK_FILE}`);
      return payload;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const current = readLockFile();
      const currentPid = Number(current?.pid || 0);
      const startedAt = Date.parse(current?.startedAt || "");
      const heartbeatAt = Date.parse(current?.heartbeatAt || current?.startedAt || "");
      const tooOld = Number.isFinite(startedAt) && Date.now() - startedAt > LOCK_MAX_AGE_MS;
      const heartbeatStale = !Number.isFinite(heartbeatAt) || Date.now() - heartbeatAt > LOCK_HEARTBEAT_MAX_AGE_MS;
      if (isPidAlive(currentPid) && !tooOld && !heartbeatStale) {
        console.log(`realtime radar patrol already running pid ${currentPid}; exiting`);
        return null;
      }
      console.log(`realtime radar patrol removing stale lock for pid ${currentPid || "unknown"}`);
      removeLockFile();
    }
  }
  throw new Error(`unable to acquire realtime radar patrol lock: ${LOCK_FILE}`);
}

function releasePatrolLock(lock) {
  if (!lock?.token) return;
  const current = readLockFile();
  if (current?.token === lock.token) {
    removeLockFile();
    console.log("realtime radar patrol lock released");
  }
}

function touchPatrolLock(lock) {
  if (!lock?.token) return;
  const current = readLockFile();
  if (current?.token !== lock.token) return;
  fs.writeFileSync(LOCK_FILE, `${JSON.stringify({ ...current, heartbeatAt: new Date().toISOString() }, null, 2)}\n`);
}


function taipeiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function taipeiMinuteOfDay(parts = taipeiParts()) {
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function isMarketTime(parts = taipeiParts()) {
  const minutes = taipeiMinuteOfDay(parts);
  return minutes >= MARKET_START_MINUTES && minutes <= MARKET_END_MINUTES;
}

function isBeforeMarket(parts = taipeiParts()) {
  return taipeiMinuteOfDay(parts) < MARKET_START_MINUTES;
}

function msUntilMarketOpen(parts = taipeiParts()) {
  const minutes = taipeiMinuteOfDay(parts);
  return Math.max(0, (MARKET_START_MINUTES - minutes) * 60 * 1000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runScan() {
  const result = spawnSync(process.execPath, [SCAN_SCRIPT], {
    cwd: path.resolve(__dirname, ".."),
    env: process.env,
    stdio: "inherit",
  });
  return result.status === 0;
}

async function main() {
  let successCount = 0;
  let failureCount = 0;

  const tradingDay = await isTwseTradingDay(new Date(), { stateDir: STATE_DIR });
  if (!tradingDay.isTradingDay) {
    console.log(`realtime radar patrol skipped non-trading day ${tradingDay.date} (${tradingDay.reason}, source=${tradingDay.source})`);
    return;
  }

  if (isBeforeMarket()) {
    console.log("realtime radar patrol waiting for 09:00 market open");
    await sleep(msUntilMarketOpen() + 1000);
  }

  if (!isMarketTime()) {
    touchPatrolLock(patrolLock);
    if (runScan()) successCount += 1;
    else failureCount += 1;
    touchPatrolLock(patrolLock);
    console.log(`realtime radar patrol single run: success ${successCount}, failure ${failureCount}`);
    if (!successCount) process.exit(1);
    return;
  }

  while (isMarketTime()) {
    touchPatrolLock(patrolLock);
    if (runScan()) successCount += 1;
    else failureCount += 1;
    touchPatrolLock(patrolLock);
    await sleep(INTERVAL_MS);
  }

  console.log(`realtime radar patrol finished: success ${successCount}, failure ${failureCount}`);
  if (!successCount) process.exit(1);
}

const patrolLock = acquirePatrolLock();
if (!patrolLock) process.exit(0);

process.on("exit", () => releasePatrolLock(patrolLock));
["SIGINT", "SIGTERM"].forEach((signal) => {
  process.on(signal, () => {
    releasePatrolLock(patrolLock);
    process.exit(0);
  });
});


main().catch((error) => {
  console.error(error);
  process.exit(1);
});



