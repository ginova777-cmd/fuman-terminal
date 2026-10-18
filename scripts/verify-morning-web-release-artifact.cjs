'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CONTRACT: c, verifyObservation } = require('../lib/morning-web-release-contract.cjs');

function main(args) {
  const [rootArg, deploymentFile, manifestFile] = args;
  if (!rootArg || !deploymentFile || !manifestFile) throw new Error('usage: artifact-root authenticated-deployment.json live-manifest.json');
  const root = fs.realpathSync(rootArg);
  function git(argv, trim = true) {
    const r = spawnSync('git', argv, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 8 * 1024 * 1024 });
    if (r.error || r.status !== 0) throw new Error(`git_failed:${argv[0]}:${r.error?.message || r.stderr}`);
    return trim ? r.stdout.trim() : r.stdout;
  }
  const origin = git(['remote', 'get-url', 'origin']);
  // Validate the remote before contacting it; never trust an arbitrary clone URL.
  if (origin !== c.remote) throw new Error('artifact_remote_mismatch');
  const remoteMain = git(['ls-remote', '--exit-code', 'origin', 'refs/heads/main']).split(/\s+/)[0];
  git(['merge-base', '--is-ancestor', c.base, 'HEAD']);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8').replace(/^\uFEFF/, ''));
  const observation = {
    head: git(['rev-parse', 'HEAD']), remote: origin, remoteMain,
    clean: !git(['status', '--porcelain=v1', '--untracked-files=all']), ancestor: true,
    changedPaths: git(['diff', '--name-only', c.base, 'HEAD']).split(/\r?\n/).filter(Boolean),
    baseHtml: git(['show', `${c.base}:88.html`], false),
    candidateHtml: git(['show', 'HEAD:88.html'], false),
    project: JSON.parse(fs.readFileSync(path.join(root, '.vercel/project.json'), 'utf8')),
    deployment: JSON.parse(fs.readFileSync(deploymentFile, 'utf8').replace(/^\uFEFF/, '')),
    liveSha: manifest.gitSha, liveDeploymentId: manifest.deployId,
  };
  const result = verifyObservation(observation);
  // Saved cloud evidence is evidence only, never a live alias guard or release permit.
  result.cloudEvidenceMode = 'saved_observation';
  result.artifactRoot = root;
  result.checkedAt = new Date().toISOString();
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}
try { process.exitCode = main(process.argv.slice(2)); }
catch (e) { console.error(JSON.stringify({ ok: false, deploymentAuthorized: false, error: e.message })); process.exitCode = 1; }
