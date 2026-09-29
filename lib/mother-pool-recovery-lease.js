'use strict';
// Recovery never claims or renews a lease. The formal caller must already own
// the live lease; an expired or replaced owner cannot authorize continuation.
function verify(rows,{sourceName,hostId,instanceId,tradeDate,now}){
 if(!Array.isArray(rows)||rows.length!==1)throw Error('RECOVERY_LEASE_ROW_COUNT');
 const row=rows[0],until=Date.parse(row.lease_expires_at),at=Date.parse(now);
 if(!sourceName||!hostId||!instanceId||!tradeDate||row.source_name!==sourceName||row.writer_host_id!==hostId||row.writer_instance_id!==instanceId||row.trade_date!==tradeDate)throw Error('RECOVERY_LEASE_OWNER_MISMATCH');
 if(!Number.isFinite(until)||!Number.isFinite(at)||until<=at)throw Error('RECOVERY_LEASE_EXPIRED');
 return true;
}
module.exports={verify};
