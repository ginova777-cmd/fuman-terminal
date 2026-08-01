"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const CONTRACT = "terminal-orchestrator-lock-v1";
const DEFAULT_TTL_MS = 45 * 60 * 1000;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return error && error.code === "EPERM";
  }
}

function isExpired(lock, now = Date.now()) {
  const expiresAt = Date.parse(lock?.expiresAt || "");
  if (Number.isFinite(expiresAt)) return expiresAt <= now;
  const updatedAt = Date.parse(lock?.updatedAt || lock?.startedAt || "");
  return !Number.isFinite(updatedAt) || updatedAt + DEFAULT_TTL_MS <= now;
}

function writeLock(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function acquire(options = {}) {
  const runtimeDir = options.runtimeDir || process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
  const lockDir = path.join(runtimeDir, "locks");
  const lockFile = options.lockFile || path.join(lockDir, "terminal-daily-orchestrator.lock");
  const ttlMs = Number(options.ttlMs || DEFAULT_TTL_MS);
  const now = Date.now();
  const ownerId = `${os.hostname()}-${process.pid}-${now}-${Math.random().toString(36).slice(2, 10)}`;
  const owner = {
    contract: CONTRACT,
    ownerId,
    hostId: os.hostname(),
    pid: process.pid,
    startedAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    expectedDate: String(options.expectedDate || ""),
    mode: String(options.mode || "autonomous_ops"),
  };

  fs.mkdirSync(lockDir, { recursive: true });
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  try {
    const fd = fs.openSync(lockFile, "wx");
    fs.writeFileSync(fd, `${JSON.stringify(owner, null, 2)}\n`, "utf8");
    fs.closeSync(fd);
  } catch (error) {
    if (!error || error.code !== "EEXIST") throw error;
    const current = readJson(lockFile) || {};
    if (!isExpired(current, now) || pidAlive(current.pid)) {
      return { ok: false, status: "LOCK_HELD", contract: CONTRACT, lockFile, owner: current };
    }
    const staleFile = `${lockFile}.stale-${now}`;
    try { fs.renameSync(lockFile, staleFile); } catch { return { ok: false, status: "LOCK_RACE", contract: CONTRACT, lockFile, owner: current }; }
    const fd = fs.openSync(lockFile, "wx");
    fs.writeFileSync(fd, `${JSON.stringify(owner, null, 2)}\n`, "utf8");
    fs.closeSync(fd);
  }

  let released = false;
  function renew() {
    if (released) return false;
    const current = readJson(lockFile);
    if (!current || current.ownerId !== ownerId) return false;
    const nowValue = Date.now();
    owner.updatedAt = new Date(nowValue).toISOString();
    owner.expiresAt = new Date(nowValue + ttlMs).toISOString();
    writeLock(lockFile, owner);
    return true;
  }
  function release() {
    if (released) return;
    released = true;
    const current = readJson(lockFile);
    if (current && current.ownerId === ownerId) {
      try { fs.unlinkSync(lockFile); } catch { /* best effort on process exit */ }
    }
  }
  return { ok: true, status: "LOCK_ACQUIRED", contract: CONTRACT, lockFile, owner, renew, release };
}

module.exports = { CONTRACT, DEFAULT_TTL_MS, acquire, isExpired, pidAlive };
