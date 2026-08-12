"use strict";

const fs = require("fs");
const path = require("path");

const MODULES = [
  { key: "strategy2", receipt: "strategy2", label: "策略2", scheduledAt: "08:00 起", deadline: "13:10", requiresTriSurface: true },
  { key: "strategy3", receipt: "strategy3", label: "策略3", scheduledAt: "12:30 / 12:50 / 13:00 / 13:05", deadline: "14:10", requiresTriSurface: true },
  { key: "strategy4", receipt: "strategy4", label: "策略4", scheduledAt: "15:35 預熱 / 16:00 掃描", deadline: "17:00", requiresTriSurface: true },
  { key: "strategy5", receipt: "strategy5", label: "策略5", scheduledAt: "21:00", deadline: "22:15", requiresTriSurface: true },
  { key: "institution", receipt: "institution", label: "買賣超", scheduledAt: "21:00", deadline: "22:15", requiresTriSurface: true },
  { key: "warrant", receipt: "warrant-flow", label: "權證", scheduledAt: "20:30", deadline: "22:20", requiresTriSurface: true },
  { key: "cb", receipt: "cb-detect", label: "CB", scheduledAt: "21:25", deadline: "22:45", requiresTriSurface: true },
];

function taipeiParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(value);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function taipeiDate(value = new Date()) {
  const part = taipeiParts(value);
  return `${part.year}-${part.month}-${part.day}`;
}

function compactDate(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return /^\d{8}$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : "";
}

function dateFromRunId(runId) {
  const match = String(runId || "").match(/20\d{6}/);
  return match ? compactDate(match[0]) : "";
}

function dateFromTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? taipeiDate(new Date(parsed)) : "";
}

function minuteOfDay(value = new Date()) {
  const part = taipeiParts(value);
  return Number(part.hour) * 60 + Number(part.minute);
}

function deadlineMinutes(text) {
  const match = String(text || "").match(/^(\d{1,2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.MAX_SAFE_INTEGER;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function countOf(receipt = {}) {
  for (const value of [receipt.verifiedResultCount, receipt.resultCount, receipt.matches, receipt.count]) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function buildModuleAudit(module, receipt, expectedDate, now) {
  const receiptDate = compactDate(receipt?.marketDate) || dateFromRunId(receipt?.runId) || dateFromTimestamp(receipt?.startedAt);
  const current = receiptDate === expectedDate;
  const status = String(receipt?.status || "").toLowerCase();
  const complete = receipt?.complete === true && status === "complete" && Number(receipt?.exitCode || 0) === 0;
  const triSurfaceComplete = receipt?.triSurfaceStatus === "complete";
  let auditStatus = "pending";
  let reason = "尚未收到今日掃描 receipt";
  if (current) {
    if (complete && (!module.requiresTriSurface || triSurfaceComplete)) {
      auditStatus = "complete";
      reason = "完整掃描、電腦端、88 與手機 production runId 已驗收";
    } else if (status === "running") {
      auditStatus = "running";
      reason = "掃描進行中，尚未完成三端驗收";
    } else if (complete && module.requiresTriSurface) {
      auditStatus = "degraded";
      reason = "掃描完成但缺少 tri-surface closure，不能宣告完整";
    } else {
      auditStatus = "failed";
      reason = String(receipt?.blockingReason || receipt?.blockedReason || receipt?.reason || "掃描未完成");
    }
  } else if (minuteOfDay(now) > deadlineMinutes(module.deadline)) {
    auditStatus = "overdue";
    reason = receipt ? `未收到 ${expectedDate} receipt；保留 ${receiptDate || "未知日期"} 資料` : `逾期未收到 ${expectedDate} receipt`;
  }
  return {
    key: module.key,
    label: module.label,
    scheduledAt: module.scheduledAt,
    deadline: module.deadline,
    receiptDate: receiptDate || "",
    status: auditStatus,
    complete: auditStatus === "complete",
    actualStartedAt: current ? String(receipt?.startedAt || "") : "",
    actualFinishedAt: current ? String(receipt?.finishedAt || "") : "",
    runId: current ? String(receipt?.runId || "") : "",
    previousGoodRunId: String(receipt?.previousGoodRunId || ""),
    count: current ? countOf(receipt) : 0,
    verifiedCount: current ? Number(receipt?.verifiedResultCount || 0) : 0,
    triSurfaceStatus: current ? String(receipt?.triSurfaceStatus || "") : "",
    desktopRunId: current ? String(receipt?.desktopRunId || "") : "",
    mobileRunId: current ? String(receipt?.mobileRunId || "") : "",
    scorecardRunId: current ? String(receipt?.scorecardRunId || "") : "",
    reason,
  };
}

function buildScanAudit({ runtimeDir = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", now = new Date() } = {}) {
  const marketDate = taipeiDate(now);
  const receiptDir = path.join(runtimeDir, "data", "scan-receipts");
  const modules = MODULES.map((module) => buildModuleAudit(module, readJson(path.join(receiptDir, `${module.receipt}.json`)), marketDate, now));
  return {
    ok: true,
    contract: "scorecard-scan-audit-v1",
    marketDate,
    updatedAt: now.toISOString(),
    qualityStatus: modules.every((row) => row.status === "complete") ? "complete" : "degraded",
    unattendedStatus: modules.every((row) => row.status === "complete") ? "YES" : "NO",
    modules,
  };
}

module.exports = { MODULES, buildScanAudit };
