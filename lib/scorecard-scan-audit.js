"use strict";

const fs = require("fs");
const path = require("path");

const MODULES = [
  { key: "strategy2", receipt: "strategy2", label: "策略2", scheduledAt: "08:00 起", deadline: "13:10", requiresTriSurface: true },
  { key: "strategy3", receipt: "strategy3", label: "策略3", scheduledAt: "12:30 / 12:50 / 12:55 / 13:00 / 13:10 / 13:15", deadline: "14:10", requiresTriSurface: true },
  { key: "strategy4", receipt: "strategy4", label: "策略4", scheduledAt: "15:35 預熱 / 16:00 掃描", deadline: "17:00", requiresTriSurface: true },
  { key: "strategy5", receipt: "strategy5", label: "策略5", scheduledAt: "21:00", deadline: "22:15", requiresTriSurface: true },
  { key: "institution", receipt: "institution", label: "買賣超", scheduledAt: "21:00", deadline: "22:15", requiresTriSurface: true },
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

function minuteFromTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return null;
  const part = taipeiParts(new Date(parsed));
  return Number(part.hour) * 60 + Number(part.minute);
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

function validStrategy3Recovery(receipt, expectedDate) {
  const run = String(receipt?.runId || '');
  return receipt?.contract === 'strategy-runner-verifier-receipt-v1' && receipt.strategy === 'strategy3'
    && receipt.tradeDate === expectedDate && run.startsWith('strategy3v2-recovery-replay-' + expectedDate.replace(/-/g, '') + '-')
    && receipt.complete === true && receipt.status === 'complete' && receipt.exitCode === 0
    && receipt.recoveryReplay === true && receipt.naturalSlotComplete === false && receipt.fallback === false
    && receipt.triSurfaceStatus === 'complete' && !receipt.blockingReason && !(receipt.failed_checks || []).length
    && ['desktopRunId','mobileRunId','scorecardRunId'].every(key => receipt[key] === run)
    && dateFromTimestamp(receipt.checkedAt) === expectedDate;
}

function validStrategy5Recovery(receipt, expectedDate, now, context) {
  const run = String(receipt?.runId || '');
  return context?.ok === true && context.mode === 'strategy_revision_replay'
    && context.tradeDate === expectedDate && !!context.calendarSource && !/fallback/i.test(context.calendarSource)
    && receipt?.strategy === 'strategy5' && compactDate(receipt.marketDate) === expectedDate
    && dateFromRunId(run) === expectedDate && /^strategy5-\d{8}-\d{14}$/.test(run)
    && receipt.complete === true && receipt.status === 'complete' && receipt.exitCode === 0 && receipt.fallback === false
    && receipt.triSurfaceStatus === 'complete' && !receipt.blockingReason
    && ['desktopRunId','mobileRunId','scorecardRunId'].every(key => receipt[key] === run)
    && dateFromTimestamp(receipt.startedAt) >= expectedDate
    && Number.isFinite(Date.parse(receipt.finishedAt)) && Date.parse(receipt.finishedAt) >= Date.parse(receipt.startedAt)
    && Date.parse(receipt.finishedAt) <= +now;
}

function buildModuleAudit(module, receipt, expectedDate, now, recoveryContext) {
  const executionDate = compactDate(receipt?.marketDate) || dateFromRunId(receipt?.runId) || dateFromTimestamp(receipt?.startedAt);
  const receiptDate = module.key === "institution"
    ? compactDate(receipt?.institution_source_status_at_run?.usedDate) || dateFromRunId(receipt?.runId) || executionDate
    : executionDate;
  const strategy5Recovery = module.key === 'strategy5' && validStrategy5Recovery(receipt, expectedDate, now, recoveryContext);
  const current = strategy5Recovery || (module.key === 'institution' ? receiptDate : module.key === 'strategy5' ? dateFromTimestamp(receipt?.startedAt) || executionDate : executionDate) === expectedDate;
  const status = String(receipt?.status || "").toLowerCase();
  const complete = receipt?.complete === true && status === "complete" && Number(receipt?.exitCode || 0) === 0;
  const triSurfaceComplete = receipt?.triSurfaceStatus === "complete";
  const actualStartedAt = current ? String(receipt?.startedAt || "") : "";
  const actualFinishedAt = current ? String(receipt?.finishedAt || "") : "";
  const startMinute = minuteFromTimestamp(actualStartedAt);
  const deadline = deadlineMinutes(module.deadline);
  const startedWithinDeadline = startMinute !== null && startMinute <= deadline;
  let auditStatus = "pending";
  let reason = "尚未收到今日掃描 receipt";
  if (current) {
    if (strategy5Recovery) {
      auditStatus = 'late_complete';
      reason = '補跑完成；資料日 ' + expectedDate + '，實際執行日 ' + dateFromTimestamp(receipt.startedAt) + '，非自然排程完成';
    } else if (module.key === 'strategy3' && validStrategy3Recovery(receipt, expectedDate)) {
      auditStatus = 'late_complete';
      reason = '補跑 COMPLETE；同批掃描與三端驗收完成，非 13:00 自然時槽完成' + (receipt.lineStatus === 'SKIPPED_QUOTA_EXHAUSTED' ? '；LINE 額度用盡，依當日授權例外未送達' : '');
    } else if (complete && (!module.requiresTriSurface || triSurfaceComplete) && startMinute === null) {
      auditStatus = "degraded";
      reason = "掃描完成但 receipt 缺少可驗證的實際開始時間，不能宣告準時完整";
    } else if (complete && (!module.requiresTriSurface || triSurfaceComplete) && !startedWithinDeadline) {
      auditStatus = "late_complete";
      reason = `完整掃描與三端驗收已完成，但實際開始時間晚於完成期限 ${module.deadline}`;
    } else if (complete && (!module.requiresTriSurface || triSurfaceComplete)) {
      auditStatus = "complete";
      reason = "完整掃描、電腦端、88 與手機 production runId 已驗收，且在完成期限內啟動";
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

function buildScanAudit({ runtimeDir = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", now = new Date(), tradeDate = "", recoveryContext = null } = {}) {
  const marketDate = tradeDate || taipeiDate(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(marketDate) || marketDate > taipeiDate(now)) throw Error("scan_audit_trade_date_invalid");
  const receiptDir = path.join(runtimeDir, "data", "scan-receipts");
  const modules = MODULES.map((module) => {
    let receipt = readJson(path.join(receiptDir, `${module.receipt}.json`));
    if (module.key === 'strategy3') {
      const recovery = readJson(path.join(receiptDir, 'strategy3-recovery-replay.json'));
      if (validStrategy3Recovery(recovery, marketDate)
        && Date.parse(recovery.checkedAt) > (Date.parse(receipt?.checkedAt || receipt?.finishedAt || receipt?.startedAt || '') || 0)) receipt = recovery;
    }
    return buildModuleAudit(module, receipt, marketDate, now, recoveryContext);
  });
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
