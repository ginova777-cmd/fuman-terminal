const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const MANAGER = path.join(__dirname, "trade-manager.js");
const INTERVAL_MS = Math.max(3000, Number(process.env.TRADE_MANAGER_INTERVAL_MS || 10000));

function taipeiMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(byType.hour) * 60 + Number(byType.minute);
}

function inTradingWindow() {
  const minutes = taipeiMinutes();
  return minutes >= 9 * 60 && minutes <= 13 * 60 + 35;
}

function runOnce() {
  const result = spawnSync(process.execPath, [MANAGER], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

async function loop() {
  console.log(`trade manager patrol start: every ${INTERVAL_MS}ms`);
  while (true) {
    if (inTradingWindow()) runOnce();
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

loop().catch((error) => {
  console.error(error);
  process.exit(1);
});
