'use strict';

// Capture the shared cache before waiting on the DB mirror. Any DB failure
// remains terminal for this invocation; attach local evidence for its receipt.
async function readSharedPreopenEvidence({symbols, readLocal, readRemote, isUsable}) {
  const requested = [...new Set(symbols.map(String))];
  const wanted = new Set(requested);
  const localEvidence = readLocal().filter(row => wanted.has(String(row.symbol)));
  const local = localEvidence.filter(isUsable);
  const available = new Set(local.map(row => String(row.symbol)));
  const missing = requested.filter(symbol => !available.has(symbol));
  if (!missing.length) return local;
  const remote = [];
  for (let offset = 0; offset < missing.length; offset += 200) {
    try {
      const group = missing.slice(offset, offset + 200);
      const rows = await readRemote(group);
      if (!Array.isArray(rows)) throw new Error('INVALID_REMOTE_ROWS');
      const groupSet = new Set(group);
      remote.push(...rows.filter(row => groupSet.has(String(row.symbol))));
    } catch (cause) {
      const error = new Error('PREOPEN_DB_READ_FAILED');
      error.cause = cause;
      error.preopenLocalEvidence = localEvidence;
      error.preopenReadEvidence = {local_count:local.length,requested_count:requested.length,
        remote_rows_before_failure:remote.length,failed_batch_offset:offset,
        db_write_allowed:false,complete:false};
      throw error;
    }
  }
  const supplied = new Set([...local, ...remote].map(row => String(row.symbol)));
  // Keep partial local rows as diagnostics if the mirror has no replacement.
  // The producer's native date/slot validator still decides admissibility.
  return [...local, ...remote, ...localEvidence.filter(row => !supplied.has(String(row.symbol)))];
}
module.exports={readSharedPreopenEvidence};
