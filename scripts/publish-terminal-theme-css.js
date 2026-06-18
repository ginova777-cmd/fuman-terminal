const fs = require("fs");
const path = require("path");
const { upsertSnapshot } = require("../lib/supabase-snapshots");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || process.env.FUMAN_RUNTIME_ROOT || "C:\\fuman-runtime";
const DEPLOY_ROOT = process.env.FUMAN_DEPLOY_ROOT || "C:\\fuman-terminal";
const SOURCE_FILE = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, "data", "terminal-theme-css.css");
const SNAPSHOT_KEY = "terminal_theme_css";
const MAX_CSS_BYTES = 160 * 1024;

function taipeiClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  const hour = Number(parts.hour || 0);
  const minute = Number(parts.minute || 0);
  return {
    tradeDate: `${parts.year}${parts.month}${parts.day}`,
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    locked: hour * 60 + minute >= 13 * 60 + 30,
  };
}

function writeFileAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temp, text, "utf8");
  fs.renameSync(temp, file);
}

async function main() {
  const css = fs.readFileSync(SOURCE_FILE, "utf8");
  const bytes = Buffer.byteLength(css, "utf8");
  if (!css.trim()) throw new Error("terminal theme CSS is empty");
  if (bytes > MAX_CSS_BYTES) throw new Error(`terminal theme CSS too large: ${bytes}`);

  const clock = taipeiClock();
  const updatedAt = new Date().toISOString();
  const payload = {
    ok: true,
    source: "terminal-theme-css",
    css,
    bytes,
    updatedAt,
    tradeDate: clock.tradeDate,
    taipeiDate: clock.isoDate,
    taipeiTime: clock.time,
    cacheSource: "local-publish",
  };

  for (const root of [ROOT, RUNTIME_DIR, DEPLOY_ROOT]) {
    writeFileAtomic(path.join(root, "data", "terminal-theme-css.css"), css);
  }

  const result = await upsertSnapshot(SNAPSHOT_KEY, payload, {
    tradeDate: clock.tradeDate,
    locked: clock.locked,
    reason: clock.locked ? "after-1330-cache" : "snapshot-cache",
    source: "terminal-theme-css",
    snapshotId: `terminal-theme-css-${clock.tradeDate}-${updatedAt.replace(/\D/g, "").slice(8, 14)}`,
  });
  if (!result.ok) throw new Error(`terminal theme CSS snapshot upsert failed: ${result.error || "unknown_error"}`);
  console.log(`[terminal-theme-css] ok bytes=${bytes} snapshot=${SNAPSHOT_KEY} locked=${clock.locked}`);
}

main().catch((error) => {
  console.error(`[terminal-theme-css] ${error.message || error}`);
  process.exit(1);
});
