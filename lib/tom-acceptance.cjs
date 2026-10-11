'use strict';
const evidence = require('./tom-evidence.cjs');
// Read-only receipt normalization; never creates a scanner run or upgrades a gate.
function normalize(task, receipt, expected) {
  const base={task,trade_date:expected.date,runId:expected.runId||null,execution:'UNKNOWN',data:'UNKNOWN',verification:'UNKNOWN',delivery:'NOT_VERIFIED',complete:false};
  if(expected.paused===true)return {...base,verification:'PAUSED_BY_USER'};
  if(expected.marketOpen===false)return {...base,verification:'SKIPPED_NON_TRADING_DAY'};
  if(expected.due===false)return {...base,verification:'NOT_DUE'};
  if(!receipt)return {...base,verification:'DATA_GAP',first_blocker:'receipt_missing'};
  const date=String(receipt.trade_date||receipt.tradeDate||receipt.marketDate||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
  const run=receipt.runId||receipt.run_id;
  const exit=receipt.exitCode??receipt.exit_code;
  const failed=receipt.failed_checks||receipt.issues||[];
  const blocker=receipt.first_blocker||receipt.firstBlocker||receipt.blockingReason||receipt.blocker||(expected.coverage ? evidence.coverage(expected.coverage) : null)||(expected.authority ? evidence.authority(expected.authority) : null)||null;
  if(date!==expected.date||!run||(expected.runId&&run!==expected.runId))return {...base,execution:exit===0?'SUCCEEDED':exit===124?'TIMED_OUT':exit===undefined?'UNKNOWN':'FAILED',verification:'BLOCKED',first_blocker:'receipt_identity_mismatch',sourceBlocker:blocker,sourceRunId:run||null};
  const scanCounts=task==='strategy3'?require('./strategy3-scan-counts.cjs').validate(receipt.scanCounts,run,date):null;
  const countsValid=task==='strategy3'?scanCounts.valid:Number.isInteger(receipt.scanned)&&Number.isInteger(receipt.total)&&receipt.total>0&&receipt.scanned===receipt.total;
  const full=receipt.status==='complete'&&receipt.complete===true&&exit===0&&!blocker&&failed.length===0&&receipt.fallbackUsed!==true;
  const tri=receipt.triSurfaceStatus==='complete'&&['desktopRunId','mobileRunId','scorecardRunId'].every(k=>receipt[k]===run);
  const dataComplete=full&&tri&&countsValid;
  const recovery=receipt.recoveryReplay===true;
  const natural=dataComplete&&receipt.naturalSlotComplete===true&&!recovery;
  return {...base,runId:run,execution:exit===0?'SUCCEEDED':exit===124?'TIMED_OUT':exit===undefined?'UNKNOWN':'FAILED',data:countsValid?'COMPLETE':'UNVERIFIED',verification:natural?'COMPLETE':blocker?'BLOCKED':dataComplete?(recovery?'RECOVERY_COMPLETE':'UNKNOWN'):'INCOMPLETE',complete:natural,recoveryComplete:dataComplete&&recovery,completionScope:recovery?'recovery':natural?'natural':'unverified',first_blocker:blocker||(!countsValid?(scanCounts?.reason||'scan_counts_invalid'):null),scanCounts,scanned:task==='strategy3'?scanCounts.visited:receipt.scanned,total:task==='strategy3'?scanCounts.universe:receipt.total,matches:receipt.matches??receipt.count??null,childStatus:receipt.childStatus||null,recoveryReplay:receipt.recoveryReplay===true,naturalSlotComplete:full&&tri&&countsValid&&receipt.naturalSlotComplete===true&&receipt.recoveryReplay!==true};
}
function morningStatus(final, contentOnly){return ['REPORT_OK','REPORT_DEGRADED','COMPLETE','complete','WAITING_CANONICAL_VERIFIER'].includes(final.report_status)||(contentOnly===true&&final.report_status==='WAITING_PERSISTENCE_ACK'&&final.status==='waiting_persistence_ack'&&final.runner_complete===true&&final.ok===true&&final.complete===false&&final.first_blocker==='mother_pool_persistence_ack_pending');}
function freshness({expectedDate,receiptDate,paused,marketOpen,due}){if(paused)return 'PAUSED_BY_USER';if(marketOpen===false)return 'SKIPPED_NON_TRADING_DAY';if(due===false)return 'NOT_DUE';return receiptDate===expectedDate?'CURRENT':'STALE';}
module.exports={normalize,morningStatus,freshness};


