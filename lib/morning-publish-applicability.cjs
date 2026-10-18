'use strict';
const { execFileSync } = require('child_process');
const BASE = 'd28956a29809e75bbd3c93c9bedd402929f6d47b';
const REVIEWED = '8019f0197ec57f79c4c6b851cdef4ba9c324f6dd';
const PROFILE = 'morning-reviewed-8019-v1';
const GOVERNANCE = ['lib/morning-publish-applicability.cjs', 'scripts/verify-publish-gate.js', 'scripts/test-morning-publish-applicability.cjs',
  'lib/morning-web-release-contract.cjs', 'lib/morning-web-release-runtime.cjs',
  'scripts/test-morning-web-release-contract.cjs', 'scripts/verify-morning-web-release-artifact.cjs',
  'scripts/deploy-production-safe.js', 'scripts/verify-morning-web-live-release.cjs',
  'scripts/postdeploy-dispatch.cjs', 'scripts/test-morning-bounded-release.cjs',
  'scripts/deploy-production-with-release-env.js', 'package.json',
  'lib/morning-release-rehearsal.cjs', 'scripts/prepare-deploy.js',
  'scripts/verify-sync-hard-gate.js', 'scripts/verify-production-mirror-guard.js',
  'scripts/verify-release-root-authority.js', 'scripts/verify-terminal-display-snapshot.js', 'scripts/verify-terminal-desktop-skeleton.js'];
const UNRELATED = ['buySellFieldContractGuard', 'terminal_water_root', 'daytrade_source_host_role'];

// Bounded release profile, not a general dependency inference engine. Every
// business file must be byte-for-byte the independently reviewed morning tree.
// Any further business/shared-source edit requires a new applicability review.
function assess(root, env = process.env) {
  const scope = env.FUMAN_PUBLISH_SCOPE || '';
  if (!scope) return { status: 'FULL_REQUIRED', notApplicable: [] };
  if (scope !== PROFILE) throw new Error('UNKNOWN_PUBLISH_SCOPE');
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 }).trim();
  const head = git('rev-parse', 'HEAD');
  if (!/^[0-9a-f]{40}$/.test(env.FUMAN_RELEASE_SHA || '') || env.FUMAN_RELEASE_SHA !== head) throw new Error('PUBLISH_SCOPE_SHA_MISMATCH');
  if (git('status', '--porcelain', '--untracked-files=all')) throw new Error('PUBLISH_SCOPE_DIRTY');
  git('merge-base', '--is-ancestor', BASE, REVIEWED);
  git('merge-base', '--is-ancestor', REVIEWED, head);
  const changed = git('diff', '--name-only', '--no-renames', REVIEWED, head).split('\n').filter(Boolean);
  const unknown = changed.filter(file => !GOVERNANCE.includes(file));
  if (unknown.length) throw new Error('PUBLISH_SCOPE_UNREVIEWED_CHANGE:' + unknown.join(','));
  if (changed.includes('package.json')) {
    const before = JSON.parse(git('show', `${REVIEWED}:package.json`));
    const after = JSON.parse(git('show', `${head}:package.json`));
    if (after.scripts.postdeploy !== 'node scripts/postdeploy-dispatch.cjs') throw new Error('PUBLISH_SCOPE_PACKAGE_CHANGE');
    after.scripts.postdeploy = before.scripts.postdeploy;
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('PUBLISH_SCOPE_PACKAGE_CHANGE');
  }
  // Bind upstream main to the reviewed release boundary; a newer main cannot
  // silently inherit this exception. A merged exact candidate is also valid.
  const main = git('rev-parse', 'refs/remotes/origin/main');
  const rehearsal = require('./morning-release-rehearsal.cjs').inspect(root, env);
  if (main !== BASE && main !== head && !rehearsal) throw new Error('PUBLISH_SCOPE_MAIN_DRIFT');
  const businessChanges = git('diff', '--name-only', '--no-renames', BASE, REVIEWED).split('\n').filter(Boolean);
  return { status: 'SCOPED', profile: PROFILE, head, base: BASE, reviewedBusinessSha: REVIEWED,
    businessChanges, governanceChanges: changed, notApplicable: UNRELATED,
    reason: 'Exact reviewed morning business tree; unrelated live institution RSI, intraday source readiness and Writer host/process readiness remain independently supervised. Mother Pool handoff is not certified by this release gate.' };
}
module.exports = { assess, PROFILE, BASE, REVIEWED, GOVERNANCE, UNRELATED };
