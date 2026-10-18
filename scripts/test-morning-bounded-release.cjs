'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { validateApproval } = require('../lib/morning-web-release-runtime.cjs');
const { CONTRACT: c } = require('../lib/morning-web-release-contract.cjs');
const root = path.resolve(__dirname, '..');
const head = 'a'.repeat(40);
const approval = { schema: 'morning-dual-target-approval-v1', action: 'deploy-morning-web-only',
  controllerSha: head, websiteSha: c.candidate, previousDeploymentId: c.deploymentId,
  approved: true, owner: 'ISOLATED_TEST_OWNER', authorizationEvidence: 'FIXTURE_NOT_FORMAL_APPROVAL',
  expiresAt: new Date(Date.now() + 60000).toISOString() };
validateApproval(approval, head);
for (const changed of [{ approved: false }, { controllerSha: c.base }, { websiteSha: c.base },
  { previousDeploymentId: 'unknown' }, { owner: '' }, { authorizationEvidence: '' }, { expiresAt: 'invalid' },
  { expiresAt: '2000-01-01T00:00:00Z' }, { action: 'deploy-everything' }]) {
  assert.throws(() => validateApproval({ ...approval, ...changed }, head));
}
async function scenario({ bounded = true, fail = '', prepareFail = false, wrongMain = false, expired = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'morning-release-test-'));
  const calls = [];
  const env = { FUMAN_DEPLOY_LOCK_FILE: path.join(dir, 'lock.json'), FUMAN_DEPLOY_LAST_FILE: path.join(dir, 'last.json'),
    FUMAN_PRODUCTION_WINDOW_GO: '1', FUMAN_APPROVED_DEPLOY_SOURCE_ROOT: root, FUMAN_RELEASE_OWNER_EMERGENCY_GO: '1',
    FUMAN_PUBLISH_SCOPE: 'morning-reviewed-8019-v1', FUMAN_RELEASE_SHA: head };
  if (bounded) env.FUMAN_MORNING_WEB_ARTIFACT_ROOT = 'ISOLATED_FIXTURE';
  const fakeProcess = { env, execPath: process.execPath, pid: process.pid, exitCode: 0, exit: n => { throw Error(`exit:${n}`); } };
  const fakeSpawn = (cmd, args, options) => {
    if (cmd === 'git') return { status: 0, stdout: args[0] === 'status' ? '' : (wrongMain && args[1] === 'origin/main' ? c.base : head) };
    calls.push({ cmd, args, options });
    return { status: args.some(a => a.includes(fail)) && fail ? 1 : 0 };
  };
  const context = { __dirname, process: fakeProcess, console: { log() {}, warn() {}, error() {} },
    require: name => name === 'child_process' ? { spawnSync: fakeSpawn }
      : name === '../lib/morning-web-release-runtime.cjs' ? { validateApproval, prepare: async () => {
        if (prepareFail) throw Error('fixture_approval_failure');
        return { payload: path.join(dir, 'payload'), stage: dir, websiteSha: c.candidate,
          approval: expired ? { ...approval, expiresAt: '2000-01-01T00:00:00Z' } : approval };
      } } : require(name) };
  vm.createContext(context);
  const code = fs.readFileSync(path.join(__dirname, 'deploy-production-safe.js'), 'utf8');
  vm.runInContext(code.replace(/main\(\);\s*$/, 'globalThis.finished = main();'), context);
  await context.finished;
  assert.equal(fs.existsSync(env.FUMAN_DEPLOY_LOCK_FILE), false);
  return { calls, code: fakeProcess.exitCode, last: fs.existsSync(env.FUMAN_DEPLOY_LAST_FILE) };
}
async function readbackScenario({ wrongAlias = false, wrongManifest = false, wrongAsset = false } = {}) {
  const fresh = { id: 'dpl_TEST_NEW', name: 'fuman-terminal', url: 'fuman-terminal-test.vercel.app',
    contextName: 'ginova777-9771s-projects', target: 'production', readyState: 'READY', aliases: [c.alias] };
  const uploaded = { deploymentUrl: fresh.url, releaseSha: c.candidate, uploadedAt: new Date().toISOString() };
  const fakeProcess = { env: { FUMAN_MORNING_WEB_ARTIFACT_ROOT: 'FIXTURE' }, cwd: () => root, exitCode: 0 };
  const saved = [];
  const fakeFs = { readFileSync: () => JSON.stringify(uploaded), mkdirSync() {}, writeFileSync: (p, b) => saved.push(JSON.parse(b)) };
  const ctx = { process: fakeProcess, console: { log() {}, error() {} }, AbortSignal,
    fetch: async url => ({ ok: true, text: async () => url.endsWith('/api/release-manifest')
      ? JSON.stringify({ gitSha: c.candidate, deployId: wrongManifest ? 'logical-id' : fresh.id, deploymentUrl: fresh.url })
      : wrongAsset ? 'incorrect asset' : 'FIXTURE_ASSET' }),
    require: name => name === 'node:fs' ? fakeFs
      : name === 'node:child_process' ? { execFileSync: (cmd, args) => args.includes('rev-parse') ? c.candidate : 'FIXTURE_ASSET' }
      : name === '../lib/morning-web-release-runtime.cjs' ? { inspectDeployment: identity =>
        wrongAlias && identity === c.alias ? { ...fresh, id: 'dpl_OTHER' } : fresh }
      : name === '../lib/morning-web-release-contract.cjs' ? { CONTRACT: c } : require(name) };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'verify-morning-web-live-release.cjs'), 'utf8')
    .replace('main().catch(', 'globalThis.finished = main().catch('), ctx);
  await ctx.finished;
  return { code: fakeProcess.exitCode, saved };
}
(async () => {
  const good = await scenario();
  assert.equal(good.code, 0); assert.equal(good.last, true);
  const deploy = good.calls.find(x => x.args.some(a => a.endsWith('deploy-production-with-release-env.js')));
  assert.equal(deploy.options.env.FUMAN_RELEASE_SHA, c.candidate);
  assert(deploy.options.cwd.endsWith('payload'));
  for (const gate of ['supabase-incident-guard', 'verify-sync-hard-gate', 'verify-vercel-cost-guard',
    'verify-vercel-project-inventory', 'require-version-bump-approval', 'verify-release-root-authority', 'verify-publish-gate']) {
    const r = await scenario({ fail: gate });
    assert.equal(r.code, 1, gate); assert.equal(r.last, false);
    assert(!r.calls.some(x => x.args.some(a => a.endsWith('deploy-production-with-release-env.js'))), gate);
  }
  for (const flags of [{ prepareFail: true }, { wrongMain: true }, { expired: true }]) {
    const r = await scenario(flags); assert.equal(r.code, 1); assert.equal(r.last, false);
    assert(!r.calls.some(x => x.args.some(a => a.endsWith('deploy-production-with-release-env.js'))));
  }
  for (const fail of ['deploy-production-with-release-env', 'verify-morning-web-live-release']) {
    const r = await scenario({ fail }); assert.equal(r.code, 1); assert.equal(r.last, false);
  }
  const full = await scenario({ bounded: false });
  assert.equal(full.code, 0);
  assert(!full.calls.some(x => x.args.some(a => a.includes('verify-morning-web-live-release'))));
  assert.equal((await readbackScenario()).code, 0);
  for (const flags of [{ wrongAlias: true }, { wrongManifest: true }, { wrongAsset: true }]) {
    const result = await readbackScenario(flags);
    assert.equal(result.code, 1); assert.equal(result.saved.length, 0);
  }
  console.log(JSON.stringify({ ok: true, scope: 'isolated_actual_entry_with_process_and_cloud_fixtures',
    approvalNegativeCases: 9, orchestrationScenarios: 14, postdeployScenarios: 4, productionDeployment: false }));
})().catch(e => { console.error(e); process.exitCode = 1; });
