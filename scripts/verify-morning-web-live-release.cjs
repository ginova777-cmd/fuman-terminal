'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { CONTRACT: c } = require('../lib/morning-web-release-contract.cjs');
const { inspectDeployment } = require('../lib/morning-web-release-runtime.cjs');
async function main() {
  const root = process.env.FUMAN_MORNING_WEB_ARTIFACT_ROOT;
  if (!root) throw new Error('morning_artifact_root_missing');
  const sha = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 15000 }).trim();
  if (sha !== c.candidate) throw new Error('artifact_sha_mismatch');
  const uploaded = JSON.parse(fs.readFileSync(path.resolve('outputs/morning-bounded-release/last-upload.json'), 'utf8'));
  if (uploaded.releaseSha !== c.candidate || !Number.isFinite(Date.parse(uploaded.uploadedAt)) ||
      Date.now() - Date.parse(uploaded.uploadedAt) > 30 * 60 * 1000 || Date.parse(uploaded.uploadedAt) > Date.now()) throw new Error('upload_evidence_stale_or_mismatched');
  const created = inspectDeployment(uploaded.deploymentUrl, process.cwd());
  const aliased = inspectDeployment(c.alias, process.cwd());
  if (!created.id || created.id === c.deploymentId || aliased.id !== created.id ||
      aliased.url !== uploaded.deploymentUrl || aliased.name !== 'fuman-terminal' ||
      aliased.contextName !== 'ginova777-9771s-projects' || aliased.target !== 'production' ||
      aliased.readyState !== 'READY' || !aliased.aliases?.includes(c.alias)) throw new Error('new_deployment_alias_mismatch');
  const read = async route => {
    const r = await fetch(`https://${c.alias}${route}`, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`readback_http_${r.status}:${route}`);
    return r.text();
  };
  const manifest = JSON.parse(await read('/api/release-manifest'));
  if (manifest.gitSha !== c.candidate || manifest.deployId !== created.id || manifest.deploymentUrl !== uploaded.deploymentUrl) throw new Error('live_release_identity_mismatch');
  const files = ['88.html', 'terminal-opening-report-view.js', 'morning-scorecard-view.js'];
  const hashes = [];
  for (const file of files) {
    const expected = execFileSync('git', ['-C', root, 'show', `${c.candidate}:${file}`], { encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 }).replace(/\r\n/g, '\n');
    const actual = (await read(file === '88.html' ? '/88' : `/${file}`)).replace(/\r\n/g, '\n');
    if (actual !== expected) throw new Error(`live_asset_mismatch:${file}`);
    hashes.push({ file, normalizedSha256: crypto.createHash('sha256').update(actual).digest('hex') });
  }
  const dir = path.resolve('outputs/morning-bounded-release', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const result = { ok: true, scope: 'website_release_identity_and_assets_only', manifest, deployment: aliased, hashes,
    naturalScanVerified: false, motherPoolVerified: false, checkedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, 'live-readback.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
