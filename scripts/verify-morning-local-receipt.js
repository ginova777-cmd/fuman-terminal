'use strict';
const fs=require('fs');
const option=k=>process.argv.find(a=>a.startsWith(k+'='))?.slice(k.length+1);
try {
  const receipt=JSON.parse(fs.readFileSync(option('--file'),'utf8').replace(/^\uFEFF/,''));
  const date=option('--date'),stage=option('--stage'),run=option('--run-id'),hash=option('--hash');
  const identity=Boolean(/^\d{4}-\d{2}-\d{2}$/.test(date||'') && ['us_0820','asia_0850'].includes(stage) && run && hash);
  const ok=identity && (process.argv.includes('--notification')
    ? require('../lib/opening-report-line-policy').notificationAccepted(receipt,run,hash,date)
    : require('../lib/opening-report-receipt-authority').contentReceiptMatches(receipt,date,stage,run,hash));
  console.log(JSON.stringify({ok,scope:process.argv.includes('--notification')?'notification_policy':'morning_source_content_only',run_id:run,stage}));
  process.exitCode=ok?0:1;
} catch(error) { console.error(error.message);process.exitCode=1; }
