const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_RUNTIME_ROOT = process.platform === "win32" ? "C:\\fuman-runtime" : ROOT;
const RUNTIME_ROOT = process.env.FUMAN_RUNTIME_DIR || process.env.FUMAN_RUNTIME_ROOT || DEFAULT_RUNTIME_ROOT;
const DATA_DIR = process.env.FUMAN_DATA_DIR || path.join(RUNTIME_ROOT, "data");
const CACHE_DIR = process.env.FUMAN_CACHE_DIR || path.join(RUNTIME_ROOT, "cache");
const STATE_DIR = process.env.FUMAN_STATE_DIR || path.join(RUNTIME_ROOT, "state");

function dataPath(...parts) {
  return path.join(DATA_DIR, ...parts);
}

function cachePath(...parts) {
  return path.join(CACHE_DIR, ...parts);
}

function statePath(...parts) {
  return path.join(STATE_DIR, ...parts);
}

function runtimePath(...parts) {
  return path.join(RUNTIME_ROOT, ...parts);
}

function repoPath(...parts) {
  return path.join(ROOT, ...parts);
}

function envFlag(name) {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || "").trim());
}

function dataOutputPaths(file, options = {}) {
  const repoEnv = Array.isArray(options.repoEnv)
    ? options.repoEnv
    : [options.repoEnv].filter(Boolean);
  const rel = String(file || "").replace(/^data[\\/]/i, "");
  const paths = [dataPath(rel)];
  if (envFlag("FUMAN_WRITE_CODE_REPO_DATA") || repoEnv.some((name) => envFlag(name))) {
    paths.push(repoPath("data", rel));
  }
  return [...new Set(paths)];
}

module.exports = {
  ROOT,
  RUNTIME_ROOT,
  DATA_DIR,
  CACHE_DIR,
  STATE_DIR,
  dataPath,
  cachePath,
  statePath,
  runtimePath,
  repoPath,
  dataOutputPaths,
};
