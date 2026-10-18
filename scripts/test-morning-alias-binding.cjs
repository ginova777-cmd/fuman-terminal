'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { verifyAliasBinding } = require('../lib/morning-alias-binding.cjs');
const fixtureRoot = process.argv[2];
if (!fixtureRoot) throw new Error('saved_api_evidence_required');
const input = {
  alias: 'fuman-terminal.vercel.app',
  deploymentId: 'dpl_AzqFky3AVDLacWqVQUVcwcQ4kU17',
  deploymentUrl: 'fuman-terminal-9ige18yll-ginova777-9771s-projects.vercel.app',
  projectId: 'prj_x0R2mMFsL0Xto4whcbPTKQTKJRUl',
  binding: JSON.parse(fs.readFileSync(`${fixtureRoot}/alias-api.json`, 'utf8').replace(/^\uFEFF/, '')),
  listing: JSON.parse(fs.readFileSync(`${fixtureRoot}/deployment-aliases-api.json`, 'utf8').replace(/^\uFEFF/, '')),
};
assert.equal(verifyAliasBinding(input), true);
const mutations = [
  x => { x.binding.deploymentId = 'dpl_old'; },
  x => { x.binding.projectId = 'other'; },
  x => { x.binding.alias = 'other.vercel.app'; },
  x => { x.binding.deployment.id = 'dpl_old'; },
  x => { x.binding.deployment.url = 'other.vercel.app'; },
  x => { x.binding.redirect = 'other.vercel.app'; },
  x => { x.listing.aliases = []; },
  x => { x.listing.aliases.push(x.listing.aliases.find(a => a.alias === x.alias)); },
  x => { x.listing.aliases.find(a => a.alias === x.alias).redirect = 'other.vercel.app'; },
  x => { x.listing.pagination = { next: 1 }; },
  x => { delete x.binding; },
  x => { delete x.listing; },
];
for (const mutate of mutations) {
  const x = structuredClone(input); mutate(x);
  assert.throws(() => verifyAliasBinding(x));
}
console.log(JSON.stringify({ ok: true, tests: mutations.length + 1, scope: 'isolated_alias_binding_only', naturalScanVerified: false }));
