const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const STRATEGY2_REPORT_FILE = path.join(ROOT, "data", "strategy2-intraday-latest.json");
const INTERVAL_MS = Math.max(1000, Number(process.env.STRATEGY2_LIVE_INTERVAL_MS || 1000));
const NOTIFIER = path.join(__dirname, "send-strategy2-live-alert.js");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function latestSignature() {
  const payload = readJson(STRATEGY2_REPORT_FILE, { date: "", events: [] });
  const limit = Math.max(1, Number(process.env.STRATEGY2_LIVE_LIMIT || 3));
  const rows = (payload.events || [])
    .filter((event) => event.firstAAt)
    .sort((a, b) => String(a.firstAAt).localeCompare(String(b.firstAAt)))
    .slice(-limit)
    .map((event) => `${event.code}:${event.firstAAt}:${event.firstAPrice}`);
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
  console.log(`strategy2 live LINE patrol start: every ${INTERVAL_MS}ms`);
  while (true) {
    try {
      const signature = latestSignature();
      if (signature && signature !== lastSignature) {
        lastSignature = signature;
        notifyOnce();
      }
    } catch (error) {
      console.error(`strategy2 live patrol error: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

loop();
