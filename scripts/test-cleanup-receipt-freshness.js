'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),os=require('os'),assert=require('assert/strict'),{createRequire}=require('module');
const file=path.join(__dirname,'verify-daily-retention-maintenance.js'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'cleanup-receipt-test-'));
const ctx={require:createRequire(file),__dirname,process,console,Intl,Date};vm.createContext(ctx);vm.runInContext(fs.readFileSync(file,'utf8').split('main().catch(')[0],ctx);
const receipt=path.join(dir,'fixture.json');
function check(payload,options={}){fs.writeFileSync(receipt,JSON.stringify(payload));return vm.runInContext(`receiptCheck('test','test-contract',${JSON.stringify(receipt)},${JSON.stringify(options)})`,ctx).ok;}
const good={ok:true,applied:true,contract:'test-contract',checkedAt:new Date().toISOString()};
assert(check(good));assert(!check({...good,checkedAt:new Date(Date.now()-86400000).toISOString()}));assert(!check({...good,checkedAt:new Date(Date.now()+3600000).toISOString()}));assert(!check({...good,applied:false}));assert(!check({...good,ok:false}));
assert(!check({...good,supabase:{ok:true},vercel:{ok:true,skipped:true}},{history:true}));
assert(check({ok:true,dryRun:false,source:'retired',finishedAt:good.checkedAt},{source:'retired',legacyDryRun:true}));
const tasks=vm.runInContext('scheduledTasks()',ctx);assert(tasks.ok,tasks.stderr);assert(tasks.rows.length===5);for(const row of tasks.rows){assert(row.enabled);assert(row.triggerTimes.length);assert(Number.isFinite(Date.parse(row.lastRun)));}
console.log('PASS same-day, future-date, dry-run, skipped-provider and legacy receipt checks; live task metadata readback');
