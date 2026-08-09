'use strict';

const fs = require('fs');
const path = require('path');
const { isTwseTradingDay } = require('./twse-trading-day');

const ROOT = path.resolve(__dirname, '..');
const STATE_DIR = process.env.FUMAN_WARMUP_STATE_DIR || 'C:\\fuman-runtime\\state';
const MANIFEST_DIR = process.env.FUMAN_DAILY_MANIFEST_DIR || path.join(ROOT, 'outputs', 'daily-terminal-run');
const CHECKPOINT_DIR = process.env.FUMAN_WARMUP_CHECKPOINT_DIR || path.join(ROOT, 'outputs', 'daytrade-warmup-nine-day', 'checkpoints');
const BASELINE_FILE = process.env.FUMAN_WARMUP_NINE_DAY_BASELINE_FILE || path.join(STATE_DIR, 'daytrade-warmup-nine-day-baseline.json');
const DEFAULT_START = '20260727';
const DEFAULT_END = '20260804';
const MODULE_KEYS = ['strategy2', 'strategy3', 'strategy4', 'strategy5', 'institution', 'cb', 'warrant'];
const PHASES = ['0700', '0845', '0900'];
const CHECKPOINT_PHASES = ['0705', '0847', '0912'];

function argValue(name, fallback) {
  const prefix = '--' + name + '=';
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function hasArg(name) {
  return process.argv.some((arg) => arg.startsWith('--' + name + '='));
}

function taipeiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function normalizeDateKey(value) {
  const key = String(value || '').replace(/\D/g, '').slice(0, 8);
  if (!/^\d{8}$/.test(key)) throw new Error('invalid date: ' + value);
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(4, 6));
  const day = Number(key.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('invalid calendar date: ' + value);
  }
  return key;
}

function nextDate(key) {
  const date = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8)) + 1));
  return String(date.getUTCFullYear()) + String(date.getUTCMonth() + 1).padStart(2, '0') + String(date.getUTCDate()).padStart(2, '0');
}

function addDays(key, count) {
  let result = key;
  for (let index = 0; index < count; index += 1) result = nextDate(result);
  return result;
}

function isWeekend(key) {
  const date = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8))));
  return date.getUTCDay() === 0 || date.getUTCDay() === 6;
}

async function marketCalendarStatus(key) {
  const date = new Date(
    key.slice(0, 4) + '-' + key.slice(4, 6) + '-' + key.slice(6, 8) + 'T12:00:00+08:00'
  );
  return isTwseTradingDay(date, { stateDir: STATE_DIR });
}

function summaryPath(dateKey) {
  return path.join(STATE_DIR, 'daytrade-warmup-unattended-summary-' + dateKey + '.json');
}

function manifestPath(dateKey) {
  return path.join(MANIFEST_DIR, 'daily-terminal-run-' + dateKey + '.json');
}

function checkpointPath(dateKey, phase) {
  return path.join(CHECKPOINT_DIR, 'daytrade-warmup-checkpoint-' + dateKey + '-' + phase + '.json');
}

function phaseNaturalPass(summary, phase, dateKey) {
  const result = summary && summary.phase_results && summary.phase_results[phase];
  const evidence = (result && result.evidence) || {};
  const isoDate = dateKey.slice(0, 4) + '-' + dateKey.slice(4, 6) + '-' + dateKey.slice(6, 8);
  return Boolean(result && result.pass === true
    && result.natural_schedule_evidence === true
    && evidence.naturalScheduleEvidence === true
    && evidence.manualVerificationOnly !== true
    && evidence.trade_date === isoDate
    && evidence.daytradeGateGrade === 'A'
    && Number(evidence.priorityPoolSymbols) === 40
    && Number(evidence.priorityFreshQuoteCoverage120s) >= 0.95
    && evidence.scannerCanRunOpening === true
    && evidence.formalEntrySpeedVerdict === 'YES'
    && result.selfHealRecovered !== true
    && evidence.selfHealRecovered !== true);
}

function openDayChecks(dateKey, summary, manifest, checkpoints) {
  const failures = [];
  const isoDate = dateKey.slice(0, 4) + '-' + dateKey.slice(4, 6) + '-' + dateKey.slice(6, 8);
  if (!summary) failures.push('missing_natural_warmup_summary');
  if (!manifest) failures.push('missing_daily_manifest');
  if (summary && summary.trade_date !== isoDate) failures.push('warmup_trade_date_mismatch');
  if (summary && summary.unattended_yes !== 'YES') failures.push('unattended_yes_not_confirmed');
  if (summary && summary.natural_warmup_ok !== true) failures.push('natural_warmup_not_ok');
  if (summary && summary.self_heal_recovered === true) failures.push('self_heal_recovery_cannot_count_as_natural');
  if (summary && summary.auto_recovered === true) failures.push('auto_recovery_cannot_count_as_natural');
  PHASES.forEach((phase) => {
    if (!phaseNaturalPass(summary, phase, dateKey)) failures.push('phase_' + phase + '_natural_evidence_not_A');
  });
  if (summary && Array.isArray(summary.failure_codes) && summary.failure_codes.length > 0) failures.push('warmup_failure_codes_present');
  CHECKPOINT_PHASES.forEach((phase) => {
    const receipt = checkpoints && checkpoints[phase];
    if (!receipt) failures.push('missing_checkpoint:' + phase);
    else if (receipt.status !== 'PASS') failures.push('checkpoint_not_pass:' + phase + ':' + receipt.status);
  });
  if (manifest) {
    if (manifest.tradeDate !== dateKey) failures.push('manifest_trade_date_mismatch');
    if (manifest.naturalSuccess !== true) failures.push('manifest_natural_success_not_true');
    if (manifest.selfHealRecovered === true) failures.push('manifest_self_heal_recovered');
    if (manifest.preservePreviousGood === true) failures.push('manifest_preserve_previous_good');
    if (manifest.unattendedStatus !== 'YES') failures.push('manifest_unattended_not_yes');
    if (manifest.closureStatus !== 'CLOSED') failures.push('manifest_closure_not_closed');
    if (Array.isArray(manifest.failedChecks) && manifest.failedChecks.length > 0) failures.push('manifest_failed_checks_present');
    MODULE_KEYS.forEach((key) => {
      if (!manifest.moduleRunIds || !String(manifest.moduleRunIds[key] || '').trim()) failures.push('manifest_missing_module_run_id:' + key);
    });
  }
  return { status: failures.length === 0 ? 'PASS' : 'FAIL', failures };
}

function closedDayChecks(dateKey, summary, checkpoints) {
  const failures = [];
  const isoDate = dateKey.slice(0, 4) + '-' + dateKey.slice(4, 6) + '-' + dateKey.slice(6, 8);
  const policy = summary && (summary.policy_decision || (summary.ops_policy && summary.ops_policy.policy_decision));
  if (!summary) failures.push('missing_market_closed_summary');
  if (summary && summary.trade_date !== isoDate) failures.push('closed_day_trade_date_mismatch');
  if (summary && summary.market_closed !== true && policy !== 'MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD') failures.push('market_closed_not_explicit');
  if (summary && policy !== 'MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD') failures.push('closed_day_policy_not_preserve_previous_good');
  if (summary && summary.unattended_yes === 'YES') failures.push('closed_day_unattended_yes_forbidden');
  if (summary && summary.natural_warmup_ok === true) failures.push('closed_day_natural_warmup_forbidden');
  CHECKPOINT_PHASES.forEach((phase) => {
    const receipt = checkpoints && checkpoints[phase];
    if (!receipt) failures.push('missing_closed_checkpoint:' + phase);
    else if (receipt.status !== 'MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD') failures.push('closed_checkpoint_not_preserve_previous_good:' + phase);
  });
  return { status: failures.length === 0 ? 'PASS' : 'FAIL', failures };
}

function evaluateDay(dateKey, calendar) {
  const summary = readJson(summaryPath(dateKey));
  const manifest = readJson(manifestPath(dateKey));
  const checkpoints = Object.fromEntries(CHECKPOINT_PHASES.map((phase) => [phase, readJson(checkpointPath(dateKey, phase))]));
  const closed = calendar?.isTradingDay === false;
  const checks = closed ? closedDayChecks(dateKey, summary, checkpoints) : openDayChecks(dateKey, summary, manifest, checkpoints);
  return {
    date: dateKey,
    type: closed ? 'market_closed' : 'trading_day',
    summary: summary ? summaryPath(dateKey) : '',
    manifest: manifest ? manifestPath(dateKey) : '',
    checkpoints,
    status: checks.status,
    failures: checks.failures,
    naturalSuccess: summary && summary.natural_warmup_ok === true && summary.self_heal_recovered !== true,
    selfHealRecovered: Boolean(summary && summary.self_heal_recovered === true),
    preservePreviousGood: closed || Boolean(summary && summary.preserve_previous_good === true)
  };
}

function readBaseline() {
  const payload = readJson(BASELINE_FILE);
  if (!payload) return { valid: false, status: 'NOT_PRESENT', payload: null, failures: ['baseline_not_present'] };
  const failures = [];
  try { normalizeDateKey(payload.qualifyingDate); } catch { failures.push('baseline_qualifying_date_invalid'); }
  try { normalizeDateKey(payload.trackingStartDate); } catch { failures.push('baseline_tracking_start_date_invalid'); }
  try { normalizeDateKey(payload.trackingEndDate); } catch { failures.push('baseline_tracking_end_date_invalid'); }
  if (payload.contract !== 'daytrade-warmup-nine-day-baseline-v1') failures.push('baseline_contract_invalid');
  if (payload.zeroError !== true) failures.push('baseline_zero_error_not_proven');
  if (payload.naturalSuccess !== true) failures.push('baseline_natural_success_not_proven');
  if (payload.productionReadback !== true) failures.push('baseline_production_readback_not_proven');
  if (payload.completionAudit !== true) failures.push('baseline_completion_audit_not_proven');
  if (payload.trackingStartDate && payload.qualifyingDate && payload.trackingStartDate !== nextDate(payload.qualifyingDate)) failures.push('baseline_tracking_start_not_next_day');
  if (payload.trackingStartDate && payload.trackingEndDate && payload.trackingEndDate !== addDays(payload.trackingStartDate, 8)) failures.push('baseline_window_not_nine_days');
  return { valid: failures.length === 0, status: failures.length === 0 ? 'READY' : 'INVALID', payload, failures };
}

function productionReadbackIsGreen(payload) {
  return Boolean(payload && payload.ok === true && Array.isArray(payload.issues) && payload.issues.length === 0);
}

function dreamVersionBodyIsGreen(productionLive, completionAudit) {
  return Boolean(
    productionReadbackIsGreen(productionLive)
    && completionAudit?.ok === true
    && completionAudit?.operationalOk === true
    && completionAudit?.businessUnattendedYes === true
    && /^(UNATTENDED_YES|YES)$/.test(String(completionAudit?.finalDecision || '').trim())
  );
}

async function qualifyBaseline(dateKey, productionLive, completionAudit, calendar) {
  const summary = readJson(summaryPath(dateKey));
  const manifest = readJson(manifestPath(dateKey));
  const checkpoints = Object.fromEntries(CHECKPOINT_PHASES.map((phase) => [phase, readJson(checkpointPath(dateKey, phase))]));
  const failures = [];
  if (calendar?.isTradingDay !== true) failures.push('baseline_must_be_qualified_on_trading_day');
  const daily = openDayChecks(dateKey, summary, manifest, checkpoints);
  failures.push(...daily.failures);
  if (!productionReadbackIsGreen(productionLive)) failures.push('baseline_production_live_readback_not_green');
  if (!completionAudit || completionAudit.ok !== true) failures.push('baseline_completion_audit_not_green');
  if (!dreamVersionBodyIsGreen(productionLive, completionAudit)) failures.push('dream_version_body_not_complete');
  return {
    ok: failures.length === 0,
    failures,
    sources: {
      summary: summaryPath(dateKey),
      manifest: manifestPath(dateKey),
      productionLive: productionLive ? 'loaded' : 'missing',
      completionAudit: completionAudit ? 'loaded' : 'missing'
    }
  };
}

async function maybeArmBaseline(todayKey, productionLiveFile, completionAuditFile, baselineState, calendar) {
  if (baselineState.valid || calendar?.isTradingDay !== true) return { baseline: baselineState, armedNow: false, qualification: null };
  const productionLive = readJson(productionLiveFile);
  const completionAudit = readJson(completionAuditFile);
  const qualification = await qualifyBaseline(todayKey, productionLive, completionAudit, calendar);
  if (!qualification.ok) return { baseline: baselineState, armedNow: false, qualification };
  const payload = {
    contract: 'daytrade-warmup-nine-day-baseline-v1',
    armedAt: new Date().toISOString(),
    qualifyingDate: todayKey,
    trackingStartDate: nextDate(todayKey),
    trackingEndDate: addDays(nextDate(todayKey), 8),
    zeroError: true,
    naturalSuccess: true,
    productionReadback: true,
    completionAudit: true,
    qualification
  };
  fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(payload, null, 2));
  return { baseline: readBaseline(), armedNow: true, qualification };
}

function writeReport(output, report) {
  fs.mkdirSync(output, { recursive: true });
  const suffix = report.scheduledWindow ? report.scheduledWindow.start + '-' + report.scheduledWindow.end : 'not-started';
  const file = path.join(output, 'daytrade-warmup-nine-day-' + suffix + '.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(output, 'daytrade-warmup-nine-day-latest.json'), JSON.stringify(report, null, 2));
  return file;
}

async function main() {
  const output = argValue('out', path.join(ROOT, 'outputs', 'daytrade-warmup-nine-day'));
  const productionLiveFile = argValue('production-live', path.join(ROOT, 'outputs', 'terminal-ops-production-live', 'terminal-ops-production-live-readback.json'));
  const completionAuditFile = argValue('completion-audit', path.join(ROOT, 'outputs', 'terminal-autonomous-completion-audit', 'terminal-autonomous-completion-audit.json'));
  const todayKey = normalizeDateKey(argValue('today', taipeiDateKey()));
  const todayCalendar = await marketCalendarStatus(todayKey);
  const baselineBefore = readBaseline();
  const baselineResult = await maybeArmBaseline(todayKey, productionLiveFile, completionAuditFile, baselineBefore, todayCalendar);
  const baseline = baselineResult.baseline;
  const explicitStart = hasArg('start');
  const explicitEnd = hasArg('end');
  const observedStart = normalizeDateKey(argValue('start', DEFAULT_START));
  const observedEnd = normalizeDateKey(argValue('end', DEFAULT_END));
  const trackingStart = baseline.valid ? normalizeDateKey(explicitStart ? argValue('start', baseline.payload.trackingStartDate) : baseline.payload.trackingStartDate) : observedStart;
  const trackingEnd = baseline.valid
    ? normalizeDateKey(explicitEnd ? argValue('end', baseline.payload.trackingEndDate) : baseline.payload.trackingEndDate)
    : observedEnd;
  const beforeStart = baseline.valid && todayKey < trackingStart;
  const trackingStarted = baseline.valid && !beforeStart && !baselineResult.armedNow;
  const observationEnd = trackingStarted && todayKey < trackingEnd ? todayKey : (trackingStarted ? trackingEnd : trackingStart);
  const observedKeys = [];
  if (trackingStarted && observationEnd >= trackingStart) {
    for (let key = trackingStart; ; key = nextDate(key)) {
      observedKeys.push(key);
      if (key === observationEnd) break;
    }
  }
  const calendarEntries = await Promise.all(observedKeys.map(async (key) => [key, await marketCalendarStatus(key)]));
  const calendarByDate = new Map(calendarEntries);
  const days = observedKeys.map((key) => evaluateDay(key, calendarByDate.get(key)));
  const scheduledTotal = 9;
  const productionReadbackPass = productionReadbackIsGreen(readJson(productionLiveFile));
  const dreamVersionBodyReady = dreamVersionBodyIsGreen(
    readJson(productionLiveFile),
    readJson(completionAuditFile)
  );
  const blockingReasons = [];
  let status = 'BASELINE_NOT_READY';
  let ok = false;
  if (!baseline.valid) {
    blockingReasons.push('baseline_not_ready_full_zero_error_closed_loop_required', 'nine_day_tracking_not_started');
  } else if (baselineResult.armedNow || beforeStart) {
    status = 'BASELINE_ARMED_WAITING_TRACKING_START';
    blockingReasons.push('nine_day_tracking_not_started_until_baseline_next_day');
  } else {
    status = days.length === scheduledTotal ? 'TRACKING_COMPLETE_PENDING_FINAL_AUDIT' : 'TRACKING_IN_PROGRESS';
    if (days.some((day) => day.status !== 'PASS')) blockingReasons.push('one_or_more_observed_daily_evidence_records_not_complete');
    if (days.length < scheduledTotal) blockingReasons.push('nine_day_tracking_in_progress');
    if (days.length === scheduledTotal && days.filter((day) => day.status === 'PASS').length !== scheduledTotal) blockingReasons.push('nine_day_continuity_broken');
    if (days.length === scheduledTotal && !productionReadbackPass) blockingReasons.push('production_live_readback_not_green');
    const tradingDays = days.filter((day) => day.type === 'trading_day');
    const closedDays = days.filter((day) => day.type === 'market_closed');
    if (days.length === scheduledTotal && tradingDays.length !== 7) blockingReasons.push('window_trading_day_count_expected_7_actual_' + tradingDays.length);
    if (days.length === scheduledTotal && closedDays.length !== 2) blockingReasons.push('window_closed_day_count_expected_2_actual_' + closedDays.length);
    ok = days.length === scheduledTotal && blockingReasons.length === 0;
    if (ok) status = 'UNATTENDED_9_DAY_COMPLETE';
  }
  const tradingDays = days.filter((day) => day.type === 'trading_day');
  const closedDays = days.filter((day) => day.type === 'market_closed');
  const report = {
    contract: 'daytrade-warmup-nine-day-window-v2',
    checkedAt: new Date().toISOString(),
    today: todayKey,
    marketCalendar: { today: todayCalendar, observed: Object.fromEntries(calendarEntries) },
    scheduledWindow: { start: trackingStart, end: trackingEnd, totalDays: scheduledTotal },
    baseline: {
      path: BASELINE_FILE,
      status: baseline.status,
      valid: baseline.valid,
      armedNow: baselineResult.armedNow,
      qualifyingDate: baseline.payload && baseline.payload.qualifyingDate,
      trackingStartsAfterBaseline: true,
      qualification: baselineResult.qualification
    },
    status,
    ok,
    productionEligible: ok,
    productionReadback: { path: productionLiveFile, ok: Boolean(productionReadbackPass) },
    dreamVersionBody: {
      ready: dreamVersionBodyReady,
      requiresBusinessUnattendedYes: true,
      requiresProductionReadbackGreen: true,
      requiresFinalDecision: 'UNATTENDED_YES'
    },
    counts: {
      total: scheduledTotal,
      observedDays: days.length,
      futureDays: Math.max(0, scheduledTotal - days.length),
      tradingDays: tradingDays.length,
      closedDays: closedDays.length,
      passed: days.filter((day) => day.status === 'PASS').length,
      pendingOrFailed: days.filter((day) => day.status !== 'PASS').length,
      remainingDays: Math.max(0, scheduledTotal - days.length)
    },
    blockingReasons,
    days,
    rules: {
      baselineRequiredBeforeCounting: true,
      baselineRequiresZeroErrorFullClosure: true,
      baselineMustBeNaturalTradingDay: true,
      continuousNineCalendarDaysAfterBaseline: true,
      futureDaysAreNotCountedAsFailed: true,
      naturalSuccessSeparateFromSelfHeal: true,
      closedDaysRequirePreservePreviousGood: true,
      openDaysRequireNatural0700_0845_0900: true,
      openDaysRequireDailyManifestAndModuleRunIds: true,
      productionReadbackRequiredBeforeFinalYes: true,
      noBackfillOrFakeSuccess: true
    }
  };
  const file = writeReport(output, report);
  console.log(JSON.stringify({ ok, status, scheduledWindow: report.scheduledWindow, baseline: report.baseline, counts: report.counts, blockingReasons, output: file }, null, 2));
  if (process.argv.includes('--strict') && !ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, status: 'VERIFIER_ERROR', error: error.message }, null, 2));
  process.exitCode = 1;
});
