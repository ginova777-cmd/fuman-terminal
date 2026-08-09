'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WRITER = path.join(ROOT, 'scripts', 'write-daytrade-warmup-checkpoint.js');
const DATE_KEY = '20260806';
const ISO_DATE = '2026-08-06';

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, payload) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function makeBaseEvidence(phase, overrides = {}) {
  return {
    phase,
    checked_at: phase === '0845' ? '2026-08-06T00:45:00.000Z' : '2026-08-05T23:00:00.000Z',
    trade_date: ISO_DATE,
    naturalScheduleEvidence: true,
    manualVerificationOnly: false,
    daytradeGateGrade: 'A',
    priorityGateGrade: 'A',
    priorityPoolSymbols: 40,
    priorityFreshQuoteCoverage120s: 1,
    priorityFreshQuotes120s: 40,
    quoteAgeSeconds: 12,
    scannerCanRunOpening: true,
    formalEntrySpeedVerdict: 'YES',
    readyMa20Continuous: 1200,
    readyMa35Continuous: 1200,
    issues: [],
    selfHealRecovered: false,
    preservePreviousGood: false,
    ...overrides,
  };
}

function buildFixture(base, name, { phase = '0700', pass, failures = [], failureCodes = [], evidenceOverrides = {} }) {
  const stateDir = path.join(base, name, 'state');
  const outputDir = path.join(base, name, 'out');
  const artifactFile = path.join(base, name, 'artifact-' + phase + '.json');
  const evidence = makeBaseEvidence(phase, evidenceOverrides);
  writeJson(artifactFile, { natural_schedule_evidence: true, evidence, trade_date: ISO_DATE });
  writeJson(path.join(stateDir, 'daytrade-warmup-unattended-summary-' + DATE_KEY + '.json'), {
    summary_type: 'daytrade_warmup_unattended_summary_v1',
    ok: pass,
    unattended_yes: pass ? 'YES' : 'NO',
    trade_date: ISO_DATE,
    policy_decision: pass ? 'ALLOW_TODAY_FORMAL_PUBLISH' : 'WAIT_FOR_NATURAL_EVIDENCE',
    preserve_previous_good: !pass,
    self_heal_recovered: false,
    natural_warmup_ok: pass,
    phase_results: {
      [phase]: {
        pass,
        failures,
        failure_codes: failureCodes,
        natural_schedule_evidence: true,
        evidence,
        artifact: artifactFile,
      },
    },
    artifact_paths: {
      [phase]: artifactFile,
    },
  });
  return { stateDir, outputDir, artifactFile };
}

function runWriter(fixture, checkpointPhase = '0705') {
  const result = spawnSync(process.execPath, ['--use-system-ca', WRITER, '--phase=' + checkpointPhase, '--expected-date=' + DATE_KEY], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    env: {
      ...process.env,
      FUMAN_RUNTIME_DIR: path.dirname(fixture.stateDir),
      FUMAN_WARMUP_STATE_DIR: fixture.stateDir,
      FUMAN_WARMUP_OUTPUT_DIR: fixture.outputDir,
    },
  });
  const receiptFile = path.join(fixture.outputDir, 'daytrade-warmup-checkpoint-' + DATE_KEY + '-' + checkpointPhase + '.json');
  return {
    exitCode: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    receipt: fs.existsSync(receiptFile) ? readJson(receiptFile) : null,
    receiptFile,
  };
}

function assert(condition, issue, issues, details = {}) {
  if (!condition) issues.push({ issue, details });
}

function main() {
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'fuman-warmup-checkpoint-contract-'));
  const issues = [];
  try {
    const notReadyFixture = buildFixture(tempBase, 'natural-evidence-but-not-formal-pass', {
      pass: false,
      failures: ['daytradeGateGrade:B', 'scannerCanRunOpening_false', 'formalEntrySpeedVerdict:NO'],
      failureCodes: ['GATE_NOT_A', 'SCANNER_OPENING_FALSE', 'FORMAL_VERDICT_NO'],
      evidenceOverrides: {
        daytradeGateGrade: 'B',
        priorityGateGrade: 'B',
        scannerCanRunOpening: false,
        formalEntrySpeedVerdict: 'NO',
        preservePreviousGood: true,
      },
    });
    const notReady = runWriter(notReadyFixture);
    assert(notReady.exitCode === 0, 'not_ready_writer_exit_nonzero', issues, notReady);
    assert(notReady.receipt && notReady.receipt.status === 'FAIL', 'not_ready_checkpoint_must_fail', issues, notReady.receipt || {});
    assert(notReady.receipt && notReady.receipt.ok === false, 'not_ready_checkpoint_ok_must_be_false', issues, notReady.receipt || {});
    assert(notReady.receipt && notReady.receipt.naturalScheduleEvidence === true, 'not_ready_checkpoint_should_keep_natural_evidence', issues, notReady.receipt || {});
    assert(notReady.receipt && notReady.receipt.formalWarmupPass === false, 'not_ready_checkpoint_formal_pass_must_be_false', issues, notReady.receipt || {});
    assert(notReady.receipt && notReady.receipt.naturalSuccess === false, 'not_ready_checkpoint_natural_success_must_be_false', issues, notReady.receipt || {});
    assert((notReady.receipt?.failures || []).some((item) => String(item).includes('formal_warmup_phase_not_pass')), 'not_ready_checkpoint_missing_formal_failure', issues, notReady.receipt || {});

    const passFixture = buildFixture(tempBase, 'formal-pass', {
      pass: true,
      failures: [],
      failureCodes: [],
    });
    const formalPass = runWriter(passFixture);
    assert(formalPass.exitCode === 0, 'pass_writer_exit_nonzero', issues, formalPass);
    assert(formalPass.receipt && formalPass.receipt.status === 'PASS', 'pass_checkpoint_must_pass', issues, formalPass.receipt || {});
    assert(formalPass.receipt && formalPass.receipt.ok === true, 'pass_checkpoint_ok_must_be_true', issues, formalPass.receipt || {});
    assert(formalPass.receipt && formalPass.receipt.naturalScheduleEvidence === true, 'pass_checkpoint_natural_evidence_missing', issues, formalPass.receipt || {});
    assert(formalPass.receipt && formalPass.receipt.formalWarmupPass === true, 'pass_checkpoint_formal_pass_missing', issues, formalPass.receipt || {});
    assert(formalPass.receipt && formalPass.receipt.naturalSuccess === true, 'pass_checkpoint_natural_success_missing', issues, formalPass.receipt || {});

    const notReady0845Fixture = buildFixture(tempBase, '0845-natural-evidence-but-not-formal-pass', {
      phase: '0845',
      pass: false,
      failures: ['priorityFreshQuoteCoverage120s:0.9', 'formalEntrySpeedVerdict:NO'],
      failureCodes: ['PRIORITY_COVERAGE_LT_095', 'FORMAL_VERDICT_NO'],
      evidenceOverrides: {
        priorityFreshQuoteCoverage120s: 0.9,
        formalEntrySpeedVerdict: 'NO',
        preservePreviousGood: true,
      },
    });
    const notReady0845 = runWriter(notReady0845Fixture, '0847');
    assert(notReady0845.exitCode === 0, 'not_ready_0845_writer_exit_nonzero', issues, notReady0845);
    assert(notReady0845.receipt && notReady0845.receipt.status === 'FAIL', 'not_ready_0845_checkpoint_must_fail', issues, notReady0845.receipt || {});
    assert(notReady0845.receipt && notReady0845.receipt.naturalScheduleEvidence === true, 'not_ready_0845_checkpoint_should_keep_natural_evidence', issues, notReady0845.receipt || {});
    assert(notReady0845.receipt && notReady0845.receipt.formalWarmupPass === false, 'not_ready_0845_checkpoint_formal_pass_must_be_false', issues, notReady0845.receipt || {});
    assert(notReady0845.receipt && notReady0845.receipt.naturalSuccess === false, 'not_ready_0845_checkpoint_natural_success_must_be_false', issues, notReady0845.receipt || {});

    const pass0845Fixture = buildFixture(tempBase, '0845-formal-pass', {
      phase: '0845',
      pass: true,
      failures: [],
      failureCodes: [],
    });
    const formalPass0845 = runWriter(pass0845Fixture, '0847');
    assert(formalPass0845.exitCode === 0, 'pass_0845_writer_exit_nonzero', issues, formalPass0845);
    assert(formalPass0845.receipt && formalPass0845.receipt.status === 'PASS', 'pass_0845_checkpoint_must_pass', issues, formalPass0845.receipt || {});
    assert(formalPass0845.receipt && formalPass0845.receipt.formalWarmupPass === true, 'pass_0845_checkpoint_formal_pass_missing', issues, formalPass0845.receipt || {});
    assert(formalPass0845.receipt && formalPass0845.receipt.naturalSuccess === true, 'pass_0845_checkpoint_natural_success_missing', issues, formalPass0845.receipt || {});

    const payload = {
      ok: issues.length === 0,
      contract: 'daytrade-warmup-checkpoint-contract-v1',
      checkedAt: new Date().toISOString(),
      cases: {
        naturalEvidenceButNotFormalPass: notReady.receipt,
        formalPass: formalPass.receipt,
        naturalEvidenceButNotFormalPass0845: notReady0845.receipt,
        formalPass0845: formalPass0845.receipt,
      },
      issues,
    };
    console.log(JSON.stringify(payload, null, 2));
    if (issues.length > 0) process.exit(1);
  } finally {
    try { fs.rmSync(tempBase, { recursive: true, force: true }); } catch {}
  }
}

main();
