'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STATE_DIR = process.env.FUMAN_WARMUP_STATE_DIR || 'C:\\fuman-runtime\\state';
const MANIFEST_DIR = process.env.FUMAN_DAILY_MANIFEST_DIR || path.join(ROOT, 'outputs', 'daily-terminal-run');
const CHECKPOINT_DIR = process.env.FUMAN_WARMUP_CHECKPOINT_DIR || path.join(ROOT, 'outputs', 'daytrade-warmup-nine-day', 'checkpoints');
const DEFAULT_START = '20260727';
const DEFAULT_END = '20260804';
const MODULE_KEYS = ['strategy2', 'strategy3', 'strategy4', 'strategy5', 'institution', 'cb', 'warrant'];
const PHASES = ['0700', '0845', '0900'];

function argValue(name, fallback) {
  const prefix = '--' + name + '=';
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
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

function isWeekend(key) {
  const date = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8))));
  return date.getUTCDay() === 0 || date.getUTCDay() === 6;
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
  ['0705', '0847', '0912'].forEach((phase) => {
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
  ['0705', '0847', '0912'].forEach((phase) => {
    const receipt = checkpoints && checkpoints[phase];
    if (!receipt) failures.push('missing_closed_checkpoint:' + phase);
    else if (receipt.status !== 'MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD') failures.push('closed_checkpoint_not_preserve_previous_good:' + phase);
  });
  return { status: failures.length === 0 ? 'PASS' : 'FAIL', failures };
}

function main() {
  const start = normalizeDateKey(argValue('start', DEFAULT_START));
  const end = normalizeDateKey(argValue('end', DEFAULT_END));
  const output = argValue('out', path.join(ROOT, 'outputs', 'daytrade-warmup-nine-day'));
  const productionLiveFile = argValue('production-live', path.join(ROOT, 'outputs', 'terminal-ops-production-live', 'terminal-ops-production-live-readback.json'));
  const days = [];
  for (let key = start; ; key = nextDate(key)) {
    const summary = readJson(summaryPath(key));
    const manifest = readJson(manifestPath(key));
    const checkpoints = Object.fromEntries(['0705', '0847', '0912'].map((phase) => [phase, readJson(checkpointPath(key, phase))]));
    const closed = isWeekend(key);
    const checks = closed ? closedDayChecks(key, summary, checkpoints) : openDayChecks(key, summary, manifest, checkpoints);
    days.push({
      date: key,
      type: closed ? 'market_closed' : 'trading_day',
      summary: summary ? summaryPath(key) : '',
      manifest: manifest ? manifestPath(key) : '',
      checkpoints,
      status: checks.status,
      failures: checks.failures,
      naturalSuccess: summary && summary.natural_warmup_ok === true && summary.self_heal_recovered !== true,
      selfHealRecovered: Boolean(summary && summary.self_heal_recovered === true),
      preservePreviousGood: closed || Boolean(summary && summary.preserve_previous_good === true)
    });
    if (key === end) break;
    if (key > end) throw new Error('start must be before end: ' + start + ' > ' + end);
  }
  const tradingDays = days.filter((day) => day.type === 'trading_day');
  const closedDays = days.filter((day) => day.type === 'market_closed');
  const productionLive = readJson(productionLiveFile);
  const productionReadbackPass = productionLive && productionLive.ok === true && Array.isArray(productionLive.issues) && productionLive.issues.length === 0;
  const blockingReasons = [];
  if (tradingDays.length !== 7) blockingReasons.push('window_trading_day_count_expected_7_actual_' + tradingDays.length);
  if (closedDays.length !== 2) blockingReasons.push('window_closed_day_count_expected_2_actual_' + closedDays.length);
  if (days.some((day) => day.status !== 'PASS')) blockingReasons.push('one_or_more_daily_evidence_records_not_complete');
  if (!productionReadbackPass) blockingReasons.push('production_live_readback_not_green');
  const ok = blockingReasons.length === 0;
  const report = {
    contract: 'daytrade-warmup-nine-day-window-v1',
    checkedAt: new Date().toISOString(),
    window: { start, end, requiredTradingDays: 7, requiredClosedDays: 2, requiredNaturalOpenDays: 2 },
    status: ok ? 'UNATTENDED_9_DAY_COMPLETE' : 'TRACKING_PENDING',
    ok,
    productionEligible: ok,
    productionReadback: { path: productionLiveFile, ok: Boolean(productionReadbackPass) },
    counts: {
      total: days.length,
      tradingDays: tradingDays.length,
      closedDays: closedDays.length,
      passed: days.filter((day) => day.status === 'PASS').length,
      pendingOrFailed: days.filter((day) => day.status !== 'PASS').length
    },
    blockingReasons,
    days,
    rules: {
      naturalSuccessSeparateFromSelfHeal: true,
      closedDaysRequirePreservePreviousGood: true,
      openDaysRequireNatural0700_0845_0900: true,
      openDaysRequireDailyManifestAndModuleRunIds: true,
      productionReadbackRequiredBeforeFinalYes: true,
      noBackfillOrFakeSuccess: true
    }
  };
  fs.mkdirSync(output, { recursive: true });
  const file = path.join(output, 'daytrade-warmup-nine-day-' + start + '-' + end + '.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(output, 'daytrade-warmup-nine-day-latest.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok, status: report.status, window: report.window, counts: report.counts, blockingReasons, output: file }, null, 2));
  if (process.argv.includes('--strict') && !ok) process.exitCode = 1;
}

try { main(); } catch (error) {
  console.error(JSON.stringify({ ok: false, status: 'VERIFIER_ERROR', error: error.message }, null, 2));
  process.exitCode = 1;
}