'use strict';
const fs=require('fs'),path=require('path');
require('../lib/strategy4-recovery-date').validateReplay().then(context=>{const dir=path.join(process.env.FUMAN_RUNTIME_DIR,'data/scan-receipts');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'strategy4-recovery-context.json');fs.writeFileSync(file,JSON.stringify(context,null,2));console.log(JSON.stringify(context));}).catch(error=>{console.error(error.message);process.exitCode=1;});
