'use strict';
const checks = ['payload_bound', 'runtime_bound', 'resource_load', 'natural_write', 'independent_readback', 'freshness', 'page_render', 'page_refresh'];
const independent = require('./daytrade-independent-preopen-modules.cjs');
// A probe is not a restored module. Missing or invalid policy stops optional
// module work; shared quote collection must not depend on this policy.
function evaluate(policy, registry, identity) {
  const ids = Object.keys(registry.modules || {});
  const paused = reason => ({ status: 'PAUSED', reason, enabled: [], probe: null, paused: ids });
  if (!policy || policy.contract !== 'daytrade_module_recovery_policy_v1') return paused('POLICY_MISSING_OR_INVALID');
  if (policy.release_sha !== identity.release_sha || policy.trade_date !== identity.trade_date) return paused('POLICY_IDENTITY_MISMATCH');
  if (!Array.isArray(policy.restored) || new Set(policy.restored).size !== policy.restored.length) return paused('INVALID_RESTORED_MODULES');
  const supplyScopes=require('./daytrade-closure-dependencies.cjs').supplyScopes;
  const grants=policy.dependency_supply||{};
  if(typeof grants!=='object'||Array.isArray(grants)||Object.entries(grants).some(([id,parents])=>!supplyScopes[id]||!Array.isArray(parents)||parents.length!==supplyScopes[id].length||new Set(parents).size!==parents.length||parents.some(p=>!supplyScopes[id].includes(p))))return paused('INVALID_DEPENDENCY_SUPPLY_SCOPE');
  // Controlled Policy grants execution only; never restore or promote acceptance.
  const supply_only=[...(grants[policy.probe]||[])];
  const enabled = [], rejected = {};
  for (const id of policy.restored) {
    const evidence = policy.acceptance?.[id];
    if (!ids.includes(id)) return paused('INVALID_RESTORED_MODULES');
    if (!evidence || evidence.module_id !== id || evidence.trade_date !== identity.trade_date || evidence.release_sha !== identity.release_sha || typeof evidence.receipt_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.receipt_sha256) || checks.some(key => evidence.checks?.[key] !== true)) {
      rejected[id] = 'RESTORE_EVIDENCE_INCOMPLETE';
      continue;
    }
    enabled.push(id);
  }
  const probe = policy.probe ?? null;
  if (probe !== null && (typeof probe !== 'string' || !ids.includes(probe) || enabled.includes(probe))) return paused('INVALID_SINGLE_PROBE');
  if (probe !== null && policy.restored.includes(probe)) return paused('INVALID_SINGLE_PROBE');
  if (Object.keys(rejected).length) {
    // Unknown dependency scopes retain the original global fail-closed result.
    if ([...enabled, ...(probe ? [probe] : [])].some(id => !independent.includes(id))) return paused('RESTORE_EVIDENCE_INCOMPLETE');
    return { status: enabled.length || probe ? 'STAGED_RECOVERY' : 'PAUSED', enabled, probe,
      paused: ids.filter(id => !enabled.includes(id)), rejected, reason: 'RESTORE_EVIDENCE_INCOMPLETE' };
  }
  return { status: 'STAGED_RECOVERY', enabled, supply_only:supply_only.filter(id=>!enabled.includes(id)), probe, paused: ids.filter(id => !enabled.includes(id)), reason: 'OWNER_REQUESTED_SEQUENTIAL_VALIDATION' };
}
module.exports = { evaluate, checks };
