'use strict';
// Shared by package construction, PowerShell approval, Owner and checkout core.
// This mode is deliberately limited to the Strategy4 verifier hotfix.
const fs = require('node:fs');
const cp = require('node:child_process');
const REPOSITORY = 'ginova777-cmd/fuman-terminal';
const FILE = 'scripts/verify-strategy4-contract.js';
const sha = x => typeof x === 'string' && /^[a-f0-9]{40}$/.test(x);
const digest = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
function check(ok, reason) { if (!ok) throw Error(reason); }
function mode(c) {
  const value = c.release_mode === undefined ? 'main' : c.release_mode;
  check(value === 'main' || value === 'strategy4-exact-hotfix-v1', 'RELEASE_MODE_INVALID');
  return value;
}
function validate(c, approval = false) {
  if (mode(c) === 'main') {
    if (approval) check(c.formal_apply_authorized === true && c.release_approved === true &&
      c.remote_main_verified === true && !!c.final_sha_after_merge && c.target === c.final_sha_after_merge,
    'FORMAL_APPROVAL_REQUIRED');
    return;
  }
  check(sha(c.target) && sha(c.expected) && c.target !== c.expected &&
    c.applicationTargetSha === c.target && c.hotfix_base_sha === c.expected &&
    c.rollback === c.expected && sha(c.releaseToolSha), 'HOTFIX_EXACT_IDENTITY_REQUIRED');
  check(c.hotfix_repository === REPOSITORY &&
    typeof c.hotfix_ref === 'string' && /^refs\/heads\/agent\/strategy4-contract-[a-z0-9-]+$/.test(c.hotfix_ref) &&
    Number.isSafeInteger(c.hotfix_pr) && c.hotfix_pr > 0, 'HOTFIX_REMOTE_IDENTITY_REQUIRED');
  check(digest(c.hotfix_blob_sha256) && digest(c.hotfix_checkout_sha256) && digest(c.diff_sha256) && digest(c.manifest_sha256), 'HOTFIX_HASH_REQUIRED');
  check(c.remote_main_verified === false && c.final_sha_after_merge === null, 'HOTFIX_MUST_NOT_IMPERSONATE_MAIN');
  if (approval) check(c.formal_apply_authorized === true && c.release_approved === true &&
    c.hotfix_approved === true && c.release_tool_approved_sha === c.releaseToolSha, 'HOTFIX_APPROVAL_REQUIRED');
}
function validateManifest(c, m) {
  if (mode(c) === 'main') return;
  validate(c);
  check(m.production_sha === c.expected && m.final_sha === c.target && Array.isArray(m.files) &&
    m.files.length === 1 && m.files[0].file === FILE &&
    m.files[0].sha256 === c.hotfix_blob_sha256 && Number.isSafeInteger(m.files[0].bytes) && m.files[0].bytes > 0,
  'HOTFIX_SINGLE_FILE_SCOPE_REQUIRED');
}
function verifyRemote(c, observed) {
  validate(c, true);
  check(observed && observed.repository === c.hotfix_repository && observed.ref === c.hotfix_ref &&
    observed.refSha === c.target && observed.prNumber === c.hotfix_pr && observed.prHeadSha === c.target &&
    observed.prHeadRef === c.hotfix_ref.slice('refs/heads/'.length) &&
    observed.prRepository === c.hotfix_repository && observed.prBaseRepository === c.hotfix_repository &&
    observed.prBaseRef === 'main' && observed.prState === 'open' && observed.prDraft === false,
  'HOTFIX_REMOTE_OR_PR_DRIFT');
}
function observeRemote(c) {
  validate(c, true);
  const read = endpoint => JSON.parse(cp.execFileSync('gh', ['api', endpoint],
    {encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024, windowsHide: true}));
  const ref = read(`repos/${REPOSITORY}/git/ref/${c.hotfix_ref.slice(5)}`);
  const pr = read(`repos/${REPOSITORY}/pulls/${c.hotfix_pr}`);
  return {repository: REPOSITORY, ref: ref.ref, refSha: ref.object?.sha,
    prNumber: pr.number, prHeadSha: pr.head?.sha, prHeadRef: pr.head?.ref,
    prRepository: pr.head?.repo?.full_name, prBaseRepository: pr.base?.repo?.full_name,
    prBaseRef: pr.base?.ref, prState: pr.state, prDraft: pr.draft};
}
function verifySource(c, text, remote) {
  validate(c, true);
  const branch = c.hotfix_ref.slice('refs/heads/'.length);
  check(text(c.source, 'branch', '--show-current') === branch, 'HOTFIX_SOURCE_BRANCH_DRIFT');
  check(text(c.source, 'remote', 'get-url', 'origin') === `https://github.com/${REPOSITORY}.git`, 'HOTFIX_ORIGIN_DRIFT');
  check(text(c.source, 'rev-parse', 'HEAD') === c.target &&
    text(c.source, 'rev-parse', `refs/remotes/origin/${branch}`) === c.target, 'HOTFIX_SOURCE_TARGET_DRIFT');
  // Single parent at the approved deployed base: no unrelated merge history.
  check(text(c.source, 'rev-list', '--parents', '-n', '1', c.target) === `${c.target} ${c.expected}`, 'HOTFIX_PARENT_DRIFT');
  check(text(c.source, 'ls-tree', c.target, '--', FILE).startsWith('100644 blob '), 'HOTFIX_REGULAR_FILE_REQUIRED');
  verifyRemote(c, remote());
}
if (require.main === module) {
  try {
    check(process.argv.length === 4 && process.argv[2] === '--approval', 'APPROVAL_CONTRACT_ARGUMENTS');
    validate(JSON.parse(fs.readFileSync(process.argv[3], 'utf8').replace(/^\uFEFF/, '')), true);
    process.stdout.write(JSON.stringify({ok: true}));
  } catch (e) { process.stderr.write(e.message); process.exitCode = 1; }
}
module.exports = {mode, validate, validateManifest, verifyRemote, observeRemote, verifySource, FILE};
