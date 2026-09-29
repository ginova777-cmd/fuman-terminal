'use strict';
const fs=require('fs'),path=require('path');
function closedStatus(calendar,runtime){
 if(calendar.marketOpen!==false)return null;
 const date=calendar.displayTradeDate,compact=String(date||'').replace(/\D/g,'');
 if(!/^\d{8}$/.test(compact))throw Error('last_trading_date_missing');
 const dir=path.join(runtime,'data','scan-receipts');
 const read=f=>{try{return JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));}catch{return null;}};
 const files={scan:path.join(dir,'strategy3-v2-complete-scan-'+compact+'.json'),daily:path.join(dir,'strategy3-v2-daily-unattended-closure-'+compact+'.json'),final:path.join(dir,'strategy3.json')};
 const belongs=x=>x&&(x.tradeDate||x.trade_date)===date;
 const scanRaw=read(files.scan),dailyRaw=read(files.daily),finalRaw=read(files.final);
 const scan=belongs(scanRaw)?scanRaw:null,daily=belongs(dailyRaw)?dailyRaw:null,final=belongs(finalRaw)?finalRaw:null;
 const tri=read(path.join(dir,'tri-surface-closures','strategy3.json'));
 const shown=String(tri?.expectedDate||'').replace(/\D/g,'');
 const displayDate=shown.length===8?shown.slice(0,4)+'-'+shown.slice(4,6)+'-'+shown.slice(6):null;
 const dataStatus=final?.status||(daily?.ok===false?'failed':scan?.ok===false?'failed':'pending');
 return {contract:'strategy3_closed_market_status_v1',scope:'read_only_status',executionDate:calendar.marketDate||calendar.tradeDate||calendar.tradingDay?.date,status:'skipped',executionStatus:'SKIPPED',reason:calendar.closedReason,tradeDate:date,expectedDataDate:date,displayedDataDate:displayDate,displayLag:displayDate!==date,complete:false,naturalSlotComplete:false,receiptWritten:false,exitCode:0,lastTradingDay:{tradeDate:date,status:dataStatus,complete:final?.complete===true,first_blocker:final?.complete===true?null:final?.first_blocker||final?.blockingReason||daily?.first_blocker||scan?.first_blocker||(!scan?'last_trading_day_scan_missing':null),runId:scan?.run_id||final?.runId||null,resultCount:scan?.result_count??null},evidencePaths:files,checkedAt:new Date().toISOString()};
}
module.exports={closedStatus};
