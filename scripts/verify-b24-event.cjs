'use strict';
const fs=require('node:fs');
const E=require('../lib/mother-pool-event-evidence.cjs');
try{
 const args=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
 // A test clock must be explicitly marked; the caller cannot supply a formal success boolean.
 if(args.scope!=='TEST_ONLY')throw Error('TEST_ONLY_REQUIRED');
 const r=require('../lib/verify-mother-pool-event.cjs').verify({...args,now:args.test_now||new Date().toISOString()});
 const ref=E.save(args.receiptDirectory,r);console.log(JSON.stringify({status:r.status,receipt:ref}));
}catch(e){console.error(JSON.stringify({status:'EVENT_BLOCKED',error:e.message}));process.exitCode=1;}
