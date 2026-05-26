const path = require("path");
const { spawnSync } = require("child_process");

const { ROOT } = require("./runtime-paths");
const MANAGER = path.join(__dirname, "trade-manager.js");
const INTERVAL_MS = Math.max(1000, Number(process.env.TRADE_MANAGER_INTERVAL_MS || 10000));
const MAX_LOOPS = Number(process.env.TRADE_MANAGER_MAX_LOOPS || 0);
const FORCE_RUN = process.env.TRADE_MANAGER_FORCE_RUN === "1";
const CHILD_TIMEOUT_MS = Math.max(5000, Number(process.env.TRADE_MANAGER_CHILD_TIMEOUT_MS || 45000));

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
    timeout: CHILD_TIMEOUT_MS,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) console.error(`trade manager child error: ${result.error.message}`);
  if (typeof result.status === "number" && result.status !== 0) console.error(`trade manager child exited: ${result.status}`);
}

async function loop() {
  console.log(`trade manager patrol start: every ${INTERVAL_MS}ms`);
  let loopCount = 0;
  while (true) {
    loopCount += 1;
    if (FORCE_RUN || inTradingWindow()) runOnce();
    if (MAX_LOOPS > 0 && loopCount >= MAX_LOOPS) {
      console.log(`trade manager patrol stop: max loops ${MAX_LOOPS}`);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

loop().catch((error) => {
  console.error(error);
  process.exit(1);
});





