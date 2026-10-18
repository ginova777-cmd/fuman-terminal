'use strict';
const assert = require('node:assert/strict');
const { CONTRACT: c, verifyObservation } = require('../lib/morning-web-release-contract.cjs');
const good = { head: c.candidate, remote: c.remote, remoteMain: c.sourceMain,
  clean: true, ancestor: true, changedPaths: ['88.html'],
  baseHtml: `prefix\n${c.before}\nsuffix`, candidateHtml: `prefix\n${c.after}\nsuffix`,
  project: { projectId: c.projectId, orgId: c.orgId, projectName: 'fuman-terminal' },
  deployment: { id: c.deploymentId, target: 'production', readyState: 'READY', aliases: [c.alias] },
  liveSha: c.base, liveDeploymentId: c.deploymentId };
assert.equal(verifyObservation(good).ok, true);
assert.equal(verifyObservation(good).deploymentAuthorized, false);
const negatives = [
  ['head', c.sourceMain], ['remote', 'C:/local-clone'], ['remoteMain', c.base],
  ['clean', false], ['ancestor', false], ['changedPaths', ['88.html', 'api/market-ai-live.js']],
  ['candidateHtml', good.candidateHtml + '\nextra'], ['baseHtml', good.baseHtml + c.before],
  ['project', { ...good.project, orgId: 'another-team' }],
  ['deployment', { ...good.deployment, aliases: [] }],
  ['deployment', { ...good.deployment, readyState: 'ERROR' }],
  ['deployment', { ...good.deployment, id: 'new-deployment' }],
  ['liveSha', c.sourceMain], ['liveDeploymentId', 'new-deployment'],
];
for (const [key, value] of negatives) assert.equal(verifyObservation({ ...good, [key]: value }).ok, false, key);
console.log(JSON.stringify({ ok: true, positive: 1, negative: negatives.length, scope: 'isolated_contract_tests' }));
