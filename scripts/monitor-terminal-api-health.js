const fs = require("fs");
const path = require("path");

const { hasLineConfig, sendLineText } = require("./line-push");
const { hasTelegramConfig, sendTelegramText } = require("./telegram-push");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_TERMINAL_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const STATE_DIR = process.env.FUMAN_STATE_DIR || path.join(RUNTIME_DIR, "state");
const STATUS_FILE = path.join(STATE_DIR, "terminal-api-health-latest.json");
const ALERT_STATE_FILE = path.join(STATE_DIR, "terminal-api-health-alert-state.json");
const REQUEST_TIMEOUT_MS = Number(process.env.TERMINAL_HEALTH_TIMEOUT_MS || 15000);
const ALERT_COOLDOWN_MS = Number(process.env.TERMINAL_HEALTH_ALERT_COOLDOWN_MS || 30 * 60 * 1000);
const TDCC_MIN_COUNT = Number(process.env.TERMINAL_HEALTH_TDCC_MIN_COUNT || 0);

function readLocalVersion() {
  const override = String(process.env.EXPECTED_TERMINAL_VERSION || "").trim();
  if (override) return override;
  try {
    const payload = JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8"));
    return String(payload.version || payload.build || "").trim();
  } catch (_) {
    return "";
  }
}

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function readJsonSafe(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function num(value) {
  if (value === undefined || value === null || value === "") return 0;
  return Number(String(value).replace(/[,%]/g, "").trim()) || 0;
}

function countPayload(payload) {
  if (!payload) return 0;
  if (Array.isArray(payload)) return payload.length;
  if (Array.isArray(payload.rows)) return payload.rows.length;
  if (Array.isArray(payload.matches)) return payload.matches.length;
  if (Array.isArray(payload.data)) return payload.data.length;
  if (payload.data && typeof payload.data === "object") return Object.keys(payload.data).length;
  return num(payload.count || payload.total || payload.stockCount);
}

function rowsOf(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.matches)) return payload.matches;
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.data && typeof payload.data === "object") {
    return Object.entries(payload.data).map(([code, row]) => ({ code, ...(row || {}) }));
  }
  return [];
}

function valueOf(row, keys) {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return 0;
}

function foreignTrustVolumeCandidates(rows) {
  return rows.filter((row) => {
    const foreign = num(valueOf(row, ["foreign", "foreignBuySell", "foreign_net_buy", "foreignNetBuy"]));
    const trust = num(valueOf(row, ["trust", "investmentTrust", "trustBuySell", "trust_net_buy", "trustNetBuy"]));
    const avg = num(valueOf(row, ["avg5Volume", "fiveDayAvgVolume", "volume5dAvg", "avgVolume5d"]));
    return avg > 0 && foreign + trust > 0;
  }).length;
}

function issue(severity, message, detail = {}) {
  return { severity, message, detail };
}

async function fetchJson(pathname) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = `${BASE_URL}${pathname}${pathname.includes("?") ? "&" : "?"}t=${Date.now()}-${Math.random()}`;
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "Accept": "application/json",
        "Cache-Control": "no-store",
        "Pragma": "no-cache",
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch (error) {
      throw new Error(`${pathname} JSON parse failed: ${error.message}`);
    }
    if (!response.ok) throw new Error(`${pathname} HTTP ${response.status}`);
    return {
      ok: true,
      status: response.status,
      cacheControl: response.headers.get("cache-control") || "",
      payload,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(pathname) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = `${BASE_URL}${pathname}${pathname.includes("?") ? "&" : "?"}t=${Date.now()}-${Math.random()}`;
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "Accept": "text/plain,*/*",
        "Cache-Control": "no-store",
        "Pragma": "no-cache",
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${pathname} HTTP ${response.status}`);
    return {
      ok: true,
      status: response.status,
      cacheControl: response.headers.get("cache-control") || "",
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkVersion(expectedVersion) {
  const result = await fetchJson("/version.json");
  const payload = result.payload || {};
  const liveVersion = String(payload.version || payload.build || "").trim();
  const issues = [];
  if (!liveVersion) issues.push(issue("warning", "正式版本 version.json 沒有 version/build"));
  if (expectedVersion && liveVersion && liveVersion !== expectedVersion) {
    issues.push(issue("warning", "正式版本和本機 version.json 不一致；API-only 資料健康不以版本判定", { expectedVersion, liveVersion }));
  }
  return {
    name: "version",
    ok: issues.filter((item) => item.severity === "critical").length === 0,
    version: liveVersion,
    expectedVersion,
    issues,
  };
}

async function checkChipFrontendContract() {
  const issues = [];
  try {
    const [chip, runtime] = await Promise.all([
      fetchText("/terminal-chip-flow.js"),
      fetchText("/terminal-runtime-config.js"),
    ]);
    const chipText = chip.text || "";
    const runtimeText = runtime.text || "";
    const hasCorrectTdccGate = /function\s+isTdccMode[\s\S]*?return\s+mode\s*===\s*["']tdcc1000["']\s*;/.test(chipText);
    const hasOldForeignTrustTdccGate = /return\s+mode\s*===\s*["']tdcc1000["']\s*\|\|\s*mode\s*===\s*["']foreignTrustVolumePct["']/.test(chipText);
    const hasForeignTrustNormalMode = /mode\s*===\s*["']foreignTrustVolumePct["'][\s\S]*?外資\+投信佔5日均量/.test(chipText);
    const hasTdccApiEndpoint = /institutionTdccBreakout\s*:\s*["']\/api\/institution-tdcc-breakout-latest["']/.test(runtimeText);
    const hasOldTdccStaticEndpoint = /institutionTdccBreakout\s*:\s*["']\/data\/institution-tdcc-breakout-top\.json["']/.test(runtimeText);

    if (!hasCorrectTdccGate) {
      issues.push(issue("critical", "線上買賣超 JS 沒有正確 TDCC gate", { expected: "return mode === \"tdcc1000\";" }));
    }
    if (hasOldForeignTrustTdccGate) {
      issues.push(issue("critical", "線上買賣超 JS 又把外資+投信佔5日均量誤判為 TDCC", {
        badPattern: "tdcc1000 || foreignTrustVolumePct",
      }));
    }
    if (!hasForeignTrustNormalMode) {
      issues.push(issue("critical", "線上買賣超 JS 缺少外資+投信佔5日均量一般表格模式"));
    }
    if (!hasTdccApiEndpoint) {
      issues.push(issue("critical", "線上 runtime config 沒有指向 TDCC 起漲 API", {
        expected: "/api/institution-tdcc-breakout-latest",
      }));
    }
    if (hasOldTdccStaticEndpoint) {
      issues.push(issue("critical", "線上 runtime config 仍指向舊 TDCC static JSON", {
        badEndpoint: "/data/institution-tdcc-breakout-top.json",
      }));
    }
    return {
      name: "買賣超前端合約",
      ok: issues.filter((item) => item.severity === "critical").length === 0,
      status: chip.status,
      chipBytes: chipText.length,
      runtimeBytes: runtimeText.length,
      isTdccMode: hasCorrectTdccGate ? "tdcc1000-only" : "unknown",
      tdccEndpoint: hasTdccApiEndpoint ? "/api/institution-tdcc-breakout-latest" : "missing-or-old",
      issues,
    };
  } catch (error) {
    return {
      name: "買賣超前端合約",
      ok: false,
      issues: [issue("critical", "買賣超前端合約讀取失敗", { error: error.message })],
    };
  }
}

async function checkApi(name, pathname, options = {}) {
  const issues = [];
  try {
    const result = await fetchJson(pathname);
    const payload = result.payload || {};
    const count = countPayload(payload);
    const rows = rowsOf(payload);
    if (payload.ok === false) issues.push(issue("critical", `${name} 回傳 ok=false`, { error: payload.error || "" }));
    if (options.minCount !== undefined && count < options.minCount) {
      issues.push(issue(options.minCount > 0 ? "critical" : "warning", `${name} 筆數低於門檻`, {
        count,
        minCount: options.minCount,
      }));
    }
    let foreignTrust5dCandidates = undefined;
    if (options.checkForeignTrust5d) {
      foreignTrust5dCandidates = foreignTrustVolumeCandidates(rows);
      if (foreignTrust5dCandidates <= 0) {
        issues.push(issue("critical", "外資+投信佔5日均量沒有可顯示資料", { count, foreignTrust5dCandidates }));
      }
    }
    if (options.requireNoStore && !/no-store/i.test(result.cacheControl)) {
      issues.push(issue("warning", `${name} cache-control 不是 no-store`, { cacheControl: result.cacheControl }));
    }
    return {
      name,
      ok: issues.filter((item) => item.severity === "critical").length === 0,
      status: result.status,
      cacheControl: result.cacheControl,
      count,
      runId: payload.runId || "",
      usedDate: payload.usedDate || payload.date || "",
      foreignTrust5dCandidates,
      issues,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      count: 0,
      issues: [issue("critical", `${name} 讀取失敗`, { error: error.message })],
    };
  }
}

function buildAlert(status) {
  const critical = status.issues.filter((item) => item.severity === "critical");
  const warnings = status.issues.filter((item) => item.severity === "warning");
  const lines = [
    `富滿終端 API 健康檢查${critical.length ? "異常" : "警告"}`,
    `時間：${status.updatedAt}`,
    `網址：${BASE_URL}`,
    "",
  ];
  for (const item of critical.slice(0, 8)) lines.push(`CRITICAL：${item.message} ${JSON.stringify(item.detail || {})}`);
  for (const item of warnings.slice(0, 5)) lines.push(`WARNING：${item.message} ${JSON.stringify(item.detail || {})}`);
  return lines.join("\n").trim();
}

async function notifyIfNeeded(status) {
  const critical = status.issues.filter((item) => item.severity === "critical");
  if (!critical.length) return { sent: false, reason: "no critical issues" };

  const signature = critical.map((item) => `${item.message}:${JSON.stringify(item.detail || {})}`).join("|");
  const previous = readJsonSafe(ALERT_STATE_FILE, {});
  const now = Date.now();
  const stillCoolingDown = previous.signature === signature && now - Number(previous.sentAtMs || 0) < ALERT_COOLDOWN_MS;
  if (stillCoolingDown) return { sent: false, reason: "cooldown", signature };

  const text = buildAlert(status);
  const channels = [];
  const errors = [];
  if (hasTelegramConfig()) {
    try {
      await sendTelegramText(text);
      channels.push("telegram");
    } catch (error) {
      errors.push(`telegram: ${error.message}`);
    }
  }
  if (hasLineConfig()) {
    try {
      await sendLineText(text);
      channels.push("line");
    } catch (error) {
      errors.push(`line: ${error.message}`);
    }
  }
  fs.writeFileSync(ALERT_STATE_FILE, JSON.stringify({
    signature,
    sentAt: new Date().toISOString(),
    sentAtMs: now,
    channels,
    errors,
  }, null, 2));
  return { sent: channels.length > 0, channels, errors, signature };
}

async function main() {
  ensureStateDir();
  const expectedVersion = readLocalVersion();
  const checks = [];
  checks.push(await checkVersion(expectedVersion));
  checks.push(await checkApi("買賣超 API", "/api/institution-latest", {
    minCount: 1,
    requireNoStore: true,
    checkForeignTrust5d: true,
  }));
  checks.push(await checkChipFrontendContract());
  checks.push(await checkApi("開盤買 API", "/api/open-buy-latest", {
    minCount: 1,
    requireNoStore: true,
  }));
  checks.push(await checkApi("策略3 API", "/api/strategy3-latest", {
    minCount: 1,
    requireNoStore: true,
  }));
  checks.push(await checkApi("TDCC 起漲 API", "/api/institution-tdcc-breakout-latest", {
    minCount: TDCC_MIN_COUNT,
    requireNoStore: true,
  }));
  checks.push(await checkApi("策略4 API", "/api/strategy4-latest", {
    minCount: 1,
    requireNoStore: true,
  }));
  checks.push(await checkApi("策略5 API", "/api/strategy5-latest", {
    minCount: 1,
    requireNoStore: true,
  }));
  checks.push(await checkApi("權證走向 API", "/api/warrant-flow-latest", {
    minCount: 1,
    requireNoStore: true,
  }));

  const issues = checks.flatMap((check) => check.issues || []);
  const criticalCount = issues.filter((item) => item.severity === "critical").length;
  const status = {
    ok: criticalCount === 0,
    source: "terminal-api-health",
    baseUrl: BASE_URL,
    updatedAt: new Date().toISOString(),
    criticalCount,
    warningCount: issues.filter((item) => item.severity === "warning").length,
    checks,
    issues,
  };

  const notification = await notifyIfNeeded(status);
  status.notification = notification;
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
  console.log(JSON.stringify(status, null, 2));
  if (!status.ok) process.exitCode = 1;
}

main().catch((error) => {
  ensureStateDir();
  const status = {
    ok: false,
    source: "terminal-api-health",
    baseUrl: BASE_URL,
    updatedAt: new Date().toISOString(),
    criticalCount: 1,
    warningCount: 0,
    checks: [],
    issues: [issue("critical", "健康檢查程式失敗", { error: error.stack || error.message })],
  };
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
  console.error(error);
  process.exitCode = 1;
});
