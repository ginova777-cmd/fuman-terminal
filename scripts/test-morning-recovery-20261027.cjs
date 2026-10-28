'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'morning-auth-')),file=path.join(dir,'context.json');
const RealDate=Date;global.Date=class extends RealDate {constructor(...args){super(...(args.length?args:['2026-10-27T00:30:00Z']));}};
process.env.FUMAN_MORNING_RECOVERY_CONTEXT=file;process.env.FUMAN_MORNING_STAGE='us_0820';
const {context}=require('../lib/opening-report-recovery');
const c={contract:'opening-morning-authorized-recovery-v1',trade_date:'2026-10-27',stage:'us_0820',authorization:'user-20261027-market-fix-morning-recovery',run_id:'opening-report-recovery-20261027-us-test',started_at:'2026-10-27T00:30:00Z',cutoff_at:'2026-10-27T00:35:00Z'};
function set(x){fs.writeFileSync(file,JSON.stringify(x));}
set(c);assert.equal(context(c.trade_date).run_id,c.run_id);
for(const x of [{...c,authorization:'unapproved'},{...c,stage:'asia_0850'},{...c,cutoff_at:'2026-10-27T00:50:00Z'},{...c,cutoff_at:c.started_at}]){set(x);assert.throws(()=>context(c.trade_date));}
console.log('PASS dated user authorization, stage, cutoff bounds and unknown authorization rejection');