const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { ROOT, dataPath, statePath } = require("./runtime-paths");
const STRATEGY2_REPORT_FILE = dataPath("strategy2-intraday-latest.json");
const INTERVAL_MS = Math.max(1000, Number(process.env.STRATEGY2_LIVE_INTERVAL_MS || 1000));
const NOTIFIER = path.join(__dirname, "send-strategy2-live-alert.js");
const MAX_LOOPS = Number(process.env.STRATEGY2_LIVE_MAX_LOOPS || 0);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
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
  return `${byType.hour}:${byType.minute}:${byType.second}`;
}

function latestSignature() {
  const payload = readJson(STRATEGY2_REPORT_FILE, { date: "", events: [] });
  const limit = Math.max(1, Number(process.env.STRATEGY2_LIVE_LIMIT || 3));
  const rows = (payload.events || [])
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
  if (!process.env.STRATEGY2_LIVE_STARTED_AT) {
    process.env.STRATEGY2_LIVE_STARTED_AT = taipeiTimeText();
  }
  console.log(`strategy2 live LINE patrol start: every ${INTERVAL_MS}ms`);
  console.log(`strategy2 live LINE cutoff: ${process.env.STRATEGY2_LIVE_STARTED_AT}`);
  let loopCount = 0;
  while (true) {
    loopCount += 1;
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
}

loop();


