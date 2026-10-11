'use strict';
// Observation only: these functions can reject evidence, never authorize a scan/deploy.
function coverage(e) {
  if (!e || e.scope !== 'full_priority_pool') return 'coverage_scope_invalid';
  const {requested, fresh, required, qualified} = e;
  if (![requested,fresh,required,qualified].every(Number.isInteger) || requested <= 0 || required <= 0 || fresh < 0 || fresh > requested || qualified < 0 || qualified > required) return 'coverage_counts_invalid';
  if (!e.expectedGeneration || e.generation !== e.expectedGeneration) return 'coverage_generation_mismatch';
  if (fresh * 100 < requested * 95) return 'priority_quote_below_095';
  if (qualified * 100 < required * 90) return 'required_data_below_090';
  return null;
}
function authority(e) {
  if (!e || e.dirty !== false) return 'authority_dirty_or_unknown';
  if (!e.approvedSha || e.head !== e.approvedSha) return 'authority_sha_mismatch';
  if (!e.approvedEntry || e.entry !== e.approvedEntry) return 'authority_entry_mismatch';
  return null;
}
function journalState(entries, handleAlive) {
  if (!Array.isArray(entries) || entries.length === 0) return 'NOT_STARTED';
  const last = entries.at(-1);
  if (entries.some(e => e.state === 'TIMED_OUT')) return 'TIMED_OUT';
  if (last.state === 'ENDED') return 'ENDED';
  return handleAlive === true ? 'RUNNING' : handleAlive === false ? 'INTERRUPTED_OR_LOST' : 'HANDLE_UNVERIFIED';
}
function persistence(report, rounds) {
  if (!report || !report.runId || !report.date) return 'report_identity_missing';
  const ids = new Set();
  for (const r of rounds || []) {
    if (r.reportRunId !== report.runId || r.date !== report.date || r.natural !== true || !r.writerRunId || !r.generation || !r.motherPoolRunId || r.snapshotGeneration == null || r.snapshotSequence == null || r.dbReadbackVerified !== true || r.hashVerified !== true || r.membersVerified !== true) continue;
    ids.add(r.writerRunId + ':' + r.generation);
  }
  return ids.size >= 2 ? null : 'mother_pool_persistence_ack_pending';
}
function delivery(e) {
  if (!e || e.enabled !== true) return 'DISABLED';
  if (e.timedOut === true) return 'TIMED_OUT';
  if (e.ack !== true || !e.eventId || e.ackEventId !== e.eventId) return 'ACK_UNVERIFIED';
  return 'ACKNOWLEDGED'; // Not proof of human reading.
}
function historical(e) {
  if (e.retentionExpired === true) return 'LEGALLY_EXPIRED';
  if (!e.receiptPresent) return 'DATA_GAP';
  if (e.pagesComplete !== true) return 'PAGES_UNVERIFIED';
  if (!e.expectedRun || e.run !== e.expectedRun) return 'IDENTITY_MISMATCH';
  return e.recovery === true ? 'RECOVERY_ONLY' : 'EVIDENCE_PRESENT';
}
module.exports = {coverage,authority,journalState,persistence,delivery,historical};
