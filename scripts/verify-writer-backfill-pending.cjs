'use strict';
const fs=require('fs'),path=require('path');
function verify(record,runId,now=Date.now()){
 const age=now-Date.parse(record?.checked_at);
 return record?.contract==='writer-backfill-pending-v1'&&record.run_id===runId&&record.status==='BACKFILL_PENDING'&&record.complete===false&&record.formal_entry_allowed===false&&record.live_refresh?.quotes_acknowledged===true&&record.live_refresh?.stock_candles_verified===true&&Number.isFinite(age)&&age>=0&&age<=120000;
}
module.exports={verify};
if(require.main===module){try{const r=JSON.parse(fs.readFileSync(path.join(process.argv[2],'state/writer-backfill-pending.json'),'utf8'));process.exitCode=verify(r,process.argv[3])?76:1;}catch{process.exitCode=1;}}
