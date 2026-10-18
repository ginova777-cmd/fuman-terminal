'use strict';

// This contract validates an artifact; it never authorizes or performs deployment.
const CONTRACT = Object.freeze({
  schema: 'morning-web-bounded-release-v1',
  sourceMain: 'bc381bbe5bd96682ee04b54768759ca563ad04ee',
  base: 'b2c8185526b85b27822d24d51f580742ed3f363f',
  candidate: 'fc0732149e264087421716ddf6b8b65c9e16a170',
  remote: 'https://github.com/ginova777-cmd/fuman-terminal.git',
  deploymentId: 'dpl_2EwKmF9H2oFbr8aycc6zRZQY4kYe',
  alias: 'fuman-terminal.vercel.app',
  projectId: 'prj_x0R2mMFsL0Xto4whcbPTKQTKJRUl',
  orgId: 'team_HfAXzMLgDcpw6UFbnexhuxHG',
  before: '<script src="/morning-scorecard-view.js"></script>',
  after: '<!-- Morning report is served by desktop/mobile only; other /88 features remain unchanged. -->',
});

function verifyObservation(o) {
  const issues = [];
  const requireValue = (ok, name) => { if (!ok) issues.push(name); };
  requireValue(o.head === CONTRACT.candidate, 'candidate_sha_mismatch');
  requireValue(o.remote === CONTRACT.remote, 'artifact_remote_mismatch');
  requireValue(o.remoteMain === CONTRACT.sourceMain, 'remote_main_drift');
  requireValue(o.clean === true, 'artifact_not_clean');
  requireValue(o.ancestor === true, 'website_base_not_ancestor');
  requireValue(JSON.stringify(o.changedPaths) === JSON.stringify(['88.html']), 'website_scope_mismatch');
  const before = String(o.baseHtml || '');
  requireValue(before.split(CONTRACT.before).length === 2 &&
    o.candidateHtml === before.replace(CONTRACT.before, CONTRACT.after), 'website_patch_mismatch');
  requireValue(o.project?.projectId === CONTRACT.projectId && o.project?.orgId === CONTRACT.orgId &&
    o.project?.projectName === 'fuman-terminal', 'project_identity_mismatch');
  requireValue(o.deployment?.id === CONTRACT.deploymentId && o.deployment?.target === 'production' &&
    o.deployment?.readyState === 'READY' && o.deployment?.aliases?.includes(CONTRACT.alias), 'deployment_baseline_mismatch');
  requireValue(o.liveSha === CONTRACT.base && o.liveDeploymentId === CONTRACT.deploymentId, 'live_manifest_mismatch');
  return { schema: CONTRACT.schema, ok: issues.length === 0, issues,
    artifactSha: o.head, deploymentAuthorized: false,
    scope: 'artifact_preflight_only', requiresFreshCheckBeforeDeployment: true };
}

module.exports = { CONTRACT, verifyObservation };
