const { spawnSync } = require("child_process");
const path = require("path");

const SCAN_SCRIPT = path.join(__dirname, "scan-intraday-signals.js");
const INTERVAL_MS = Number(process.env.INTRADAY_PATROL_INTERVAL_MS || 3000);

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
  return minutes >= 9 * 60 && minutes <= 13 * 60 + 30;
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
    await sleep(INTERVAL_MS);
  }

  console.log(`intraday 3s patrol finished: success ${successCount}, failure ${failureCount}`);
  if (!successCount) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
