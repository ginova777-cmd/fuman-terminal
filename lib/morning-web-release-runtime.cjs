'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { CONTRACT: c, verifyObservation } = require('./morning-web-release-contract.cjs');

function capture(command, args, cwd) {
  const r = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true,
    timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`${command}_failed:${r.error?.message || r.stderr || r.status}`);
  return r.stdout;
}
function git(root, args) { return capture('git', args, root).trim(); }
function inspectDeployment(identity, controllerRoot) {
  if (!/^[a-zA-Z0-9.-]+$/.test(identity)) throw new Error('unsafe_deployment_identity');
  const args = ['inspect', identity, '--scope', 'ginova777-9771s-projects', '--format=json'];
  return JSON.parse(process.platform === 'win32'
    ? capture('cmd.exe', ['/d', '/s', '/c', ['vercel.cmd', ...args].join(' ')], controllerRoot)
    : capture('vercel', args, controllerRoot));
}
function inspectAliasBinding(alias, deploymentId, controllerRoot) {
  if (!/^[a-zA-Z0-9.-]+$/.test(alias) || !/^dpl_[a-zA-Z0-9]+$/.test(deploymentId)) throw new Error('unsafe_alias_binding_identity');
  const read = endpoint => {
    const args = ['api', endpoint, '--scope', 'ginova777-9771s-projects', '--raw'];
    return JSON.parse(process.platform === 'win32'
      ? capture('cmd.exe', ['/d', '/s', '/c', ['vercel.cmd', ...args].join(' ')], controllerRoot)
      : capture('vercel', args, controllerRoot));
  };
  return { binding: read(`/v4/aliases/${alias}`), listing: read(`/v2/deployments/${deploymentId}/aliases`) };
}
function archiveArtifact(root, controllerRoot) {
  const entries = capture('git', ['ls-tree', '-r', '-z', c.candidate], root).split('\0').filter(Boolean).map(line => {
    const match = line.match(/^(100644|100755) blob ([0-9a-f]{40})\t([\s\S]+)$/);
    if (!match || path.isAbsolute(match[3]) || match[3].split('/').includes('..')) throw new Error('artifact_unsafe_tree_entry');
    return { sha: match[2], file: match[3] };
  });
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'fuman-morning-web-'));
  const archive = path.join(stage, 'source.tar');
  capture('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'archive', '--format=tar', `--output=${archive}`, c.candidate], root);
  const payload = path.join(stage, 'payload');
  fs.mkdirSync(payload);
  capture('tar', ['-xf', archive, '-C', payload], controllerRoot);
  for (const entry of entries) {
    const file = path.join(payload, entry.file);
    if (!fs.lstatSync(file).isFile()) throw new Error(`archive_non_regular_file:${entry.file}`);
    const bytes = fs.readFileSync(file);
    const sha = crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
    if (sha !== entry.sha) throw new Error(`archive_blob_mismatch:${entry.file}`);
  }
  return { stage, archive, payload, trackedFilesVerified: entries.length };
}
function validateApproval(a, head, now = Date.now()) {
  if (a?.schema !== 'morning-dual-target-approval-v1' || a.action !== 'deploy-morning-web-only' ||
      !/^[0-9a-f]{40}$/.test(head) || a.controllerSha !== head || a.websiteSha !== c.candidate ||
      a.previousDeploymentId !== c.deploymentId || a.approved !== true ||
      !a.owner || !a.authorizationEvidence || !Number.isFinite(Date.parse(a.expiresAt)) ||
      Date.parse(a.expiresAt) <= now) throw new Error('exact_owner_approval_missing_or_expired');
}

async function prepare(controllerRoot, artifactRoot, approvalFile) {
  const root = fs.realpathSync(artifactRoot);
  const head = git(controllerRoot, ['rev-parse', 'HEAD']);
  const approval = JSON.parse(fs.readFileSync(approvalFile, 'utf8').replace(/^\uFEFF/, ''));
  validateApproval(approval, head);
  if (git(controllerRoot, ['remote', 'get-url', 'origin']) !== c.remote) throw new Error('controller_remote_mismatch');
  const remoteMain = git(controllerRoot, ['ls-remote', '--exit-code', 'origin', 'refs/heads/main']).split(/\s+/)[0];
  if (remoteMain !== head) throw new Error('controller_not_remote_main');
  git(controllerRoot, ['merge-base', '--is-ancestor', c.sourceMain, head]);
  if (git(root, ['remote', 'get-url', 'origin']) !== c.remote) throw new Error('artifact_remote_mismatch');
  // Exact branch identity is required independently of a local HEAD or stale tracking ref.
  const remoteArtifact = git(root, ['ls-remote', '--exit-code', 'origin', 'refs/heads/agent/morning-web-minimal-20261018']).split(/\s+/)[0];
  if (remoteArtifact !== c.candidate) throw new Error('artifact_not_remote_frozen_candidate');
  git(root, ['merge-base', '--is-ancestor', c.base, 'HEAD']);
  const project = JSON.parse(fs.readFileSync(path.join(root, '.vercel/project.json'), 'utf8'));
  // Query the alias, not just the old deployment ID, so a moved alias fails closed.
  const deployment = inspectDeployment(c.alias, controllerRoot);
  const response = await fetch(`https://${c.alias}/api/release-manifest`, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (!response.ok) throw new Error(`live_manifest_http_${response.status}`);
  const manifest = await response.json();
  const observation = { head: git(root, ['rev-parse', 'HEAD']), remote: c.remote, remoteMain,
    clean: !git(root, ['status', '--porcelain=v1', '--untracked-files=all']), ancestor: true,
    changedPaths: git(root, ['diff', '--name-only', c.base, 'HEAD']).split(/\r?\n/).filter(Boolean),
    baseHtml: capture('git', ['show', `${c.base}:88.html`], root),
    candidateHtml: capture('git', ['show', 'HEAD:88.html'], root), project, deployment,
    liveSha: manifest.gitSha, liveDeploymentId: manifest.deployId };
  const result = verifyObservation(observation, { expectedMain: head });
  if (!result.ok) throw new Error(result.issues.join(','));
  // Archive a commit rather than copy a worktree: ignored local files cannot be uploaded.
  const { stage, archive, payload, trackedFilesVerified } = archiveArtifact(root, controllerRoot);
  fs.mkdirSync(path.join(payload, '.vercel'), { recursive: true });
  fs.writeFileSync(path.join(payload, '.vercel/project.json'), JSON.stringify(project));
  const finalDeployment = inspectDeployment(c.alias, controllerRoot);
  if (finalDeployment.id !== c.deploymentId || finalDeployment.readyState !== 'READY' ||
      finalDeployment.target !== 'production' || !finalDeployment.aliases?.includes(c.alias)) throw new Error('alias_changed_during_preparation');
  validateApproval(approval, git(controllerRoot, ['rev-parse', 'HEAD']));
  const evidence = { ...result, checkedAt: new Date().toISOString(), controllerSha: head,
    cloudEvidenceMode: 'authenticated_live_alias', deployment, manifest,
    archiveSha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), trackedFilesVerified,
    payload, approvalFile: path.resolve(approvalFile), deploymentAuthorized: true };
  fs.writeFileSync(path.join(stage, 'preflight.json'), JSON.stringify(evidence, null, 2));
  return { payload, stage, websiteSha: c.candidate, approval };
}
module.exports = { prepare, validateApproval, archiveArtifact, inspectDeployment, inspectAliasBinding };
