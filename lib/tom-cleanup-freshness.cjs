'use strict';
function taipeiDate(value){
  if(typeof value!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(value))return null;
  const d=new Date(value);return Number.isFinite(+d)?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(d):null;
}
function classify(item,payload,context){
  if(!context||context.verified!==true)return 'UNVERIFIED';
  if(context.kind==='once'){
    if(payload?.ok===false)return 'FAILED';
    const operation=context.expectedOperationId&&payload?.operation_id===context.expectedOperationId;
    const pinned=context.expectedReceiptSha256&&/^[a-f0-9]{64}$/.test(context.expectedReceiptSha256)&&item?.observedSha256===context.expectedReceiptSha256;
    if(!operation&&!pinned)return 'UNVERIFIED';
    return payload?.ok===true?'ONCE_VERIFIED': 'FAILED';
  }
  if(context.kind!=='daily'||!context.expectedDate)return 'UNVERIFIED';
  // expectedDate is the last due slot's trading date, not today's wall-clock date.
  if(context.paused===true)return 'PAUSED_BY_USER';
  if(context.due===false)return 'NOT_DUE';
  if(!payload)return 'DATA_GAP';
  if(payload.ok===false||payload.status==='critical')return 'FAILED';
  if(payload.ok!==true||payload.dryRun===true)return 'UNVERIFIED';
  if(payload.maintenanceRunId||payload.maintenanceAuthorizationSha256){
    if(!context.expectedMaintenanceRunId||context.expectedMaintenanceRunId!==payload.maintenanceRunId)return 'UNVERIFIED';
    if(!context.expectedMaintenanceAuthorizationSha256||context.expectedMaintenanceAuthorizationSha256!==payload.maintenanceAuthorizationSha256)return 'UNVERIFIED';
  }
  const fields={apiOnlyRetiredCleanup:'finishedAt',supabaseVercelHistoryCleanup:'checkedAt',vercelCostHealth:'checkedAt'};
  if(fields[item.key]){
    const time=payload[fields[item.key]],date=taipeiDate(time);
    if(!date)return 'UNVERIFIED';
    if(context.observedAt&&Date.parse(time)>Date.parse(context.observedAt))return 'UNVERIFIED';
    if(date!==context.expectedDate)return 'STALE';
    if(context.expectedSlotAt&&Date.parse(time)<Date.parse(context.expectedSlotAt))return 'STALE';
    return 'CURRENT';
  }
  const date=String(payload.trade_date||payload.tradeDate||payload.marketDate||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
  return date===context.expectedDate?'CURRENT':'STALE';
}
module.exports={classify,taipeiDate};
