'use strict';
function decide({row,ack,expectedHash,tradeDate}){
 if(!row||row.trade_date!==tradeDate||row.payload?.trade_date!==tradeDate||!row.payload.writer_run_id||!row.payload.generation_id)throw Error('SIDE_POLICY_SOURCE_IDENTITY');
 if(ack?.contract!=='source_status_write_ack_v1'||ack.row_sha256!==expectedHash||!['write_response','exact_readback_after_timeout','exact_readback_after_interruption'].includes(ack.ack?.mode))throw Error('SIDE_POLICY_WRITE_UNACKNOWLEDGED');
 const p=row.payload.module_recovery;
 if(!p||!Array.isArray(p.enabled)||!Array.isArray(p.paused))throw Error('SIDE_POLICY_MISSING');
 const needed=['B14','B20'];
 const active=[...p.enabled,...(p.probe?[p.probe]:[])];
 const paused=needed.every(id=>p.paused.includes(id)&&!active.includes(id));
 if(!paused&&!needed.every(id=>active.includes(id)))throw Error('SIDE_POLICY_DEPENDENCY_INCOMPLETE');
 return {status:paused?'PAUSED':'RUN',complete:false,writer_run_id:row.payload.writer_run_id,trade_date:tradeDate,reason:paused?'OWNER_REQUESTED_SEQUENTIAL_VALIDATION':null};
}
module.exports={decide};
