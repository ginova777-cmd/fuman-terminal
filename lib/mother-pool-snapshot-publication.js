'use strict';
// Publication intent is recovery state, never a verified receipt/latest pointer.
async function publishWithRecovery({tradeDate,canonicalRunId,loadIntent,saveIntent,build,send,readback,commit,validate}) {
  async function publish(snapshot) {
    if(snapshot.trade_date!==tradeDate || snapshot.canonical_run_id!==canonicalRunId || !validate(snapshot)) {
      throw Error('MOTHER_POOL_SNAPSHOT_INTENT_INVALID');
    }
    await saveIntent({contract:'mother_pool_snapshot_publication_intent_v1',status:'pending',snapshot});
    const ack=await send(snapshot);
    if(ack?.ok!==true || ack.run_id!==snapshot.run_id || ack.snapshot_sequence!==snapshot.snapshot_sequence) {
      throw Error('MOTHER_POOL_SNAPSHOT_DB_ACK_MISMATCH');
    }
    if(typeof readback!=='function')throw Error('MOTHER_POOL_SNAPSHOT_READBACK_REQUIRED');
    const evidence=await readback(snapshot);
    if(evidence?.complete!==true || evidence.status!=='complete' || evidence.exit_code!==0
       || evidence.read_role!=='anon' || evidence.trade_date!==tradeDate || evidence.canonical_run_id!==canonicalRunId
       || !Array.isArray(evidence.failed_checks) || evidence.failed_checks.length!==0 || evidence.first_blocker!==null
       || evidence.mother_pool_run_id!==snapshot.run_id
       || evidence.snapshot_sequence!==snapshot.snapshot_sequence)throw Error('MOTHER_POOL_SNAPSHOT_READBACK_FAILED');
    await commit(snapshot);
    await saveIntent({contract:'mother_pool_snapshot_publication_intent_v1',status:'acknowledged',snapshot});
    return snapshot;
  }
  const intent=await loadIntent();
  if(intent!=null) {
    if(intent.contract!=='mother_pool_snapshot_publication_intent_v1'
       || !['pending','acknowledged'].includes(intent.status)
       || intent.snapshot?.trade_date!==tradeDate || intent.snapshot?.canonical_run_id!==canonicalRunId) {
      throw Error('MOTHER_POOL_SNAPSHOT_INTENT_INVALID');
    }
    if(intent.status==='pending') await publish(intent.snapshot);
  }
  // Rebuild only after recovered generation becomes the local authority.
  return publish(await build());
}
module.exports={publishWithRecovery};
