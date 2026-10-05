'use strict';
// Independent content readback is mandatory even when the write returned success.
async function publishCoreBeforeDiagnostic({publishCore, verifyCore, writeDiagnostic, recordDiagnosticFailure}) {
  if(typeof verifyCore !== 'function') throw Error('CORE_READBACK_REQUIRED');
  const acknowledgement = await publishCore();
  const readback = await verifyCore(acknowledgement);
  try { await writeDiagnostic(); }
  catch (error) { await recordDiagnosticFailure(error); }
  return {...acknowledgement, independent_readback:readback};
}
module.exports={publishCoreBeforeDiagnostic};
