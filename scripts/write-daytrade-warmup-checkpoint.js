'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || 'C:\\fuman-runtime';
const STATE_DIR = process.env.FUMAN_WARMUP_STATE_DIR || path.join(RUNTIME_DIR, 'state');
const OUTPUT_DIR = process.env.FUMAN_WARMUP_OUTPUT_DIR || path.join(ROOT, 'outputs', 'daytrade-warmup-nine-day', 'checkpoints');
const phase = String(process.argv.find((arg) => arg.startsWith('--phase=')) || '').slice('--phase='.length);
const expectedDateArg = String(process.argv.find((arg) => arg.startsWith('--expected-date=')) || '').slice('--expected-date='.length);

function taipeiDateKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/\D/g, '');
}

function normalizeDate(value) {
  const key = String(value || '').replace(/\D/g, '').slice(0, 8);
  if (!/^\d{8}$/.test(key)) throw new Error('invalid expected date');
  return key;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function isWeekend(key) {
  const date = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8))));
  return date.getUTCDay() === 0 || date.getUTCDay() === 6;
}

function artifactCandidates(checkpointPhase, summary) {
  if (checkpointPhase === '0912') return [path.join(RUNTIME_DIR, 'state', 'daytrade-unattended-final-verdict.json')];
  const expectedPhase = checkpointPhase === '0705' ? '0700' : '0845';
  const summaryPath = summary && summary.artifact_paths && summary.artifact_paths[expectedPhase];
  return [
    summaryPath || '',
    path.join('C:\\Users\\ginov\\Documents\\Codex\\buy-sell-autonomy-main', 'outputs', 'daytrade-unattended-gate-' + expectedPhase + '.json'),
    path.join(RUNTIME_DIR, 'state', 'daytrade-unattended-gate-' + expectedPhase + '.json'),
    path.join(ROOT, 'outputs', 'daytrade-unattended-gate-' + expectedPhase + '.json')
  ].filter(Boolean);
}

function main() {
  if (!['0705', '0847', '0912'].includes(phase)) throw new Error('phase must be 0705, 0847, or 0912');
  const dateKey = normalizeDate(expectedDateArg || taipeiDateKey());
  const isoDate = dateKey.slice(0, 4) + '-' + dateKey.slice(4, 6) + '-' + dateKey.slice(6, 8);
  const summaryFile = path.join(STATE_DIR, 'daytrade-warmup-unattended-summary-' + dateKey + '.json');
  const summary = readJson(summaryFile);
  const artifactFiles = artifactCandidates(phase, summary);
  const artifactFile = artifactFiles.find((file) => fs.existsSync(file)) || artifactFiles[0];
  const artifact = readJson(artifactFile);
  const policy = summary && (summary.policy_decision || (summary.ops_policy && summary.ops_policy.policy_decision));
  const closed = isWeekend(dateKey) || policy === 'MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD';
  const expectedNaturalPhase = phase === '0705' ? '0700' : phase === '0847' ? '0845' : null;
  const evidence = artifact && (artifact.evidence || artifact);
  const phaseResult = expectedNaturalPhase && summary && summary.phase_results
    ? summary.phase_results[expectedNaturalPhase]
    : null;
  const phaseEvidence = (phaseResult && phaseResult.evidence) || evidence || {};
  const naturalEvidence = expectedNaturalPhase
    ? Boolean((phaseResult && phaseResult.natural_schedule_evidence === true)
      || (artifact && (artifact.natural_schedule_evidence === true || artifact.naturalScheduleEvidence === true))
      || (phaseEvidence && phaseEvidence.naturalScheduleEvidence === true))
    : false;
  const phasePass = expectedNaturalPhase
    ? Boolean(phaseResult && phaseResult.pass === true
      && phaseResult.natural_schedule_evidence === true
      && phaseEvidence.naturalScheduleEvidence === true
      && phaseEvidence.manualVerificationOnly !== true
      && phaseEvidence.trade_date === isoDate
      && phaseEvidence.daytradeGateGrade === 'A'
      && phaseEvidence.priorityGateGrade === 'A'
      && Number(phaseEvidence.priorityPoolSymbols) === 40
      && Number(phaseEvidence.priorityFreshQuoteCoverage120s) >= 0.95
      && phaseEvidence.scannerCanRunOpening === true
      && phaseEvidence.formalEntrySpeedVerdict === 'YES'
      && phaseResult.selfHealRecovered !== true
      && phaseEvidence.selfHealRecovered !== true)
    : false;
  const failures = [];
  let status = 'PENDING';
  if (closed) {
    status = 'MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD';
  } else if (!artifact && !summary) {
    failures.push('missing_checkpoint_input');
  } else if (expectedNaturalPhase) {
    if (!artifact && !phaseResult) failures.push('missing_phase_artifact');
    if (artifact && artifact.trade_date && artifact.trade_date !== isoDate) failures.push('phase_trade_date_mismatch');
    if (phaseEvidence.trade_date && phaseEvidence.trade_date !== isoDate) failures.push('phase_evidence_trade_date_mismatch');
    if (!naturalEvidence) failures.push('natural_schedule_evidence_missing');
    if (phaseResult && phaseResult.pending === true) failures.push('phase_pending:' + expectedNaturalPhase);
    if (!phasePass) failures.push('formal_warmup_phase_not_pass:' + expectedNaturalPhase);
    if (phaseResult && Array.isArray(phaseResult.failure_codes)) {
      for (const code of phaseResult.failure_codes) failures.push('phase_failure_code:' + code);
    }
    if (phaseResult && Array.isArray(phaseResult.failures)) {
      for (const failure of phaseResult.failures) failures.push('phase_failure:' + failure);
    }
    if (phaseEvidence.daytradeGateGrade && phaseEvidence.daytradeGateGrade !== 'A') failures.push('daytrade_gate_not_A:' + phaseEvidence.daytradeGateGrade);
    if (phaseEvidence.priorityGateGrade && phaseEvidence.priorityGateGrade !== 'A') failures.push('priority_gate_not_A:' + phaseEvidence.priorityGateGrade);
    if (Number.isFinite(Number(phaseEvidence.priorityPoolSymbols)) && Number(phaseEvidence.priorityPoolSymbols) !== 40) failures.push('priority_pool_not_40:' + phaseEvidence.priorityPoolSymbols);
    if (Number.isFinite(Number(phaseEvidence.priorityFreshQuoteCoverage120s)) && Number(phaseEvidence.priorityFreshQuoteCoverage120s) < 0.95) failures.push('priority_fresh_quote_coverage_below_0_95:' + phaseEvidence.priorityFreshQuoteCoverage120s);
    if (phaseEvidence.scannerCanRunOpening !== true) failures.push('scanner_can_run_opening_false');
    if (phaseEvidence.formalEntrySpeedVerdict && phaseEvidence.formalEntrySpeedVerdict !== 'YES') failures.push('formal_entry_speed_verdict_not_yes:' + phaseEvidence.formalEntrySpeedVerdict);
    if (artifact && (artifact.self_heal_recovered === true || evidence && evidence.selfHealRecovered === true)) failures.push('self_heal_cannot_count_as_natural');
    if (phaseResult && phaseResult.selfHealRecovered === true) failures.push('phase_self_heal_cannot_count_as_natural');
    status = failures.length === 0 ? 'PASS' : (phaseResult && phaseResult.pending === true ? 'PENDING' : 'FAIL');
  } else {
    if (!summary) failures.push('missing_final_summary');
    if (summary && summary.trade_date !== isoDate) failures.push('summary_trade_date_mismatch');
    if (summary && summary.unattended_yes !== 'YES') failures.push('unattended_yes_not_confirmed');
    if (summary && summary.natural_warmup_ok !== true) failures.push('natural_warmup_not_ok');
    if (summary && summary.self_heal_recovered === true) failures.push('self_heal_cannot_count_as_natural');
    status = failures.length === 0 ? 'PASS' : 'FAIL';
  }
  const receipt = {
    contract: 'daytrade-warmup-checkpoint-v1',
    checkedAt: new Date().toISOString(),
    checkpointPhase: phase,
    tradeDate: isoDate,
    status,
    ok: status === 'PASS' || status === 'MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD',
    naturalScheduleEvidence: naturalEvidence,
    formalWarmupPass: expectedNaturalPhase ? phasePass : status === 'PASS',
    naturalSuccess: status === 'PASS' && phase !== '0912' && (expectedNaturalPhase ? phasePass : true),
    selfHealRecovered: Boolean((summary && summary.self_heal_recovered === true) || (artifact && artifact.self_heal_recovered === true)),
    preservePreviousGood: closed || Boolean(summary && summary.preserve_previous_good === true),
    policyDecision: policy || '',
    failures,
    readOnly: true,
    inputs: { summary: fs.existsSync(summaryFile) ? summaryFile : '', artifact: fs.existsSync(artifactFile) ? artifactFile : '' }
  };
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const fileName = 'daytrade-warmup-checkpoint-' + dateKey + '-' + phase + '.json';
  fs.writeFileSync(path.join(OUTPUT_DIR, fileName), JSON.stringify(receipt, null, 2));
  fs.writeFileSync(path.join(STATE_DIR, fileName), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ ok: receipt.ok, status: receipt.status, checkpointPhase: phase, tradeDate: isoDate, failures: receipt.failures, output: path.join(OUTPUT_DIR, fileName) }, null, 2));
}

try { main(); } catch (error) {
  console.error(JSON.stringify({ ok: false, status: 'VERIFIER_ERROR', error: error.message }, null, 2));
  process.exitCode = 1;
}