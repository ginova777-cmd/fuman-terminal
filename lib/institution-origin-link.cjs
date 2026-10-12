'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const {execFileSync} = require('child_process');
const {assess} = require('./strategy-natural-evidence');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hash = receipt => digest(JSON.stringify(receipt));
const proofPath = (file, receipt) => path.join(path.dirname(file), 'institution-origin', hash(receipt) + '.json');
const dateKey = value => /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(String(value || ''))?.slice(1).join('');
const canonical = file => fs.realpathSync(file).replace(/\\/g, '/').toLowerCase();
function receiptComplete(r) {
  return /^institution-\d{8}-\d{14}$/.test(r?.runId || '') && r.status === 'complete' &&
    r.complete === true && r.exitCode === 0 && !r.blockingReason && !r.first_blocker && !r.firstBlocker &&
    r.fallback !== true && r.fallbackUsed !== true && !(r.failed_checks || []).length &&
    Number.isSafeInteger(r.total) && r.total > 0 && r.scanned === r.total && r.triSurfaceStatus === 'complete' &&
    ['desktopRunId', 'mobileRunId', 'scorecardRunId'].every(key => r[key] === r.runId);
}
// The proof cannot nominate its own trusted release.
function loadAuthority() {
  const contract = JSON.parse(fs.readFileSync('C:/fuman-release-owner/fuman-terminal/data/contracts/release_root_authority_v1.json', 'utf8'));
  if (contract.contract !== 'release_root_authority_v1' || !/^[a-f0-9]{40}$/.test(contract.approvedProductionSha)) throw Error('release_contract_invalid');
  const root = fs.realpathSync(contract.productionRoot);
  const git = args => execFileSync('git', ['-c', `safe.directory=${root.replace(/\\/g, '/')}`, '-C', root, ...args], {encoding:'utf8', windowsHide:true, timeout:15000}).trim();
  if (git(['rev-parse', 'HEAD']) !== contract.approvedProductionSha || git(['status', '--porcelain']) !== '') throw Error('release_root_drift');
  const scriptPath = path.join(contract.productionRoot, 'run-institution.ps1');
  return {sha:contract.approvedProductionSha, scriptPath, scriptSha256:digest(fs.readFileSync(scriptPath))};
}
function readBounded(file, directory, maxBytes) {
  if (!path.isAbsolute(file)) throw Error('absolute_evidence_path_required');
  if (!canonical(file).startsWith(canonical(directory) + '/')) throw Error('evidence_path_outside_contract');
  const size = fs.statSync(file).size;
  if (size <= 0 || size > maxBytes) throw Error('evidence_size_invalid');
  const bytes = fs.readFileSync(file);
  if (bytes.length > maxBytes) throw Error('evidence_size_invalid');
  return bytes;
}
function verifyProof(file, r, proof, options = {}) {
  if (!receiptComplete(r) || r.recoveryReplay === true || proof?.recoveryReplay !== false ||
      proof?.naturalSlotComplete !== true || proof.naturalEvidenceStatus !== 'NATURAL_TRIGGER_VERIFIED' ||
      !/^[a-f0-9]{64}$/.test(proof.naturalEvidenceSha256 || '')) throw Error('origin_proof_invalid');
  const date = dateKey(r.tradeDate || r.marketDate);
  if (!date || (r.tradeDate && r.marketDate && dateKey(r.tradeDate) !== dateKey(r.marketDate))) throw Error('receipt_date_conflict');
  const bytes = readBounded(proof.naturalEvidencePath, path.join(path.dirname(file), 'natural-origin', 'institution'), 4 * 1024 * 1024);
  if (digest(bytes) !== proof.naturalEvidenceSha256) throw Error('natural_hash_mismatch');
  const evidence = JSON.parse(bytes.toString('utf8'));
  if (evidence.contract !== 'strategy-natural-trigger-v1' || evidence.strategy !== 'institution' ||
      evidence.runId !== r.runId || dateKey(evidence.tradeDate) !== date ||
      !Number.isFinite(Date.parse(evidence.checkedAt)) || Date.parse(evidence.checkedAt) < Date.parse(r.startedAt)) throw Error('natural_identity_mismatch');
  const authority = options.authority || loadAuthority(); // Explicit dependency injection for isolated tests.
  const release = evidence.release;
  if (release?.ok !== true || release.sha !== authority.sha || release.scriptSha256 !== authority.scriptSha256 ||
      canonical(release.scriptPath) !== canonical(authority.scriptPath)) throw Error('natural_release_mismatch');
  const assessed = assess({strategy:'institution', scan:r, formalComplete:true, recovery:false, observation:evidence.observation, release});
  if (assessed.naturalSlotComplete !== true || evidence.assessment?.naturalSlotComplete !== true ||
      evidence.assessment.recoveryReplay !== false || evidence.assessment.naturalEvidenceStatus !== assessed.naturalEvidenceStatus ||
      evidence.assessment.naturalTaskInstanceId !== assessed.naturalTaskInstanceId || proof.naturalTaskInstanceId !== assessed.naturalTaskInstanceId) throw Error('natural_trigger_unverified');
  return assessed;
}
function read(file, r, options = {}) {
  const blocked = {...r, naturalSlotComplete:false, naturalEvidenceStatus:'ORIGIN_LINK_UNVERIFIED'};
  try {
    const p = proofPath(file, r);
    const e = JSON.parse(readBounded(p, path.join(path.dirname(file), 'institution-origin'), 1024 * 1024).toString('utf8'));
    if (e.contract !== 'institution-origin-link-v1' || e.runId !== r.runId || e.receiptSha256 !== hash(r)) return blocked;
    const assessed = verifyProof(file, r, e.proof, options);
    return {...r, ...assessed, naturalOriginLink:p, naturalEvidencePath:e.proof.naturalEvidencePath, naturalEvidenceSha256:e.proof.naturalEvidenceSha256};
  } catch { return blocked; }
}
module.exports = {hash, proofPath, read, receiptComplete, verifyProof, loadAuthority};
