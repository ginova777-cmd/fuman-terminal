const { spawnSync } = require("child_process");
const path = require("path");

const SCAN_SCRIPT = path.join(__dirname, "scan-realtime-radar-cache.js");
const INTERVAL_MS = Number(process.env.REALTIME_RADAR_PATROL_INTERVAL_MS || 3000);

function taipeiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function isMarketTime(parts = taipeiParts()) {
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
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

  if (!isMarketTime()) {
    if (runScan()) successCount += 1;
    else failureCount += 1;
    console.log(`realtime radar patrol single run: success ${successCount}, failure ${failureCount}`);
    if (!successCount) process.exit(1);
    return;
  }

  while (isMarketTime()) {
    if (runScan()) successCount += 1;
    else failureCount += 1;
    await sleep(INTERVAL_MS);
  }

  console.log(`realtime radar patrol finished: success ${successCount}, failure ${failureCount}`);
  if (!successCount) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
