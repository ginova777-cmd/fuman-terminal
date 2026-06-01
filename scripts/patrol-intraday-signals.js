const { spawn, spawnSync } = require("child_process");
const path = require("path");

const SCAN_SCRIPT = path.join(__dirname, "scan-intraday-signals.js");
const INTERVAL_MS = Number(process.env.INTRADAY_PATROL_INTERVAL_MS || 3000);
const PUBLISH_INTERVAL_MS = Math.max(0, Number(process.env.STRATEGY2_PUBLISH_INTERVAL_MS || 60 * 1000));
const MARKET_START_MINUTES = 9 * 60;
const MARKET_END_MINUTES = 13 * 60 + 30;
const PUBLISH_SCRIPT = path.resolve(__dirname, "..", "run-cache-sync.ps1");
const POWERSHELL_EXE = process.env.FUMAN_POWERSHELL_EXE || "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
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

function runScan() {
  const result = spawnSync(process.execPath, [SCAN_SCRIPT], {
    cwd: path.resolve(__dirname, ".."),
    env: process.env,
    stdio: "inherit",
  });
  return result.status === 0;
}

function publishStrategy2Cache(force = false) {
  if (!PUBLISH_INTERVAL_MS) return;
  const now = Date.now();
  if (!force && now - lastPublishAt < PUBLISH_INTERVAL_MS) return;
  if (publishRunning) return;
  lastPublishAt = now;
  publishRunning = true;
  const child = spawn(POWERSHELL_EXE, [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    PUBLISH_SCRIPT,
    "-Scope",
    "strategy2",
  ], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      CACHE_SYNC_WRITE_CODE_REPO: "1",
      SYNC_STRATEGY2_FULL_LATEST: "1",
    },
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
  let successCount = 0;
  let failureCount = 0;

  if (isBeforeMarket()) {
    console.log("intraday patrol waiting for 09:00 market open");
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
