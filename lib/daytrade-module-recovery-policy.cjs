'use strict';
const checks = ['payload_bound', 'runtime_bound', 'resource_load', 'natural_write', 'independent_readback', 'freshness', 'page_render', 'page_refresh'];
// A probe is not a restored module. Missing or invalid policy stops optional
// module work; shared quote collection must not depend on this policy.
function evaluate(policy, registry, identity) {
  const ids = Object.keys(registry.modules || {});
  const paused = reason => ({ status: 'PAUSED', reason, enabled: [], probe: null, paused: ids });
  if (!policy || policy.contract !== 'daytrade_module_recovery_policy_v1') return paused('POLICY_MISSING_OR_INVALID');
  if (policy.release_sha !== identity.release_sha || policy.trade_date !== identity.trade_date) return paused('POLICY_IDENTITY_MISMATCH');
  if (!Array.isArray(policy.restored) || new Set(policy.restored).size !== policy.restored.length) return paused('INVALID_RESTORED_MODULES');
  const enabled = [];
  for (const id of policy.restored) {
    const evidence = policy.acceptance?.[id];
    if (!ids.includes(id) || !evidence || evidence.module_id !== id || evidence.trade_date !== identity.trade_date || evidence.release_sha !== identity.release_sha || !evidence.receipt_sha256?.match(/^[a-f0-9]{64}$/) || checks.some(key => evidence.checks?.[key] !== true)) return paused('RESTORE_EVIDENCE_INCOMPLETE');
    enabled.push(id);
  }
  const probe = policy.probe ?? null;
  if (probe !== null && (typeof probe !== 'string' || !ids.includes(probe) || enabled.includes(probe))) return paused('INVALID_SINGLE_PROBE');
  return { status: 'STAGED_RECOVERY', enabled, probe, paused: ids.filter(id => !enabled.includes(id)), reason: 'OWNER_REQUESTED_SEQUENTIAL_VALIDATION' };
}
module.exports = { evaluate, checks };
