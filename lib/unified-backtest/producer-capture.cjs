'use strict';
const {archiveRun}=require('./raw-run-archive.cjs');
function captureCompletedRun({archiveRoot,producerId,runId,tradeDate,declaredCount,candidates,rawRun,recovery=false}){
 if(!archiveRoot)throw Error('ARCHIVE_ROOT_REQUIRED');
 // JSON serialization matches producer receipt format; do not infer missing features or prices.
 const packet=JSON.parse(JSON.stringify({producer_id:producerId,run_id:runId,trade_date:tradeDate,capture_kind:recovery?'RECOVERED_RECORD':'AT_SCAN_COMPLETION',declared_count:declaredCount,candidates,raw_run:rawRun}));
 return archiveRun(archiveRoot,packet);
}
module.exports={captureCompletedRun};
