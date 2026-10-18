'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process'), assert = require('assert/strict');
const { assess, PROFILE, BASE, REVIEWED, GOVERNANCE } = require('../lib/morning-publish-applicability.cjs');
const { main } = require('./verify-publish-gate.js');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'outputs', 'morning-publish-scope', String(Date.now()));
const repo = path.join(out, 'fixture-repo');
fs.mkdirSync(out, { recursive: true });
const git = (...args) => cp.execFileSync('git', args, { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 }).trim();
git('clone', '--shared', '--no-checkout', root, repo);
const g = (...args) => git('-C', repo, ...args);
g('checkout', '--detach', REVIEWED);
g('config', 'user.name', 'Isolated Test'); g('config', 'user.email', 'isolated@example.invalid');
g('update-ref', 'refs/remotes/origin/main', BASE);
for (const file of GOVERNANCE) { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.copyFileSync(path.join(root, file), path.join(repo, file)); }
g('add', '--', ...GOVERNANCE); g('commit', '-m', 'isolated applicability fixture');
const head = g('rev-parse', 'HEAD');
const env = { FUMAN_PUBLISH_SCOPE: PROFILE, FUMAN_RELEASE_SHA: head };
const cases = [];
function test(name, fn) { fn(); cases.push({ name, status: 'PASS' }); }
test('exact_reviewed_tree', () => assert.deepEqual(assess(repo, env).notApplicable, ['buySellFieldContractGuard', 'terminal_water_root']));
test('default_full_scope', () => assert.deepEqual(assess(repo, {}).notApplicable, []));
test('unknown_scope_blocks', () => assert.throws(() => assess(repo, { ...env, FUMAN_PUBLISH_SCOPE: 'morning' }), /UNKNOWN_PUBLISH_SCOPE/));
test('wrong_sha_blocks', () => assert.throws(() => assess(repo, { ...env, FUMAN_RELEASE_SHA: REVIEWED }), /SHA_MISMATCH/));
test('untracked_file_blocks', () => { const f = path.join(repo, 'unknown-dependency.cjs'); fs.writeFileSync(f, 'unknown'); try { assert.throws(() => assess(repo, env), /DIRTY/); } finally { fs.unlinkSync(f); } });
test('tracked_edit_blocks', () => { const f = path.join(repo, '88.html'), b = fs.readFileSync(f); fs.appendFileSync(f, '\n<!-- changed -->'); try { assert.throws(() => assess(repo, env), /DIRTY/); } finally { fs.writeFileSync(f, b); } });
// These process results are explicitly executor fixtures. They test real gate
// orchestration, not production DB, live data, or individual verifier success.
function chain(label, settings, failedScript) {
  const called = [];
  const oldLog = console.log; console.log = () => {};
  try {
    const result = main({ root: repo, env: settings, outputDir: path.join(out, label), execute: (command, args) => {
      called.push(args.join(' ')); return { command, exitCode: failedScript && args.some(a => a.includes(failedScript)) ? 1 : 0, stdout: 'ISOLATED_EXECUTOR_FIXTURE', stderr: '', signal: '', error: '' };
    } });
    return { result, called };
  } finally { console.log = oldLog; }
}
test('scoped_coordinator_receipt', () => {
  const { result, called } = chain('scoped', env);
  assert.equal(result.ok, true);
  assert(!called.some(x => /verify-buy-sell-field-contract|verify-terminal-water-root\.js/.test(x)));
  assert.equal(result.checks.filter(x => x.status === 'NOT_APPLICABLE' && x.exitCode === null && x.executed === false).length, 2);
  for (const name of ['release_root_authority', 'release_handoff_freeze', 'morning_contract', 'morning_regressions', 'membership_e2e_layering', 'scorecard_no_rollback']) assert(result.checks.find(x => x.name === name)?.executed);
});
test('full_scope_still_runs_unrelated_live_gates', () => { const { called } = chain('full', {}); assert(called.some(x => x.includes('verify-buy-sell-field-contract'))); assert(called.some(x => x.includes('verify-terminal-water-root.js'))); });
test('morning_failure_propagates', () => { const { result } = chain('morning-failure', env, 'verify-opening-report-morning-contract.js'); assert.equal(result.ok, false); assert(result.failedChecks.includes('morning_contract')); });
test('shared_gate_failure_propagates', () => { const { result } = chain('shared-failure', env, 'verify-membership-e2e-layering.js'); assert.equal(result.ok, false); });
test('invalid_scope_starts_no_children', () => { const { result, called } = chain('invalid-scope', { ...env, FUMAN_RELEASE_SHA: BASE }); assert.equal(result.ok, false); assert.equal(called.length, 0); });
const packageFile = path.join(repo, 'package.json');
const changedPackage = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
changedPackage.scripts.deploy = 'echo bypass';
fs.writeFileSync(packageFile, JSON.stringify(changedPackage, null, 2));
g('add', 'package.json'); g('commit', '-m', 'isolated unapproved package edit');
test('package_other_script_change_blocks', () => assert.throws(() => assess(repo, { ...env, FUMAN_RELEASE_SHA: g('rev-parse', 'HEAD') }), /PACKAGE_CHANGE/));
g('checkout', '--detach', head);
fs.writeFileSync(path.join(repo, 'unknown-dependency.cjs'), 'module.exports = true;');
g('add', 'unknown-dependency.cjs'); g('commit', '-m', 'isolated unknown dependency');
const changedHead = g('rev-parse', 'HEAD');
test('committed_unknown_dependency_blocks', () => assert.throws(() => assess(repo, { ...env, FUMAN_RELEASE_SHA: changedHead }), /UNREVIEWED_CHANGE/));
g('checkout', '--detach', head);
g('update-ref', 'refs/remotes/origin/main', changedHead);
test('main_drift_blocks', () => assert.throws(() => assess(repo, env), /MAIN_DRIFT/));
g('update-ref', 'refs/remotes/origin/main', head);
test('exact_merged_candidate_supported', () => assert.equal(assess(repo, env).status, 'SCOPED'));
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ scope: 'isolated_git_and_gate_orchestration_with_executor_fixtures', productionAcceptance: false, complete: true, cases }, null, 2));
console.log(JSON.stringify({ complete: true, cases: cases.length, evidence: out }));
