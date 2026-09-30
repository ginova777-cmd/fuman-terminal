'use strict';
const fs=require('node:fs'),path=require('node:path');
const {hash}=require('../lib/mother-preopen.cjs');
function read(file,tradeDate,baseDate) {
  const receipt=JSON.parse(fs.readFileSync(file));
  if(receipt.trade_date!==tradeDate||receipt.base_date!==baseDate)throw Error('READBACK_DATE_MISMATCH');
  const result={receipt};
  for(const name of ['trial-0855.json','actual-open.json']) {
    const spec=receipt.files?.[name]; if(!spec)throw Error('READBACK_FILE_MISSING');
    const target=path.resolve(spec.path),root=path.resolve(path.dirname(file),'revisions')+path.sep;
    if(!target.startsWith(root))throw Error('READBACK_PATH_INVALID');
    const bytes=fs.readFileSync(target);if(hash(bytes)!==spec.sha256)throw Error('READBACK_HASH_MISMATCH');
    const value=JSON.parse(bytes);
    if(value.run_id!==receipt.run_id||value.trade_date!==tradeDate||value.base_date!==baseDate)throw Error('READBACK_IDENTITY_MISMATCH');
    result[name]=value;
  }
  return result;
}
if(require.main===module) {
  try {const [file,tradeDate,baseDate]=process.argv.slice(2);const r=read(file,tradeDate,baseDate);
    console.log(JSON.stringify({ok:true,run_id:r.receipt.run_id,status:r.receipt.status,complete:false,covered_count:r.receipt.covered_count}));
  }catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={read};
