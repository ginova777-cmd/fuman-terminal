'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const BASE = 'c266208f8200d27db0c5b39c3fa50ebc59f59d69';
function inspect(root, env = process.env) {
  if (env.FUMAN_RELEASE_REHEARSAL !== '1') return null;
  const real = fs.realpathSync(root);
  if (real.toLowerCase().startsWith('c:\\fuman-release-owner\\') || env.FUMAN_PRODUCTION_WINDOW_GO === '1') throw Error('REHEARSAL_FORMAL_ROOT_OR_PERMISSION');
  if (env.FUMAN_PUBLISH_SCOPE !== 'morning-reviewed-8019-v1') throw Error('REHEARSAL_SCOPE_REQUIRED');
  const g = (...args) => execFileSync('git', ['-C', real, ...args], { encoding: 'utf8', timeout: 30000, windowsHide: true }).trim();
  const head = g('rev-parse', 'HEAD');
  if (!/^[0-9a-f]{40}$/.test(env.FUMAN_RELEASE_SHA || '') || head !== env.FUMAN_RELEASE_SHA) throw Error('REHEARSAL_SHA_MISMATCH');
  if (g('status', '--porcelain', '--untracked-files=all')) throw Error('REHEARSAL_DIRTY');
  if (g('remote', 'get-url', 'origin') !== 'https://github.com/ginova777-cmd/fuman-terminal.git') throw Error('REHEARSAL_REMOTE_UNTRUSTED');
  if (g('ls-remote', '--exit-code', 'origin', 'refs/heads/main').split(/\s+/)[0] !== BASE) throw Error('REHEARSAL_MAIN_DRIFT');
  g('merge-base', '--is-ancestor', BASE, head);
  const runtime = fs.realpathSync(env.FUMAN_RUNTIME_DIR || '');
  const relative = path.relative(path.join(real, 'outputs'), runtime);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('REHEARSAL_RUNTIME_NOT_ISOLATED');
  return { mode: 'isolated_real_predeploy', head, remoteMain: BASE, productionDeploymentAuthorized: false };
}
module.exports = { inspect, BASE };
