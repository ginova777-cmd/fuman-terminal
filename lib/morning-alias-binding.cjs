'use strict';
function verifyAliasBinding({ alias, deploymentId, deploymentUrl, projectId, binding, listing }) {
  const matches = listing?.aliases?.filter(item => item.alias === alias);
  if (!alias || !deploymentId || !deploymentUrl || !projectId ||
      binding?.alias !== alias || binding.deploymentId !== deploymentId ||
      binding.projectId !== projectId || binding.deployment?.id !== deploymentId ||
      binding.deployment?.url !== deploymentUrl || binding.redirect ||
      matches?.length !== 1 || matches[0].redirect || listing.pagination?.next) {
    throw new Error('live_alias_binding_mismatch');
  }
  return true;
}
module.exports = { verifyAliasBinding };
