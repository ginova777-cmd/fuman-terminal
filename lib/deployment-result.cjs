'use strict';
const { stripVTControlCharacters } = require('node:util');
function identify(stdout, stderr, inspect, contract) {
  const candidates = new Set();
  for (const [stream, raw] of [['stdout', stdout], ['stderr', stderr]]) {
    for (const line of stripVTControlCharacters(String(raw || '')).split(/[\r\n]+/)) {
      // Only machine stdout or CLI Production labels are deployment identities.
      // Inspect links, Aliased lines and arbitrary build log URLs are not candidates.
      const match = line.trim().match(/^(?:▲\s*)?Production\s+https:\/\/([a-z0-9-]+\.vercel\.app)\/?(?:\s+\[[^\]]+\])?$/i)
        || (stream === 'stdout' && line.trim().match(/^https:\/\/([a-z0-9-]+\.vercel\.app)\/?$/i));
      if (match) candidates.add(match[1].toLowerCase());
    }
  }
  if (candidates.size !== 1) throw Error('deployment_result_url_ambiguous:' + candidates.size);
  const url = [...candidates][0];
  const deployment = inspect(url);
  if (!deployment.id || deployment.id === contract.deploymentId || deployment.url !== url ||
      deployment.name !== 'fuman-terminal' || deployment.contextName !== 'ginova777-9771s-projects' ||
      deployment.target !== 'production' || deployment.readyState !== 'READY') throw Error('deployment_result_identity_mismatch');
  return { deploymentUrl: url, deploymentId: deployment.id, deployment };
}
module.exports = { identify };
