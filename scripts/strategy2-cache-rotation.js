const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { dataPath, repoPath, runtimePath } = require("./runtime-paths");

const STRATEGY2_LATEST_NAME = "strategy2-intraday-latest.json";
const STRATEGY2_HISTORY_DIR = dataPath("strategy2-intraday-history");
const STRATEGY2_ARCHIVE_DIR = runtimePath("archive", "strategy2-intraday");
const DEFAULT_SYNC_ROOT = process.env.FUMAN_SYNC_DIR || "C:\\fuman-terminal";
const RAW_HISTORY_KEEP_DAYS = Math.max(0, Number(process.env.STRATEGY2_HISTORY_RAW_KEEP_DAYS || 0));
const ARCHIVE_KEEP_DAYS = Math.max(1, Number(process.env.STRATEGY2_ARCHIVE_KEEP_DAYS || 14));

function dateKeyToTime(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
  if (!match) return 0;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
}

function ymd(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function gzipAndRemove(source, target) {
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  const input = fs.readFileSync(source);
  fs.writeFileSync(temp, zlib.gzipSync(input, { level: 9 }));
  fs.renameSync(temp, target);
  fs.unlinkSync(source);
  return true;
}

function compressOldHistory(currentDateKey, messages) {
  if (!fs.existsSync(STRATEGY2_HISTORY_DIR)) return;
  const currentTime = dateKeyToTime(currentDateKey);
  if (!currentTime) return;
  const rawCutoff = currentTime - RAW_HISTORY_KEEP_DAYS * 24 * 60 * 60 * 1000;
  for (const entry of fs.readdirSync(STRATEGY2_HISTORY_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const dateKey = entry.name.replace(/\.json$/, "");
    const entryTime = dateKeyToTime(dateKey);
    if (!entryTime || entryTime >= rawCutoff || dateKey === currentDateKey) continue;
    const source = path.join(STRATEGY2_HISTORY_DIR, entry.name);
    const target = path.join(STRATEGY2_ARCHIVE_DIR, "history", `${entry.name}.gz`);
    if (gzipAndRemove(source, target)) messages.push(`archived history ${entry.name}`);
  }
}

function archiveStaticLatestCopies(messages) {
  const targets = [
    { label: "repo", file: repoPath("data", STRATEGY2_LATEST_NAME) },
    { label: "sync", file: path.join(DEFAULT_SYNC_ROOT, "data", STRATEGY2_LATEST_NAME) },
  ];
  const runtimeLatest = path.resolve(dataPath(STRATEGY2_LATEST_NAME));
  for (const target of targets) {
    const file = path.resolve(target.file);
    if (file === runtimeLatest || !fs.existsSync(file)) continue;
    const archiveName = `${target.label}-${ymd(new Date())}-${STRATEGY2_LATEST_NAME}.gz`;
    const archiveFile = path.join(STRATEGY2_ARCHIVE_DIR, "static-latest", archiveName);
    if (gzipAndRemove(file, archiveFile)) messages.push(`archived static latest ${target.label}`);
  }
}

function pruneOldArchives(messages) {
  if (!fs.existsSync(STRATEGY2_ARCHIVE_DIR)) return;
  const cutoff = Date.now() - ARCHIVE_KEEP_DAYS * 24 * 60 * 60 * 1000;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(file);
        try {
          if (fs.readdirSync(file).length === 0) fs.rmdirSync(file);
        } catch {}
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".gz")) continue;
      const stat = fs.statSync(file);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(file);
        messages.push(`deleted old archive ${path.relative(STRATEGY2_ARCHIVE_DIR, file)}`);
      }
    }
  };
  walk(STRATEGY2_ARCHIVE_DIR);
}

function rotateStrategy2IntradayCache(options = {}) {
  const messages = [];
  try {
    compressOldHistory(options.currentDateKey, messages);
    if (options.archiveStaticLatestCopies) archiveStaticLatestCopies(messages);
    pruneOldArchives(messages);
  } catch (error) {
    messages.push(`rotation warning: ${error.message}`);
  }
  return messages;
}

module.exports = {
  rotateStrategy2IntradayCache,
};
